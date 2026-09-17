// Binding slots to data, at home. A binding is one of:
//   { sql }                                   a fixed read-only SELECT, run under the viewer's scope
//   { aggregate: { groupBy, metric, filter } } the broker's k-anonymous aggregate op
//   { text }                                  a literal paragraph (text slots only)
// Nothing here ever reaches a model provider. The query is written or accepted
// by a person in the district, run against the real schema before it is saved,
// and stored in the app manifest, which lives in the hash-chained ledger.
import { HttpError } from '../api/router.js';
import { checkSql, runScoped, SqlError } from '../sql/query.js';
import { SLOT_KINDS } from './design.js';

const GROUPS = ['schoolId', 'grade', 'outcome', 'flag'];

/** Coerce a client-supplied binding to one of the three forms. Throws on anything else. */
export function normalizeBinding(raw, slot) {
  if (!raw || typeof raw !== 'object') throw new HttpError(400, 'binding must be an object');
  if (typeof raw.sql === 'string' && raw.sql.trim()) return { sql: checkSql(raw.sql) };
  if (raw.aggregate && typeof raw.aggregate === 'object') {
    const a = raw.aggregate;
    if (!GROUPS.includes(a.groupBy)) throw new HttpError(400, `aggregate.groupBy must be one of ${GROUPS.join(', ')}`);
    const out = { groupBy: a.groupBy, metric: typeof a.metric === 'string' && a.metric ? a.metric.slice(0, 40) : 'count' };
    if (a.filter && typeof a.filter === 'object') out.filter = Object.fromEntries(Object.entries(a.filter).filter(([, v]) => v != null && v !== '').slice(0, 6).map(([k, v]) => [String(k).slice(0, 20), String(v).slice(0, 64)]));
    return { aggregate: out };
  }
  if (typeof raw.text === 'string' && raw.text.trim()) {
    if (slot && slot.kind !== 'text') throw new HttpError(400, `a literal text binding only fits a text slot (slot "${slot.id}" is ${slot.kind})`);
    return { text: raw.text.trim().slice(0, 4000) };
  }
  throw new HttpError(400, 'binding must carry sql, aggregate, or text');
}

const isNum = (v) => typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)));
const num = (v) => (typeof v === 'number' ? v : Number(v));

function pickColumns(columns, rows) {
  const sample = rows.find(Boolean) || {};
  const numeric = columns.filter((c) => rows.some((r) => isNum(r[c])) && rows.every((r) => r[c] == null || isNum(r[c])));
  const textual = columns.filter((c) => !numeric.includes(c));
  return { numeric, textual, sample };
}

/**
 * Shape raw query rows into what the slot kind expects. Returns
 * { rows, problems } where problems is a list of plain sentences; an empty
 * list means the binding fits the slot.
 */
export function shapeRows(slot, columns, rows) {
  const kind = SLOT_KINDS[slot.kind];
  const problems = [];
  const has = (c) => columns.includes(c);
  const { numeric, textual } = pickColumns(columns, rows);
  let out = [];
  if (slot.kind === 'stat') {
    const vcol = has('value') ? 'value' : numeric[0];
    if (!vcol) problems.push('A stat needs one numeric column (name it "value").');
    const r = rows[0] || {};
    if (rows.length > 1) problems.push(`A stat uses one row; this query returns ${rows.length}. Aggregate it (COUNT, AVG, SUM).`);
    if (vcol && rows.length) out = [{ value: num(r[vcol]), label: has('label') ? String(r.label) : slot.label, ...(has('note') && r.note != null ? { note: String(r.note) } : {}) }];
  } else if (slot.kind === 'bar' || slot.kind === 'line') {
    const lcol = has('label') ? 'label' : textual[0] || columns.find((c) => c !== (has('value') ? 'value' : numeric[0]));
    const vcol = has('value') ? 'value' : numeric.find((c) => c !== lcol);
    if (!lcol) problems.push('A chart needs a label column (name it "label").');
    if (!vcol) problems.push('A chart needs a numeric value column (name it "value").');
    if (lcol && vcol) out = rows.map((r) => ({ label: r[lcol] == null ? '' : String(r[lcol]), value: isNum(r[vcol]) ? num(r[vcol]) : 0 }));
  } else if (slot.kind === 'table') {
    const lower = Object.fromEntries(columns.map((c) => [c.toLowerCase(), c]));
    const map = slot.columns.map((c) => [c.key, lower[c.key.toLowerCase()]]);
    const missing = map.filter(([, src]) => !src).map(([k]) => k);
    if (missing.length) problems.push(`The query is missing column${missing.length > 1 ? 's' : ''} ${missing.join(', ')} that the table declares (alias with AS).`);
    out = rows.map((r) => Object.fromEntries(map.filter(([, src]) => src).map(([k, src]) => [k, r[src]])));
  } else if (slot.kind === 'list') {
    const tcol = has('title') ? 'title' : columns[0];
    if (!tcol) problems.push('A list needs a title column (name it "title").');
    const scol = has('subtitle') ? 'subtitle' : columns.find((c) => c !== tcol && c !== 'meta');
    const mcol = has('meta') ? 'meta' : columns.find((c) => c !== tcol && c !== scol);
    if (tcol) out = rows.map((r) => ({ title: String(r[tcol] ?? ''), ...(scol && r[scol] != null ? { subtitle: String(r[scol]) } : {}), ...(mcol && r[mcol] != null ? { meta: r[mcol] } : {}) }));
  } else if (slot.kind === 'text') {
    const tcol = has('text') ? 'text' : columns[0];
    if (!tcol) problems.push('A text slot needs a text column (name it "text").');
    if (tcol) out = rows.map((r) => ({ text: String(r[tcol] ?? '') }));
  }
  const truncated = out.length > kind.maxRows;
  if (truncated) out = out.slice(0, kind.maxRows);
  return { rows: out, problems, truncated };
}

/**
 * Run one binding for one slot under a scope. Never throws for a bad query:
 * the error is part of the result so a page renders with the message in place.
 */
export async function runBinding(binding, slot, ctx, store, deps, query) {
  try {
    if (binding.text) return { rows: [{ text: binding.text }], columns: ['text'], rowCount: 1, truncated: false, problems: [] };
    if (binding.aggregate) {
      const agg = await query({ op: 'aggregate', args: binding.aggregate }, ctx, store, deps);
      const rows = agg.groups.map((g) => ({ label: g.label || g.key, value: g.value ?? g.n }));
      const shaped = shapeRows(slot, ['label', 'value'], rows);
      const note = agg.suppressed ? `${agg.suppressed} student${agg.suppressed === 1 ? '' : 's'} not shown: groups smaller than ${agg.kAnonymity} are withheld.` : null;
      return { ...shaped, columns: ['label', 'value'], rowCount: rows.length, ...(note ? { note } : {}) };
    }
    const db = deps?.sql?.db;
    if (!db) throw new HttpError(503, 'the SQL projection is not available on this server');
    const r = runScoped(db, binding.sql, ctx.scope, { limit: SLOT_KINDS[slot.kind].maxRows + 1 });
    const shaped = shapeRows(slot, r.columns, r.rows);
    return { ...shaped, truncated: shaped.truncated || r.truncated, columns: r.columns, rowCount: r.rowCount, ms: r.ms };
  } catch (err) {
    if (err instanceof SqlError || err instanceof HttpError) return { error: err.message, problems: [err.message] };
    throw err;
  }
}

/** The broker op behind librea.bindings(): every slot of the current app, for this viewer. */
export async function runBindings(app, ctx, store, deps, query) {
  if (!app?.design) throw new HttpError(400, 'this app has no design manifest');
  const bindings = app.bindings || {};
  const preview = !app.published && !!ctx.user && (ctx.user.role === 'admin' || app.author?.username === ctx.user.username);
  const slots = {};
  for (const slot of app.design.slots) {
    const b = bindings[slot.id];
    if (!b) { slots[slot.id] = { unbound: true }; continue; }
    const r = await runBinding(b, slot, ctx, store, deps, query);
    slots[slot.id] = r.error ? { error: r.error } : { rows: r.rows, truncated: !!r.truncated, ...(r.note ? { note: r.note } : {}) };
  }
  return { preview, slots };
}

// ------------------------------------------------------------- the resolver

const ABS = "SUM(CASE WHEN a.code IN ('absent','excused') THEN 1 ELSE 0 END)";
const wordsOf = (slot) => ` ${slot.id} ${slot.label} ${slot.hint || ''} `.toLowerCase().replace(/[^a-z0-9]+/g, ' ');

/**
 * Propose a binding for a slot from its id, label, and hint, given the app's
 * scope. Deterministic, no model. Returns { binding, why } or null when the
 * catalog has nothing to offer (the builder writes the query by hand).
 */
export function proposeBinding(slot, scope = {}) {
  const w = wordsOf(slot);
  const has = (...ks) => ks.some((k) => w.includes(` ${k}`) || w.includes(k));
  const agg = !!scope.aggregatesOnly;
  const mine = Array.isArray(scope.entityIds) && scope.entityIds.length > 0;
  const bySchool = has('school');
  const byGrade = has('by grade', 'each grade', 'per grade', 'grade order');
  const byOutcome = has('outcome', 'standing', 'on track', 'status');
  const overTime = has('week', 'month', 'over time', 'trend', 'by date', 'per day', 'daily');
  const att = has('attend', 'absen', 'chronic', 'tardy');
  const gpa = has('gpa', 'grade point');
  const own = has(' my ', ' me ', ' mine ', 'myself');
  const kind = slot.kind;
  const nameCols = scope.pii ? 'givenName, familyName, ' : '';

  const sql = (q, why) => ({ binding: { sql: q }, why });
  const aggregate = (groupBy, metric, why) => ({ binding: { aggregate: { groupBy, metric } }, why });

  if (kind === 'stat') {
    if (att && has('chronic', 'below')) return sql('SELECT COUNT(*) AS value FROM students WHERE attendancePct < 90', 'students with attendance under 90 percent');
    if (att && has('rate', 'percent', 'pct')) return sql(`SELECT ROUND(100.0 * ${ABS} / COUNT(*), 1) AS value FROM attendance a`, 'share of attendance rows marked absent or excused');
    if (att) return sql('SELECT ROUND(AVG(attendancePct), 1) AS value FROM students', 'average attendance percentage');
    if (gpa) return sql('SELECT ROUND(AVG(gpa), 2) AS value FROM students', 'average GPA');
    if (has('school')) return sql("SELECT COUNT(*) AS value FROM orgs WHERE type = 'school'", 'number of schools');
    if (has('staff', 'teacher')) return sql('SELECT COUNT(*) AS value FROM staff', 'number of staff');
    if (byOutcome || has('on track')) return sql("SELECT COUNT(*) AS value FROM students WHERE outcome = 'on-track'", 'students on track');
    if (has('student', 'enrolled', 'kids', 'children')) return sql('SELECT COUNT(*) AS value FROM students', 'number of students in scope');
    return null;
  }
  if (kind === 'bar' || kind === 'line') {
    if (att && overTime) return sql(`SELECT substr(a.date, 1, 7) AS label, ${ABS} AS value FROM attendance a GROUP BY label ORDER BY label`, 'absences per month, in order');
    if (att && bySchool) {
      if (agg) return aggregate('schoolId', 'attendance', 'attendance signal by school, small groups withheld');
      return sql(`SELECT o.name AS label, ROUND(100.0 * ${ABS} / COUNT(*), 1) AS value FROM attendance a JOIN students s ON s.sourcedId = a.studentSourcedId JOIN orgs o ON o.sourcedId = s.schoolSourcedId GROUP BY o.sourcedId ORDER BY value DESC`, 'absence rate by school');
    }
    if (att && byGrade) return agg ? aggregate('grade', 'attendance', 'attendance signal by grade') : sql('SELECT grade AS label, ROUND(AVG(attendancePct), 1) AS value FROM students GROUP BY grade ORDER BY grade', 'average attendance by grade');
    if (gpa && bySchool) return agg ? aggregate('schoolId', 'gpa', 'GPA signal by school') : sql('SELECT o.name AS label, ROUND(AVG(s.gpa), 2) AS value FROM students s JOIN orgs o ON o.sourcedId = s.schoolSourcedId GROUP BY o.sourcedId ORDER BY value DESC', 'average GPA by school');
    if (gpa && byGrade) return agg ? aggregate('grade', 'gpa', 'GPA signal by grade') : sql('SELECT grade AS label, ROUND(AVG(gpa), 2) AS value FROM students GROUP BY grade ORDER BY grade', 'average GPA by grade');
    if (byOutcome) return agg ? aggregate('outcome', 'count', 'students by standing, small groups withheld') : sql('SELECT outcome AS label, COUNT(*) AS value FROM students GROUP BY outcome ORDER BY value DESC', 'students by standing');
    if (has('discipline', 'incident')) return sql('SELECT type AS label, COUNT(*) AS value FROM discipline_incidents GROUP BY type ORDER BY value DESC', 'incidents by type');
    if (has('service', 'iep', '504', 'ell')) return sql('SELECT type AS label, COUNT(*) AS value FROM services GROUP BY type ORDER BY value DESC', 'students by service type');
    if (bySchool) return agg ? aggregate('schoolId', 'count', 'students by school, small groups withheld') : sql('SELECT o.name AS label, COUNT(*) AS value FROM students s JOIN orgs o ON o.sourcedId = s.schoolSourcedId GROUP BY o.sourcedId ORDER BY value DESC', 'students by school');
    if (byGrade || has('grade')) return agg ? aggregate('grade', 'count', 'students by grade') : sql('SELECT grade AS label, COUNT(*) AS value FROM students GROUP BY grade ORDER BY grade', 'students by grade');
    if (own && att) return sql(`SELECT substr(a.date, 1, 7) AS label, ROUND(100.0 * SUM(CASE WHEN a.code = 'present' THEN 1 ELSE 0 END) / COUNT(*), 1) AS value FROM attendance a GROUP BY label ORDER BY label`, 'my attendance per month');
    return null;
  }
  if (kind === 'table') {
    const keys = slot.columns.map((c) => c.key.toLowerCase());
    const want = (k) => keys.includes(k.toLowerCase());
    if (has('work', 'assignment', 'graded', 'score') && (own || mine)) {
      return sql('SELECT li.title AS title, li.dueDate AS dueDate, r.score AS score, li.resultValueMax AS max FROM results r JOIN line_items li ON li.sourcedId = r.lineItemSourcedId ORDER BY li.dueDate DESC LIMIT 50', 'recent scored work in scope');
    }
    if (bySchool && !has('slipping', 'watch', 'risk', 'conversation')) {
      return sql('SELECT o.name AS school, COUNT(s.sourcedId) AS students, ROUND(AVG(s.attendancePct), 1) AS attendance, ROUND(AVG(s.gpa), 2) AS gpa FROM orgs o LEFT JOIN students s ON s.schoolSourcedId = o.sourcedId WHERE o.type = \'school\' GROUP BY o.sourcedId ORDER BY students DESC', 'one row per school');
    }
    if (agg && !mine) return null;
    if (att || has('slipping', 'watch', 'risk', 'conversation')) {
      const abs = want('absences') ? `, (SELECT ${ABS} FROM attendance a WHERE a.studentSourcedId = s.sourcedId) AS absences` : '';
      return sql(`SELECT ${nameCols}s.sourcedId AS id, s.grade AS grade, o.name AS school, s.outcome AS outcome, s.attendancePct AS attendance, s.gpa AS gpa${abs} FROM students s LEFT JOIN orgs o ON o.sourcedId = s.schoolSourcedId WHERE s.attendancePct < 90 OR s.outcome IN ('watch','high-risk','hidden-risk') ORDER BY s.attendancePct ASC LIMIT 200`, 'students in scope whose attendance or standing is worth a conversation');
    }
    if (has('student', 'roster', 'kids')) return sql(`SELECT ${nameCols}s.sourcedId AS id, s.grade AS grade, o.name AS school, s.outcome AS outcome, s.attendancePct AS attendance, s.gpa AS gpa FROM students s LEFT JOIN orgs o ON o.sourcedId = s.schoolSourcedId ORDER BY s.grade, s.sourcedId LIMIT 200`, 'students in scope');
    return null;
  }
  if (kind === 'list') {
    if (has('school')) return sql("SELECT name AS title, level AS subtitle FROM orgs WHERE type = 'school' ORDER BY name", 'schools');
    if (has('class', 'section', 'course')) return sql('SELECT c.title AS title, c.classCode AS subtitle, COUNT(e.sourcedId) AS meta FROM classes c LEFT JOIN enrollments e ON e.classSourcedId = c.sourcedId GROUP BY c.sourcedId ORDER BY c.title', 'classes with enrollment counts');
    if (has('note', 'voice', 'fragment', 'wrote', 'reflection')) return sql('SELECT substr(text, 1, 160) AS title, kind AS subtitle, substr(createdAt, 1, 10) AS meta FROM fragments ORDER BY createdAt DESC LIMIT 50', 'recent notes in scope');
    return null;
  }
  return null;
}
