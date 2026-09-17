// SQLite projection of the ledger. Rebuildable at any time; never the source
// of truth. Subscribes to store events and mirrors entities, fragments,
// snapshots, and fact rows into data/librea.sqlite.
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { DDL, SCHEMA_VERSION, FACT_TABLES, FACT_TABLE_NAMES, DIM_COLS, METRIC_COLS } from './schema.js';

export class SqlProjection {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'librea.sqlite');
    this.db = null;
    this.seq = 0;
  }

  open() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.db = new Database(this.file);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    const ver = this._meta('schemaVersion');
    if (ver && Number(ver) !== SCHEMA_VERSION) { this.db.close(); fs.rmSync(this.file, { force: true }); for (const s of ['-wal', '-shm']) fs.rmSync(this.file + s, { force: true }); this.db = new Database(this.file); this.db.pragma('journal_mode = WAL'); }
    this.db.exec(DDL);
    this._setMeta('schemaVersion', String(SCHEMA_VERSION));
    this.seq = Number(this._meta('seq') || 0);
    this._prepare();
    return this;
  }

  close() { if (this.db) { this._setMeta('seq', String(this.seq)); this.db.close(); this.db = null; } }

  _meta(k) { try { return this.db.prepare('SELECT v FROM meta WHERE k = ?').get(k)?.v; } catch { return null; } }
  _setMeta(k, v) { this.db.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, v); }

  _prepare() {
    const up = (table, cols, key) => this.db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) ON CONFLICT(${key}) DO UPDATE SET ${cols.filter((c) => c !== key).map((c) => `${c} = excluded.${c}`).join(', ')}`);
    this.studentCols = ['sourcedId', 'givenName', 'familyName', 'preferredName', 'grade', 'schoolSourcedId', 'dob', 'gender', 'email', 'enrollStatus', 'externalIds', ...METRIC_COLS, ...DIM_COLS.map((c) => 'dim_' + c), 'outcome', 'risk', 'arc', 'coverage', 'flags', 'updatedAt'];
    this.stmt = {
      student: up('students', this.studentCols, 'sourcedId'),
      staff: up('staff', ['sourcedId', 'givenName', 'familyName', 'email', 'role', 'schoolSourcedId', 'updatedAt'], 'sourcedId'),
      org: up('orgs', ['sourcedId', 'name', 'type', 'level', 'identifier', 'parentSourcedId'], 'sourcedId'),
      fragment: up('fragments', ['id', 'entityId', 'kind', 'visibility', 'authorId', 'authorRole', 'source', 'createdAt', 'mediaPath', 'text'], 'id'),
      snapshot: up('snapshots', ['entityId', 'at', ...DIM_COLS], 'entityId, at'),
      delEntity: ['students', 'staff', 'orgs'].map((t) => this.db.prepare(`DELETE FROM ${t} WHERE sourcedId = ?`)),
      delFragment: this.db.prepare('DELETE FROM fragments WHERE id = ?'),
      facts: Object.fromEntries(FACT_TABLE_NAMES.map((t) => [t, up(t, Object.keys(FACT_TABLES[t].columns), FACT_TABLES[t].key)])),
      delFact: Object.fromEntries(FACT_TABLE_NAMES.map((t) => [t, this.db.prepare(`DELETE FROM ${t} WHERE ${FACT_TABLES[t].key} = ?`)])),
    };
    this.txn = this.db.transaction((events) => { for (const ev of events) this._applyOne(ev); });
  }

  /** Apply one ledger event (idempotent). */
  apply(ev) { this.applyMany([ev]); }
  applyMany(events) {
    if (!events.length) return;
    this.txn(events);
    this.seq = Math.max(this.seq, ...events.map((e) => e.seq || 0));
    this._setMeta('seq', String(this.seq));
  }

  _applyOne(ev) {
    const d = ev.data;
    switch (ev.type) {
      case 'entity.upsert': return this.upsertEntity(d);
      case 'entity.delete': return this.stmt.delEntity.forEach((s) => s.run(d.id));
      case 'fragment.add': return this.stmt.fragment.run(d.id, d.entityId, d.kind, d.visibility, d.author?.id ?? null, d.author?.role ?? null, d.source ?? null, d.createdAt ?? null, d.media?.path ?? null, d.text);
      case 'fragment.remove': return this.stmt.delFragment.run(d.id);
      case 'snapshot.add': return this.stmt.snapshot.run(d.entityId, d.at, ...DIM_COLS.map((c) => d.dims?.[c] ?? null));
      case 'fact.upsert': { const s = this.stmt.facts[d.table]; if (!s) return; const cols = Object.keys(FACT_TABLES[d.table].columns); for (const r of d.rows) s.run(...cols.map((c) => (r[c] === undefined ? null : typeof r[c] === 'boolean' ? (r[c] ? 1 : 0) : r[c]))); return; }
      case 'fact.delete': { const s = this.stmt.delFact[d.table]; if (!s) return; for (const id of d.ids) s.run(id); return; }
      default: return;
    }
  }

  upsertEntity(e) {
    const j = (v) => (v == null ? null : JSON.stringify(v));
    if (e.type === 'student') {
      const m = e.metrics || {}, dims = e.dims || {};
      this.stmt.student.run(e.id, e.firstName ?? null, e.lastName ?? null, e.preferredName ?? null, e.grade ?? null, e.schoolId ?? null, e.dob ?? null, e.gender ?? null, e.email ?? null, e.enrollStatus ?? null, j(e.externalIds),
        ...METRIC_COLS.map((c) => m[c] ?? null), ...DIM_COLS.map((c) => dims[c] ?? null), e.outcome ?? null, e.risk ?? null, e.arc ?? null, e.coverage ?? null, j((e.flags || []).map((f) => f.key)), e.updatedAt ?? null);
    } else if (e.type === 'staff') {
      this.stmt.staff.run(e.id, e.firstName ?? null, e.lastName ?? null, e.email ?? null, e.role ?? null, e.schoolId ?? null, e.updatedAt ?? null);
    } else if (e.type === 'school') {
      this.stmt.org.run(e.id, e.name ?? null, 'school', e.level ?? null, e.externalIds ? JSON.stringify(e.externalIds) : null, e.parentId ?? null);
    }
  }

  /** Full rebuild from the in-memory store plus every fact event in the ledger. */
  rebuild(store) {
    this.db.exec(['students', 'staff', 'orgs', 'fragments', 'snapshots', ...FACT_TABLE_NAMES].map((t) => `DELETE FROM ${t};`).join(' '));
    const events = [];
    for (const e of store.entities.values()) events.push({ type: 'entity.upsert', data: e });
    for (const f of store.fragments.values()) events.push({ type: 'fragment.add', data: f });
    for (const e of store.entities.values()) for (const t of e.timeline || []) events.push({ type: 'snapshot.add', data: { entityId: e.id, at: t.at, dims: t.dims } });
    let seq = 0;
    for (const ev of store.ledger.replay()) { seq = ev.seq; if (ev.type === 'fact.upsert' || ev.type === 'fact.delete') events.push(ev); }
    this.txn(events);
    this.seq = seq;
    this._setMeta('seq', String(this.seq));
    return this.seq;
  }

  counts() {
    const out = {};
    for (const t of ['students', 'staff', 'orgs', 'fragments', 'snapshots', ...FACT_TABLE_NAMES]) out[t] = this.db.prepare(`SELECT count(*) c FROM ${t}`).get().c;
    return out;
  }
}
