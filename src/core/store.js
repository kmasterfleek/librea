// The sovereign store. Three things live on disk, all local, all yours:
//   data/ledger.jsonl   every change, hash-chained (source of truth)
//   data/vectors.db     ruvector: fragment + entity semantic vectors (384d)
//   data/snapshot.json  projection cache so boot is fast
// Entities and fragments are projected into memory from the ledger.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { VectorDB } from 'ruvector';
import { Ledger } from './ledger.js';
import { validateEntity, validateFragment, DIM_KEYS } from './schema.js';
import { dimsFromMetrics, signalVector, cosine, flags, outcomeLabel, coverage, riskScore, detectArc, arcs } from './signal.js';
import { embedPassage, embedQuery, embedBatch, meanVector, EMBED_DIM } from './embed.js';
import { FACT_TABLES } from '../sql/schema.js';

const ALL_VIS = ['private', 'family', 'school', 'staff'];

export class Store {
  constructor(dataDir) {
    this.dir = dataDir;
    this.entities = new Map();   // id -> entity
    this.fragments = new Map();  // id -> fragment
    this.byEntity = new Map();   // entityId -> Set<fragmentId>
    this.apps = new Map();       // slug -> app manifest (vibe apps)
    this.ledger = null;
    this.vec = null;
    this.projections = [];   // e.g. SqlProjection; receive every applied event
  }

  /** Register a projection before open(). It must expose apply(ev), applyMany(events), seq. */
  attach(projection) { this.projections.push(projection); return this; }

  async open() {
    fs.mkdirSync(this.dir, { recursive: true });
    this.ledger = new Ledger(path.join(this.dir, 'ledger.jsonl'));
    this.vec = new VectorDB({ dimensions: EMBED_DIM, distanceMetric: 'cosine', storagePath: path.join(this.dir, 'vectors.db') });
    const snap = path.join(this.dir, 'snapshot.json');
    let from = 0;
    if (fs.existsSync(snap)) {
      try {
        const s = JSON.parse(fs.readFileSync(snap, 'utf8'));
        for (const e of s.entities) this.entities.set(e.id, e);
        for (const f of s.fragments) this._indexFragment(f);
        for (const a of s.apps || []) this.apps.set(a.slug, a);
        from = s.seq;
      } catch { this.entities.clear(); this.fragments.clear(); this.byEntity.clear(); }
    }
    const projFrom = Math.min(from, ...this.projections.map((p) => p.seq || 0));
    const pending = [];
    for (const ev of this.ledger.replay()) {
      if (ev.seq > from) this._apply(ev, false);
      if (ev.seq > projFrom) pending.push(ev);
    }
    for (const p of this.projections) p.applyMany(pending.filter((ev) => ev.seq > (p.seq || 0)));
    return this;
  }

  snapshot() {
    const s = { seq: this.ledger.seq, entities: [...this.entities.values()], fragments: [...this.fragments.values()], apps: [...this.apps.values()] };
    fs.writeFileSync(path.join(this.dir, 'snapshot.json'), JSON.stringify(s));
  }

  _indexFragment(f) {
    this.fragments.set(f.id, f);
    if (!this.byEntity.has(f.entityId)) this.byEntity.set(f.entityId, new Set());
    this.byEntity.get(f.entityId).add(f.id);
  }

  _apply(ev, forward = true) {
    const d = ev.data;
    if (forward) for (const p of this.projections) p.apply(ev);
    switch (ev.type) {
      case 'entity.upsert': this.entities.set(d.id, d); break;
      case 'entity.delete': this.entities.delete(d.id); break;
      case 'fragment.add': this._indexFragment(d); break;
      case 'fragment.remove': {
        const f = this.fragments.get(d.id);
        if (f) { this.fragments.delete(d.id); this.byEntity.get(f.entityId)?.delete(d.id); }
        break;
      }
      case 'snapshot.add': {
        const e = this.entities.get(d.entityId);
        if (!e) break;
        const tl = (e.timeline || []).filter((t) => t.at !== d.at);
        tl.push({ at: d.at, dims: d.dims, signal: signalVector(d.dims) });
        tl.sort((a, b) => (a.at < b.at ? -1 : 1));
        e.timeline = tl.slice(-36);
        e.arc = detectArc(e.timeline);
        e.movers = arcs(e.timeline).movers;
        break;
      }
      case 'app.upsert': this.apps.set(d.slug, d); break;
      case 'app.delete': this.apps.delete(d.slug); break;
      default: break;
    }
  }

  // ---------- entities ----------

  /** Upsert with computed signal vector. Merges into the existing record. */
  upsertEntity(input, actor = 'system') {
    const prev = this.entities.get(input.id) || {};
    const merged = validateEntity({ ...prev, ...input, metrics: { ...(prev.metrics || {}), ...(input.metrics || {}) } });
    merged.createdAt = prev.createdAt || new Date().toISOString();
    merged.updatedAt = new Date().toISOString();
    merged.version = (prev.version || 0) + 1;
    if (merged.type === 'student') {
      merged.dims = dimsFromMetrics(merged.metrics);
      merged.signal = signalVector(merged.dims);
      merged.coverage = coverage(merged.dims);
      merged.flags = flags(merged.dims);
      merged.risk = riskScore(merged.metrics);
      merged.outcome = outcomeLabel(merged.dims, merged.flags, merged.metrics, merged.timeline);
      if (merged.timeline) { merged.arc = detectArc(merged.timeline); merged.movers = arcs(merged.timeline).movers; }
    }
    const ev = this.ledger.append('entity.upsert', merged, actor);
    this._apply(ev);
    return merged;
  }

  /**
   * Record a point-in-time signal snapshot (e.g. a month). `dims` is a partial
   * or full 15-dim object with values 0..1. Recomputes outcome/arc.
   */
  addSnapshot(entityId, at, dims, actor = 'system') {
    const e = this.entities.get(entityId);
    if (!e) throw new Error(`no such entity: ${entityId}`);
    if (!/^\d{4}-\d{2}(-\d{2})?$/.test(String(at))) throw new Error('at must be YYYY-MM or YYYY-MM-DD');
    const clean = {};
    for (const k of DIM_KEYS) if (dims[k] != null && Number.isFinite(Number(dims[k]))) clean[k] = Math.min(1, Math.max(0, Number(dims[k])));
    this._apply(this.ledger.append('snapshot.add', { entityId, at: String(at), dims: clean }, actor));
    const cur = this.entities.get(entityId);
    cur.arc = detectArc(cur.timeline);
    cur.outcome = outcomeLabel(cur.dims || {}, cur.flags || [], cur.metrics, cur.timeline);
    return cur.timeline;
  }

  deleteEntity(id, actor = 'system') {
    if (!this.entities.has(id)) return false;
    const ev = this.ledger.append('entity.delete', { id }, actor);
    this._apply(ev);
    return true;
  }

  getEntity(id) { return this.entities.get(id) || null; }

  /** Filter: { type, schoolId, grade, outcome, flag, q } */
  listEntities(filter = {}) {
    const out = [];
    const q = filter.q ? String(filter.q).toLowerCase() : null;
    for (const e of this.entities.values()) {
      if (filter.type && e.type !== filter.type) continue;
      if (filter.schoolId && e.schoolId !== filter.schoolId) continue;
      if (filter.grade != null && e.grade !== Number(filter.grade)) continue;
      if (filter.outcome && e.outcome !== filter.outcome) continue;
      if (filter.flag && !(e.flags || []).some((f) => f.key === filter.flag)) continue;
      if (q && !`${e.firstName || ''} ${e.lastName || ''} ${e.preferredName || ''} ${e.id}`.toLowerCase().includes(q)) continue;
      out.push(e);
    }
    return out;
  }

  // ---------- fragments ----------

  async addFragment(input, actor = 'system') {
    const f = validateFragment(input);
    if (!this.entities.has(f.entityId)) throw new Error(`no such entity: ${f.entityId}`);
    f.id = f.id || randomUUID();
    f.createdAt = new Date().toISOString();
    f.author = f.author || { id: actor, role: 'system' };
    const vector = await embedPassage(f.text);
    await this.vec.insert({ id: `frag:${f.id}`, vector, metadata: this._fragMeta(f) });
    const ev = this.ledger.append('fragment.add', f, actor);
    this._apply(ev);
    await this._refreshEntityVector(f.entityId);
    return f;
  }

  /** Batch add: one embedding pass, one entity-vector refresh per entity. */
  async addFragments(inputs, actor = 'system') {
    const frags = inputs.map((input) => {
      const f = validateFragment(input);
      if (!this.entities.has(f.entityId)) throw new Error(`no such entity: ${f.entityId}`);
      f.id = f.id || randomUUID();
      f.createdAt = new Date().toISOString();
      f.author = f.author || { id: actor, role: 'system' };
      return f;
    });
    const vectors = await embedBatch(frags.map((f) => f.text));
    await this.vec.insertBatch(frags.map((f, i) => ({ id: `frag:${f.id}`, vector: vectors[i], metadata: this._fragMeta(f) })));
    for (const f of frags) this._apply(this.ledger.append('fragment.add', f, actor));
    for (const id of new Set(frags.map((f) => f.entityId))) await this._refreshEntityVector(id);
    return frags;
  }

  _fragMeta(f) {
    const e = this.entities.get(f.entityId) || {};
    return { fragmentId: f.id, entityId: f.entityId, entityType: e.type || 'unknown', schoolId: e.schoolId || '', kind: f.kind, visibility: f.visibility, isEntity: false };
  }

  async removeFragment(id, actor = 'system') {
    const f = this.fragments.get(id);
    if (!f) return false;
    await this.vec.delete(`frag:${id}`);
    const ev = this.ledger.append('fragment.remove', { id }, actor);
    this._apply(ev);
    await this._refreshEntityVector(f.entityId);
    return true;
  }

  getFragments(entityId, { visibility = ALL_VIS } = {}) {
    const ids = this.byEntity.get(entityId);
    if (!ids) return [];
    const allow = new Set(visibility);
    return [...ids].map((id) => this.fragments.get(id)).filter((f) => f && allow.has(f.visibility))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  /** Entity semantic vector = normalized mean of its fragment vectors. */
  async _refreshEntityVector(entityId) {
    const ids = [...(this.byEntity.get(entityId) || [])];
    const vecs = [];
    for (const id of ids) {
      const r = await this.vec.get(`frag:${id}`);
      if (r?.vector) vecs.push(Float32Array.from(r.vector));
    }
    const e = this.entities.get(entityId);
    const key = `entity:${entityId}`;
    try { await this.vec.delete(key); } catch { /* absent */ }
    if (!vecs.length) return;
    await this.vec.insert({ id: key, vector: meanVector(vecs), metadata: { entityId, entityType: e?.type || 'unknown', schoolId: e?.schoolId || '', isEntity: true, kind: 'entity', visibility: 'school' } });
  }

  // ---------- search ----------

  /**
   * Semantic search over fragments, grouped by entity. Visibility is enforced
   * here, server-side, from the caller's ceiling. Returns entities ranked by
   * their best-matching fragment, with the matching fragments attached.
   */
  async semanticSearch(query, { k = 10, visibility = ['school', 'staff'], entityType, schoolId, entityIds } = {}) {
    const qv = await embedQuery(query);
    const raw = await this.vec.search({ vector: qv, k: Math.min(200, k * 8), includeMetadata: true });
    const allow = new Set(visibility);
    const allowIds = entityIds ? new Set(entityIds) : null;
    const groups = new Map();
    for (const r of raw) {
      const m = r.metadata || {};
      if (m.isEntity) continue;
      if (!allow.has(m.visibility)) continue;
      if (entityType && m.entityType !== entityType) continue;
      if (schoolId && m.schoolId !== schoolId) continue;
      if (allowIds && !allowIds.has(m.entityId)) continue;
      const f = this.fragments.get(m.fragmentId);
      if (!f) continue;
      const score = Math.max(0, 1 - (r.distance ?? r.score ?? 1));
      if (!groups.has(m.entityId)) groups.set(m.entityId, { entity: this.entities.get(m.entityId), score, fragments: [] });
      const g = groups.get(m.entityId);
      g.score = Math.max(g.score, score);
      g.fragments.push({ ...f, score });
    }
    return [...groups.values()].filter((g) => g.entity).sort((a, b) => b.score - a.score).slice(0, k);
  }

  /** Nearest entities in either vector space. space: 'signal' | 'semantic' */
  async similar(entityId, { k = 10, space = 'signal', sameType = true } = {}) {
    const e = this.entities.get(entityId);
    if (!e) return [];
    if (space === 'semantic') {
      const me = await this.vec.get(`entity:${entityId}`);
      if (!me?.vector) return [];
      // ruvector applies `filter` after top-k, so over-fetch and filter here.
      const raw = await this.vec.search({ vector: Float32Array.from(me.vector), k: Math.min(2000, (k + 1) * 25), includeMetadata: true });
      return raw.filter((r) => r.metadata?.isEntity && r.metadata.entityId !== entityId)
        .map((r) => ({ entity: this.entities.get(r.metadata.entityId), score: Math.max(0, 1 - (r.distance ?? r.score ?? 1)) }))
        .filter((r) => r.entity && (!sameType || r.entity.type === e.type)).slice(0, k);
    }
    if (!e.signal) return [];
    const out = [];
    for (const o of this.entities.values()) {
      if (o.id === e.id || !o.signal || (sameType && o.type !== e.type)) continue;
      out.push({ entity: o, score: cosine(e.signal, o.signal) });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, k);
  }

  // ---------- aggregates (what apps mostly consume) ----------

  stats() {
    const students = this.listEntities({ type: 'student' });
    const bySchool = {};
    const outcomes = {};
    const dimSums = Object.fromEntries(DIM_KEYS.map((k) => [k, { sum: 0, n: 0 }]));
    for (const s of students) {
      bySchool[s.schoolId || '?'] = (bySchool[s.schoolId || '?'] || 0) + 1;
      outcomes[s.outcome || '?'] = (outcomes[s.outcome || '?'] || 0) + 1;
      for (const k of DIM_KEYS) if (s.dims?.[k] != null) { dimSums[k].sum += s.dims[k]; dimSums[k].n++; }
    }
    const dimMeans = Object.fromEntries(DIM_KEYS.map((k) => [k, dimSums[k].n ? +(dimSums[k].sum / dimSums[k].n).toFixed(3) : null]));
    return {
      entities: this.entities.size, students: students.length, fragments: this.fragments.size, apps: this.apps.size,
      staff: this.listEntities({ type: 'staff' }).length, families: this.listEntities({ type: 'family' }).length,
      schools: this.listEntities({ type: 'school' }).map((s) => ({ id: s.id, name: s.name, level: s.level, students: bySchool[s.id] || 0 })),
      outcomes, dimMeans, ledger: { seq: this.ledger.seq },
    };
  }

  // ---------- facts (relational rows; live only in the ledger + SQL projection) ----------

  /** Validate and append rows for a fact table. Rows must carry the table's key. */
  upsertFacts(table, rows, actor = 'system') {
    const spec = FACT_TABLES[table];
    if (!spec) throw new Error(`unknown fact table: ${table}`);
    if (!Array.isArray(rows) || !rows.length) throw new Error('rows must be a non-empty array');
    if (rows.length > 50000) throw new Error('at most 50000 rows per call');
    const cols = Object.keys(spec.columns);
    const clean = rows.map((r, i) => {
      if (!r || typeof r !== 'object') throw new Error(`row ${i}: not an object`);
      let key = r[spec.key];
      if (key == null || key === '') key = r[spec.key] = randomUUID(); // server mints the key when a client omits it
      if (typeof key !== 'string' || !key.trim() || key.length > 128) throw new Error(`row ${i}: ${spec.key} must be a short string`);
      const out = {};
      for (const c of cols) {
        const v = r[c];
        if (v == null || v === '') continue;
        if (typeof v === 'number' && Number.isFinite(v)) out[c] = v;
        else if (typeof v === 'boolean') out[c] = v ? 1 : 0;
        else if (typeof v === 'string') out[c] = v.slice(0, 4000);
        else throw new Error(`row ${i}: ${c} must be a string, number, or boolean`);
      }
      return out;
    });
    let n = 0;
    for (let i = 0; i < clean.length; i += 5000) { this._apply(this.ledger.append('fact.upsert', { table, rows: clean.slice(i, i + 5000) }, actor)); n += Math.min(5000, clean.length - i); }
    return { table, rows: n };
  }

  deleteFacts(table, ids, actor = 'system') {
    if (!FACT_TABLES[table]) throw new Error(`unknown fact table: ${table}`);
    const clean = [...new Set((ids || []).map(String))];
    if (!clean.length) return { table, deleted: 0 };
    this._apply(this.ledger.append('fact.delete', { table, ids: clean }, actor));
    return { table, deleted: clean.length };
  }

  // ---------- apps ----------

  upsertApp(app, actor = 'system') {
    const ev = this.ledger.append('app.upsert', app, actor);
    this._apply(ev);
    return app;
  }

  deleteApp(slug, actor = 'system') {
    if (!this.apps.has(slug)) return false;
    const ev = this.ledger.append('app.delete', { slug }, actor);
    this._apply(ev);
    return true;
  }
}
