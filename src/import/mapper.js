// Preview and apply: turn a vendor CSV into Librea entities.
// Two rules govern everything here.
//   1. Validate at the boundary. A bad row is skipped with a reason; it never
//      takes the batch down with it.
//   2. Never erase. A CSV that does not carry a field leaves that field alone,
//      so importing an attendance export cannot blank out a student's name.
import { gradeFromString } from '../core/schema.js';
import { FACT_TABLES } from '../sql/schema.js';
import { deriveAll } from '../sql/derive.js';
import { parseCsv } from './csv.js';
import { PRESETS, CANONICAL_FIELDS, buildMapping, detectPreset, detectKind, METRIC_KEYS } from './presets.js';
import {
  toInt, toPercent, toRatio, toGpa, toEllLevel, toSpecialEd, toFrl, FRL_SES,
  toTrajectory, toDate, slug, safeId,
} from './values.js';
import { factTablesFor, contactRows, serviceRows, relationFromHeader, PASSTHROUGH } from './facts.js';
import { applyAttendance, applyGrades, applyDiscipline, applyPassthrough } from './apply-facts.js';

const METRIC_COERCE = {
  gpa: toGpa, attendancePct: toPercent, testPercentile: toPercent, courseRigor: toRatio,
  assignCompletionPct: toPercent, disciplineIncidents: toInt, extracurricularCount: toInt,
  selScore: toRatio, counselorVisits: toInt, trajectory: toTrajectory, ses: toRatio,
  homeStability: toRatio, ellLevel: toEllLevel, specialEd: toSpecialEd, peerConnected: toRatio,
};
const STAFF_ROLES = new Set(['teacher', 'staff', 'administrator', 'aide', 'proctor', 'counselor', 'principal']);
const RIGOR_RE = /\b(ap|ib|honors|honor|advanced|adv|dual|gate|accelerated)\b/i;

/** Pull the canonical fields out of one parsed row. Empty cells drop out. */
export function mapRow(row, mapping) {
  const out = {};
  for (const [field, header] of Object.entries(mapping)) {
    if (!header) continue;
    const raw = row[header];
    if (raw === undefined || String(raw).trim() === '') continue;
    out[field] = String(raw).trim();
  }
  return out;
}

function resolvePlan(csvText, { preset, kind, mapping } = {}) {
  const { headers, rows, delimiter, duplicateHeaders } = parseCsv(csvText);
  const detected = detectPreset(headers);
  const presetId = preset && PRESETS[preset] ? preset : detected.preset;
  const confidence = preset && PRESETS[preset] ? (preset === detected.preset ? detected.confidence : null) : detected.confidence;
  const resolvedKind = kind || detectKind(headers, presetId, rows);
  const built = buildMapping(headers, presetId, resolvedKind === 'unknown' ? 'students' : resolvedKind);
  const finalMapping = mapping ? sanitizeMapping(mapping, headers, resolvedKind) : built.mapping;
  const used = new Set(Object.values(finalMapping).filter(Boolean));
  return {
    headers, rows, delimiter, duplicateHeaders, preset: presetId, confidence,
    kind: resolvedKind, mapping: finalMapping, unmapped: headers.filter((h) => !used.has(h)),
    scores: detected.scores,
  };
}

/** A caller-supplied mapping is trusted only where it names real headers. */
function sanitizeMapping(mapping, headers, kind) {
  const allowed = new Set(headers);
  const fields = CANONICAL_FIELDS[kind] || CANONICAL_FIELDS.students;
  const out = {};
  for (const f of fields) out[f] = null;
  for (const [field, header] of Object.entries(mapping || {})) {
    if (header && allowed.has(header)) out[field] = header;
  }
  return out;
}

/** Inspect a CSV without touching the store. */
export function previewImport(csvText, opts = {}) {
  const p = resolvePlan(csvText, opts);
  const warnings = [];
  if (!p.headers.length) warnings.push('file has no header row');
  if (!p.rows.length) warnings.push('file has a header but no data rows');
  if (p.duplicateHeaders.length) warnings.push(`duplicate column names were renamed: ${p.duplicateHeaders.join(', ')}`);
  if (p.kind === 'unknown') warnings.push('could not tell what kind of file this is; choose a kind before applying');
  if (p.confidence !== null && p.confidence < 0.3) warnings.push('preset detection is uncertain; check the mapping below');
  const required = { students: ['id'], staff: ['id'], attendance: ['studentId'], grades: ['studentId'], discipline: ['studentId'], orgs: ['id'] }[p.kind] || [];
  for (const f of required) if (!p.mapping[f]) warnings.push(`no column mapped to required field "${f}"`);
  if (p.kind === 'students' && !p.mapping.lastName && !p.mapping.firstName) warnings.push('no name column found; records will import without names');
  if (p.unmapped.length) warnings.push(`${p.unmapped.length} column(s) are not mapped and will be ignored`);
  return {
    preset: p.preset, confidence: p.confidence, kind: p.kind, delimiter: p.delimiter,
    headers: p.headers, mapping: p.mapping, unmapped: p.unmapped,
    sampleRows: p.rows.slice(0, 5).map((r) => mapRow(r, p.mapping)),
    rowCount: p.rows.length, warnings, scores: p.scores,
    factTables: factTablesFor(p.kind, p.mapping),
    fields: CANONICAL_FIELDS[p.kind] || CANONICAL_FIELDS.students,
  };
}

// ------------------------------------------------------------------ apply --

/**
 * Write a CSV into the store. Entities are upserted synchronously; the slow
 * semantic work (one 'record' fragment per student) is left to the job runner,
 * which reads `entityIds` off the result.
 */
export function applyImport(store, csvText, opts = {}) {
  const { actor = 'import', dryRun = false, sql = null } = opts;
  const p = resolvePlan(csvText, opts);
  const result = {
    preset: p.preset, kind: p.kind, dryRun: !!dryRun, rowCount: p.rows.length,
    created: 0, updated: 0, skipped: 0, errors: [], warnings: [], entityIds: [], schoolIds: [],
    facts: {}, derived: null,
  };
  const ctx = makeContext(store, p, { actor, dryRun, sql, result });
  if (!p.rows.length) { result.warnings.push('nothing to import: no data rows'); return result; }
  if (p.kind === 'unknown') { result.warnings.push('unknown file kind; nothing was imported'); return result; }
  const handler = HANDLERS[p.kind];
  if (!handler) { result.warnings.push(`no importer for kind "${p.kind}"`); return result; }
  handler(p.rows, ctx);
  flushFacts(ctx);
  runDerive(ctx);
  return result;
}

const HANDLERS = {
  students: applyStudents, staff: applyStaff, orgs: applyOrgs,
  attendance: applyAttendance, grades: applyGrades, discipline: applyDiscipline,
  ...Object.fromEntries(Object.keys(PASSTHROUGH).map((k) => [k, applyPassthrough(k)])),
};

/**
 * Everything a handler needs, on one object. The fact-emitting handlers live
 * in apply-facts.js and reach these helpers only through here, which keeps the
 * two modules from importing each other.
 */
function makeContext(store, p, { actor, dryRun, sql, result }) {
  const ctx = {
    store, actor, dryRun, sql, result, preset: p.preset, kind: p.kind, mapping: p.mapping,
    pending: new Map(), touched: new Set(),
    mapRow: (row) => mapRow(row, p.mapping),
    fail: (line, message) => fail(ctx, line, message),
    countWrite: (id, existed) => countWrite(ctx, id, existed),
    writeMetrics: (id, metrics) => writeMetrics(ctx, id, metrics),
    groupByStudent: (rows) => groupByStudent(rows, ctx),
    pushFact: (table, row) => pushFact(ctx, table, row),
  };
  ctx.school = schoolResolver(ctx);
  ctx.resolveOrg = (rawId) => ctx.school(null, rawId);
  ctx.resolveUser = userResolver(ctx);
  return ctx;
}

/** Queue a fact row, keyed by its table's primary key so re-rows collapse. */
function pushFact(ctx, table, row) {
  if (!row) return;
  const key = row[FACT_TABLES[table].key];
  if (!key) return;
  if (!ctx.pending.has(table)) ctx.pending.set(table, new Map());
  ctx.pending.get(table).set(key, row);
}

/** One upsertFacts call per table, so a 5000-row file is a handful of events. */
function flushFacts(ctx) {
  for (const [table, byKey] of ctx.pending) {
    const rows = [...byKey.values()];
    if (!rows.length) continue;
    try {
      if (!ctx.dryRun) ctx.store.upsertFacts(table, rows, ctx.actor);
      ctx.result.facts[table] = rows.length;
    } catch (err) {
      ctx.result.warnings.push(`could not write ${table}: ${err.message}`);
    }
  }
}

/** Recompute metrics from the facts we just wrote, for the students we touched. */
function runDerive(ctx) {
  if (!ctx.touched.size) return;
  if (ctx.dryRun) return;
  if (!ctx.sql?.db) {
    ctx.result.warnings.push('no SQL projection attached; facts were recorded but metrics were not derived');
    return;
  }
  ctx.result.derived = deriveAll(ctx.sql.db, ctx.store, [...ctx.touched], ctx.actor);
}

// --------------------------------------------------------------- resolvers --

/**
 * Resolve the school a row belongs to.
 *
 * A school NAME is authoritative: it is the thing a human recognises, and two
 * districts happily reuse the same numeric SchoolID. So a name resolves to an
 * existing school of that name, or creates one, and the vendor's id is recorded
 * on that school as an externalId. A row carrying only a bare vendor id is then
 * resolvable later; when it still matches nothing, the row is left unassigned
 * rather than conjuring a school called "207".
 */
function schoolResolver(ctx) {
  const byName = new Map();
  const byVendorId = new Map();
  const known = new Set();
  const warned = new Set();
  for (const e of ctx.store.listEntities({ type: 'school' })) {
    known.add(e.id);
    if (e.name) byName.set(String(e.name).toLowerCase(), e.id);
    for (const v of Object.values(e.externalIds || {})) byVendorId.set(String(v), e.id);
  }
  const remember = (entityId, rawId) => {
    if (!rawId) return;
    const key = String(rawId);
    if (byVendorId.get(key) === entityId) return;
    byVendorId.set(key, entityId);
    if (ctx.dryRun) return;
    const prev = ctx.store.getEntity(entityId);
    ctx.store.upsertEntity({ id: entityId, type: 'school', externalIds: { ...(prev?.externalIds || {}), [ctx.preset]: key } }, ctx.actor);
  };
  return (name, rawId, onWarn) => {
    if (name) {
      const key = String(name).toLowerCase();
      let id = byName.get(key);
      if (!id) {
        id = safeId('SCH-', slug(name));
        if (!known.has(id)) {
          if (!ctx.dryRun) ctx.store.upsertEntity({ id, type: 'school', name: String(name).trim() }, ctx.actor);
          known.add(id);
          ctx.result.schoolIds.push(id);
        }
        byName.set(key, id);
      }
      remember(id, rawId);
      return id;
    }
    if (rawId) {
      const key = String(rawId);
      const direct = byVendorId.get(key);
      if (direct) return direct;
      const prefixed = /^SCH-/i.test(key) ? safeId('', key) : safeId('SCH-', key);
      if (known.has(key)) return key;
      if (known.has(prefixed)) return prefixed;
      if (!warned.has(key)) {
        warned.add(key);
        onWarn?.(`school id "${key}" matches no known school; those students were left unassigned`);
      }
      return undefined;
    }
    return undefined;
  };
}

/** Find the entity a source id already refers to, honouring externalIds. */
function entityResolver(store, presetId, type, prefix) {
  const byPreset = new Map();
  const byAny = new Map();
  for (const e of store.listEntities({ type })) {
    for (const [k, v] of Object.entries(e.externalIds || {})) {
      byPreset.set(`${k}::${v}`, e.id);
      if (!byAny.has(String(v))) byAny.set(String(v), e.id);
    }
  }
  return (sourceId) => {
    const s = String(sourceId);
    return byPreset.get(`${presetId}::${s}`) || byAny.get(s) || (store.getEntity(s)?.type === type ? s : null) || safeId(prefix, s);
  };
}

function countWrite(ctx, entityId, existed) {
  if (existed) ctx.result.updated++; else ctx.result.created++;
  if (!ctx.result.entityIds.includes(entityId)) ctx.result.entityIds.push(entityId);
}

const fail = (ctx, line, message) => { ctx.result.skipped++; ctx.result.errors.push({ row: line, message }); };

// ---------------------------------------------------------------- students --

function applyStudents(rows, ctx) {
  const school = ctx.school;
  const resolve = entityResolver(ctx.store, ctx.preset, 'student', 'STU-');
  const relation = relationFromHeader(ctx.mapping.guardianName);
  for (const row of rows) {
    const line = row.__line;
    try {
      const v = mapRow(row, ctx.mapping);
      if (v.role && STAFF_ROLES.has(v.role.toLowerCase())) { fail(ctx, line, `role "${v.role}" is not a student`); continue; }
      const sourceId = v.id || v.externalId;
      if (!sourceId) { fail(ctx, line, 'missing student id'); continue; }
      const entityId = resolve(sourceId);
      const prev = ctx.store.getEntity(entityId);
      const patch = { id: entityId, type: 'student', externalIds: { ...(prev?.externalIds || {}), [ctx.preset]: String(sourceId) } };
      if (v.externalId && v.externalId !== String(sourceId)) patch.externalIds.state = v.externalId;
      for (const [field, key] of [['firstName', 'firstName'], ['lastName', 'lastName'], ['preferredName', 'preferredName'], ['email', 'email'], ['gender', 'gender'], ['enrollStatus', 'enrollStatus']]) {
        if (v[field]) patch[key] = v[field];
      }
      if (v.dob) patch.dob = toDate(v.dob);
      if (v.grade) {
        const g = gradeFromString(v.grade);
        if (Number.isInteger(g) && g >= -1 && g <= 13) patch.grade = g;
        else ctx.result.warnings.push(`row ${line}: unreadable grade "${v.grade}", left unset`);
      }
      const schoolId = school(v.schoolName, v.schoolId, (msg) => ctx.result.warnings.push(msg));
      if (schoolId) patch.schoolId = schoolId;
      if (v.schoolName) patch.schoolName = v.schoolName;
      const guardian = guardianFrom(v, prev);
      if (guardian) patch.guardians = guardian;
      if (v.guardianIds) patch.guardianIds = v.guardianIds.split(/[,;|]/).map((x) => x.trim()).filter(Boolean);
      const frl = toFrl(v.frl);
      if (frl) patch.frl = frl;
      patch.metrics = metricsFrom(v, frl, prev);
      if (!ctx.dryRun) ctx.store.upsertEntity(patch, ctx.actor);
      countWrite(ctx, entityId, !!prev);
      // The roster's guardians and program flags are facts in their own right.
      for (const row of contactRows(v, entityId, relation)) ctx.pushFact('contacts', row);
      for (const row of serviceRows(patch.metrics, entityId, frl)) ctx.pushFact('services', row);
    } catch (err) {
      fail(ctx, line, err.message);
    }
  }
}

function guardianFrom(v, prev) {
  if (!v.guardianName && !v.guardianEmail && !v.guardianPhone) return null;
  const g = {};
  if (v.guardianName) g.name = v.guardianName;
  if (v.guardianEmail) g.email = v.guardianEmail;
  if (v.guardianPhone) g.phone = v.guardianPhone;
  const rest = (prev?.guardians || []).filter((x) => !g.name || String(x.name || '').toLowerCase() !== g.name.toLowerCase());
  const match = (prev?.guardians || []).find((x) => g.name && String(x.name || '').toLowerCase() === g.name.toLowerCase());
  return [{ ...(match || {}), ...g }, ...rest].slice(0, 6);
}

function metricsFrom(v, frl, prev) {
  const metrics = {};
  for (const k of METRIC_KEYS) {
    if (v[k] === undefined) continue;
    const coerced = METRIC_COERCE[k](v[k]);
    if (coerced !== undefined) metrics[k] = coerced;
  }
  // Free/reduced lunch is the economic signal districts already hold; use it
  // only when the file carries no explicit socioeconomic column.
  if (frl && metrics.ses === undefined && prev?.metrics?.ses === undefined) metrics.ses = FRL_SES[frl];
  return metrics;
}

// ------------------------------------------------------------------- staff --

function applyStaff(rows, ctx) {
  const school = ctx.school;
  const resolve = entityResolver(ctx.store, ctx.preset, 'staff', 'STF-');
  for (const row of rows) {
    const line = row.__line;
    try {
      const v = mapRow(row, ctx.mapping);
      const sourceId = v.id || v.email;
      if (!sourceId) { fail(ctx, line, 'missing staff id'); continue; }
      if (v.role && v.role.toLowerCase() === 'student') { fail(ctx, line, 'role "student" is not staff'); continue; }
      const entityId = resolve(sourceId);
      const prev = ctx.store.getEntity(entityId);
      const patch = { id: entityId, type: 'staff', externalIds: { ...(prev?.externalIds || {}), [ctx.preset]: String(sourceId) } };
      for (const f of ['firstName', 'lastName', 'email', 'role']) if (v[f]) patch[f] = v[f];
      const schoolId = school(v.schoolName, v.schoolId, (msg) => ctx.result.warnings.push(msg));
      if (schoolId) patch.schoolId = schoolId;
      if (!ctx.dryRun) ctx.store.upsertEntity(patch, ctx.actor);
      countWrite(ctx, entityId, !!prev);
    } catch (err) {
      fail(ctx, line, err.message);
    }
  }
}

// -------------------------------------------------------------------- orgs --

function applyOrgs(rows, ctx) {
  for (const row of rows) {
    const line = row.__line;
    try {
      const v = mapRow(row, ctx.mapping);
      if (!v.name && !v.id) { fail(ctx, line, 'org row has neither id nor name'); continue; }
      const id = v.name ? safeId('SCH-', slug(v.name)) : safeId('SCH-', v.id);
      const prev = ctx.store.getEntity(id);
      const patch = { id, type: 'school', name: v.name || v.id, externalIds: { ...(prev?.externalIds || {}), [ctx.preset]: String(v.id || id) } };
      if (v.orgType) patch.level = v.orgType;
      if (v.parentId) patch.parentId = v.parentId;
      if (!ctx.dryRun) ctx.store.upsertEntity(patch, ctx.actor);
      countWrite(ctx, id, !!prev);
    } catch (err) {
      fail(ctx, line, err.message);
    }
  }
}

// -------------------------------------------------- per-student aggregates --

/** Group rows by the student they belong to, dropping rows we cannot place. */
function groupByStudent(rows, ctx) {
  const resolve = entityResolver(ctx.store, ctx.preset, 'student', 'STU-');
  const groups = new Map();
  for (const row of rows) {
    const v = mapRow(row, ctx.mapping);
    const sourceId = v.studentId || v.id;
    if (!sourceId) { fail(ctx, row.__line, 'missing student id'); continue; }
    const entityId = resolve(sourceId);
    if (!ctx.store.getEntity(entityId)) { fail(ctx, row.__line, `unknown student: ${sourceId} (import the roster first)`); continue; }
    if (!groups.has(entityId)) groups.set(entityId, []);
    groups.get(entityId).push({ v, line: row.__line });
  }
  return groups;
}

function writeMetrics(ctx, entityId, metrics) {
  if (!Object.keys(metrics).length) return false;
  const existed = !!ctx.store.getEntity(entityId);
  if (!ctx.dryRun) ctx.store.upsertEntity({ id: entityId, type: 'student', metrics }, ctx.actor);
  countWrite(ctx, entityId, existed);
  return true;
}

/**
 * Resolve a vendor user id onto a Librea entity. Students must already exist,
 * because a result row for a student nobody imported has nothing to attach to;
 * staff references fall back to the raw id so a teacher column is never lost.
 */
function userResolver(ctx) {
  const student = lookup(ctx.store, ctx.preset, 'student');
  const staff = lookup(ctx.store, ctx.preset, 'staff');
  return (rawId, role) => {
    const isStaff = role && role.toLowerCase() !== 'student';
    if (isStaff) return staff(rawId) || rawId;
    return student(rawId) || null;
  };
}

/** Like entityResolver, but answers null instead of inventing an id. */
function lookup(store, presetId, type) {
  const byPreset = new Map();
  const byAny = new Map();
  for (const e of store.listEntities({ type })) {
    for (const [k, v] of Object.entries(e.externalIds || {})) {
      byPreset.set(`${k}::${v}`, e.id);
      if (!byAny.has(String(v))) byAny.set(String(v), e.id);
    }
  }
  return (rawId) => {
    const s = String(rawId);
    const hit = byPreset.get(`${presetId}::${s}`) || byAny.get(s);
    if (hit) return hit;
    return store.getEntity(s)?.type === type ? s : null;
  };
}
