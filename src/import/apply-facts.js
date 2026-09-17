// The importers that emit relational facts.
//
// Kept apart from mapper.js so neither file outgrows the 500-line limit, and
// deliberately one-directional: everything these handlers need arrives on the
// ctx object the mapper builds, so there is no import cycle between the two.
import {
  attendanceRow, disciplineRow, gradebookRows, passthroughRow,
  isAttendanceSummary, isAssignmentGradebook, PASSTHROUGH,
} from './facts.js';
import { toNumber, toPercent, toGpa, toPresence } from './values.js';

// derive.js counts a tardy or a remote day as present, and an excused absence
// as an absence. Mirror that here so the fallback metric and the derived one
// never disagree.
const PRESENT_CODES = new Set(['present', 'tardy', 'remote']);
const RIGOR_RE = /\b(ap|ib|honors|honor|advanced|adv|dual|gate|accelerated)\b/i;

export function applyAttendance(rows, ctx) {
  if (isAttendanceSummary(ctx.mapping)) return attendanceSummary(rows, ctx);
  if (!ctx.mapping.status) ctx.result.warnings.push('no attendance code column; every row was recorded as present');
  for (const [entityId, items] of ctx.groupByStudent(rows)) {
    let present = 0;
    let counted = 0;
    for (const { v, line } of items) {
      const row = attendanceRow(v, entityId);
      if (!row) { ctx.fail(line, 'attendance row has no readable date'); continue; }
      ctx.pushFact('attendance', row);
      counted++;
      if (PRESENT_CODES.has(row.code)) present++;
    }
    if (!counted) continue;
    ctx.touched.add(entityId);
    ctx.writeMetrics(entityId, { attendancePct: +((present / counted) * 100).toFixed(1) });
  }
}

/** The older shape: one row per student carrying day counts or a percentage. */
function attendanceSummary(rows, ctx) {
  for (const [entityId, items] of ctx.groupByStudent(rows)) {
    let pctSum = 0; let pctN = 0;
    let present = 0; let absent = 0; let enrolled = 0;
    let codePresent = 0; let codeTotal = 0;
    for (const { v } of items) {
      const pct = toPercent(v.attendancePct);
      if (pct !== undefined) { pctSum += pct; pctN++; }
      present += toNumber(v.daysPresent) || 0;
      absent += toNumber(v.daysAbsent) || 0;
      enrolled += toNumber(v.daysEnrolled) || 0;
      const p = toPresence(v.status);
      if (p !== undefined) { codeTotal++; if (p) codePresent++; }
    }
    let pct;
    if (pctN) pct = pctSum / pctN;
    else if (enrolled > 0) pct = (present || enrolled - absent) / enrolled * 100;
    else if (present + absent > 0) pct = (present / (present + absent)) * 100;
    else if (codeTotal) pct = (codePresent / codeTotal) * 100;
    if (pct === undefined) { ctx.fail(items[0].line, 'no readable attendance values for this student'); continue; }
    ctx.writeMetrics(entityId, { attendancePct: Math.min(100, Math.max(0, +pct.toFixed(1))) });
  }
}

export function applyGrades(rows, ctx) {
  if (isAssignmentGradebook(ctx.mapping)) return gradebook(rows, ctx);
  return transcript(rows, ctx);
}

/** Per-assignment rows: keep the assignment and the score, not just an average. */
function gradebook(rows, ctx) {
  for (const [entityId, items] of ctx.groupByStudent(rows)) {
    let n = 0;
    for (const { v, line } of items) {
      const built = gradebookRows(v, entityId);
      if (!built) { ctx.fail(line, 'gradebook row has no assignment title'); continue; }
      ctx.pushFact('line_items', built.lineItem);
      ctx.pushFact('results', built.result);
      n++;
    }
    if (!n) continue;
    ctx.touched.add(entityId);
    ctx.countWrite(entityId, true);
  }
}

/** Term or transcript rows: a letter per course, so a GPA is all there is. */
function transcript(rows, ctx) {
  const hasTerm = !!ctx.mapping.term;
  for (const [entityId, items] of ctx.groupByStudent(rows)) {
    let points = 0; let weight = 0; let rigor = 0; let courses = 0;
    const terms = new Map();
    for (const { v } of items) {
      const gpa = v.letterGrade !== undefined ? toGpa(v.letterGrade) : toGpa(v.numericGrade);
      if (v.course) { courses++; if (RIGOR_RE.test(v.course)) rigor++; }
      if (gpa === undefined) continue;
      const credits = toNumber(v.credits) ?? 1;
      const w = credits > 0 ? credits : 1;
      points += gpa * w; weight += w;
      if (hasTerm && v.term) {
        if (!terms.has(v.term)) terms.set(v.term, { sum: 0, n: 0 });
        const t = terms.get(v.term); t.sum += gpa; t.n++;
      }
    }
    const metrics = {};
    if (weight > 0) metrics.gpa = +Math.min(4, points / weight).toFixed(2);
    if (courses > 0) metrics.courseRigor = +(rigor / courses).toFixed(2);
    if (terms.size >= 2) {
      const keys = [...terms.keys()].sort();
      const first = terms.get(keys[0]);
      const last = terms.get(keys[keys.length - 1]);
      metrics.trajectory = +Math.min(1, Math.max(-1, (last.sum / last.n - first.sum / first.n) / 2)).toFixed(2);
    }
    if (!ctx.writeMetrics(entityId, metrics)) ctx.fail(items[0].line, 'no readable grades for this student');
  }
}

export function applyDiscipline(rows, ctx) {
  for (const [entityId, items] of ctx.groupByStudent(rows)) {
    let n = 0;
    for (const { v } of items) ctx.pushFact('discipline_incidents', disciplineRow(v, entityId, ++n));
    if (!n) continue;
    ctx.touched.add(entityId);
    ctx.writeMetrics(entityId, { disciplineIncidents: n });
  }
}

/**
 * OneRoster's relational files map onto fact tables almost column for column.
 * The work is remapping the vendor's user and org ids onto the entities the
 * roster import created, so these rows join to real students.
 */
export function applyPassthrough(kind) {
  return (rows, ctx) => {
    const spec = PASSTHROUGH[kind];
    const studentCol = spec.user === 'studentId' ? 'studentSourcedId' : 'userSourcedId';
    for (const row of rows) {
      const line = row.__line;
      const v = ctx.mapRow(row);
      if (!v.id) { ctx.fail(line, 'row has no sourcedId'); continue; }
      const built = passthroughRow(kind, v, { resolveUser: ctx.resolveUser, resolveOrg: ctx.resolveOrg });
      if (!built) { ctx.fail(line, `row references a user this district does not have: ${v[spec.user] || ''}`); continue; }
      ctx.pushFact(spec.table, built);
      if (spec.user && ctx.store.getEntity(built[studentCol])?.type === 'student') ctx.touched.add(built[studentCol]);
    }
    for (const id of ctx.touched) ctx.countWrite(id, true);
  };
}
