// Vendor rows -> relational fact rows.
//
// The importer's job used to end at a summary metric ("attendancePct 93.4").
// That threw away the evidence. These builders keep the rows themselves, in
// the OneRoster-shaped fact tables declared by src/core/schema's FACT_TABLES,
// so src/sql/derive.js can recompute a student's metrics from what actually
// happened rather than from a vendor's arithmetic.
//
// Every builder returns a plain row or null. Deciding which students were
// touched, and calling deriveAll afterwards, is the mapper's job.
import { toNumber, toInt, toDate, toAttendanceCode, factId } from './values.js';

/** Which fact tables a given file will write, for the preview pane. */
export function factTablesFor(kind, mapping = {}) {
  switch (kind) {
    case 'students': {
      const out = [];
      if (mapping.guardianName || mapping.guardianEmail || mapping.guardianPhone) out.push('contacts');
      if (mapping.ellLevel || mapping.specialEd || mapping.frl) out.push('services');
      return out;
    }
    case 'attendance': return isAttendanceSummary(mapping) ? [] : ['attendance'];
    case 'grades': return isAssignmentGradebook(mapping) ? ['line_items', 'results'] : [];
    case 'discipline': return ['discipline_incidents'];
    default: return PASSTHROUGH[kind] ? [PASSTHROUGH[kind].table] : [];
  }
}

/**
 * A summary file carries counts per student; a log carries one row per day.
 * A file with both a date and day counts is a monthly summary, so the counts
 * win unless there is also a per-row attendance code.
 */
export function isAttendanceSummary(mapping = {}) {
  const counts = mapping.daysPresent || mapping.daysAbsent || mapping.daysEnrolled || mapping.attendancePct;
  if (counts && !mapping.status) return true;
  return !mapping.date;
}

/** A gradebook names the assignment and scores it; a transcript does not. */
export function isAssignmentGradebook(mapping = {}) {
  return !!(mapping.assignment && (mapping.score || mapping.pointsPossible));
}

// ------------------------------------------------------------- attendance --

export function attendanceRow(v, studentId) {
  const date = v.date ? toDate(v.date) : null;
  if (!date) return null;
  const code = toAttendanceCode(v.status) || 'present';
  const row = { id: factId(studentId, date, v.period), studentSourcedId: studentId, date, code };
  if (v.period) row.period = v.period;
  if (v.classId) row.classSourcedId = v.classId;
  const minutes = toNumber(v.minutes);
  if (minutes !== undefined) row.minutes = minutes;
  if (v.note) row.note = v.note;
  return row;
}

// ------------------------------------------------------------- discipline --

export function disciplineRow(v, studentId, n) {
  const date = v.date ? toDate(v.date) : null;
  const row = {
    id: factId(studentId, date || 'undated', String(n)),
    studentSourcedId: studentId,
    type: v.incidentType || 'incident',
  };
  if (date) row.date = date;
  for (const [from, to] of [['description', 'description'], ['action', 'action'], ['reportedBy', 'reportedBy'], ['schoolId', 'schoolSourcedId']]) {
    if (v[from]) row[to] = v[from];
  }
  return row;
}

// --------------------------------------------------------------- gradebook --

/**
 * One gradebook row becomes a line item (the assignment, shared by every
 * student who was given it) and a result (this student's score on it).
 */
export function gradebookRows(v, studentId) {
  const title = v.assignment;
  if (!title) return null;
  const klass = v.classId || v.course || 'class';
  const lineItemId = factId('LI', klass, title);
  const lineItem = { sourcedId: lineItemId, title, classSourcedId: klass };
  for (const [from, to] of [['category', 'category'], ['assignDate', 'assignDate'], ['dueDate', 'dueDate'], ['term', 'gradingPeriodSourcedId']]) {
    if (v[from]) lineItem[to] = from.endsWith('Date') ? toDate(v[from]) : v[from];
  }
  const max = toNumber(v.pointsPossible);
  const min = toNumber(v.pointsMin);
  lineItem.resultValueMax = max !== undefined ? max : 100;
  lineItem.resultValueMin = min !== undefined ? min : 0;

  const result = { sourcedId: factId('RES', lineItemId, studentId), lineItemSourcedId: lineItemId, studentSourcedId: studentId };
  const score = toNumber(v.score !== undefined ? v.score : v.numericGrade);
  if (score !== undefined) result.score = score;
  result.scoreStatus = scoreStatus(v.scoreStatus, score);
  if (v.scoreDate) result.scoreDate = toDate(v.scoreDate);
  if (v.comment) result.comment = v.comment;
  return { lineItem, result };
}

/** derive.js reads these exact phrases, so normalize to OneRoster's vocabulary. */
function scoreStatus(raw, score) {
  const k = String(raw ?? '').trim().toLowerCase();
  if (/exempt|excused|waived/.test(k)) return 'exempt';
  if (/not submitted|missing|incomplete|no show|absent/.test(k)) return 'not submitted';
  if (/partial/.test(k)) return 'partially graded';
  if (/graded|submitted|turned in|complete|late|on time/.test(k)) return 'fully graded';
  return score === undefined ? 'not submitted' : 'fully graded';
}

// --------------------------------------- services & contacts from a roster --

const RELATIONS = ['mother', 'father', 'guardian', 'parent', 'grandmother', 'grandfather', 'stepmother', 'stepfather', 'aunt', 'uncle', 'foster'];

/** The vendor names its guardian column "Mother"; that is the relationship. */
export function relationFromHeader(header) {
  const k = String(header || '').toLowerCase().replace(/[^a-z]+/g, '');
  return RELATIONS.find((r) => k.includes(r)) || 'guardian';
}

export function contactRows(v, studentId, relation = 'guardian') {
  if (!v.guardianName && !v.guardianEmail && !v.guardianPhone) return [];
  const row = { id: factId(studentId, '1'), studentSourcedId: studentId, relation, isPrimary: 1 };
  if (v.guardianName) row.name = v.guardianName;
  if (v.guardianEmail) row.email = v.guardianEmail;
  if (v.guardianPhone) row.phone = v.guardianPhone;
  return [row];
}

/**
 * The flags a roster carries are services a student receives. Recording them
 * as rows (not only as metrics) is what lets derive.js answer "who is on an
 * IEP" from SQL, and what makes an exit date expressible later.
 */
export function serviceRows(metrics, studentId, frl) {
  const rows = [];
  const add = (type, level) => rows.push({ id: factId(studentId, type), studentSourcedId: studentId, type, level });
  if (metrics.ellLevel) add('ELL', metrics.ellLevel);
  if (metrics.specialEd === '504') add('504', '504');
  else if (metrics.specialEd === 'IEP-partial' || metrics.specialEd === 'IEP-full') add('IEP', metrics.specialEd);
  if (frl === 'free' || frl === 'reduced') add('FRL', frl);
  return rows;
}

// ------------------------------------------- OneRoster relational passthru --

const NUMERIC = new Set(['score', 'resultValueMin', 'resultValueMax', 'isPrimary']);

/** kind -> { table, map: canonicalField -> column, student?: canonical field naming a student }. */
export const PASSTHROUGH = {
  academicSessions: { table: 'academic_sessions', map: { id: 'sourcedId', title: 'title', sessionType: 'type', startDate: 'startDate', endDate: 'endDate', schoolYear: 'schoolYear', parentId: 'parentSourcedId' } },
  courses: { table: 'courses', map: { id: 'sourcedId', title: 'title', courseCode: 'courseCode', orgId: 'orgSourcedId', subjects: 'subjects', grades: 'grades' }, org: ['orgId'] },
  classes: { table: 'classes', map: { id: 'sourcedId', title: 'title', classCode: 'classCode', classType: 'classType', courseId: 'courseSourcedId', schoolId: 'schoolSourcedId', termIds: 'termSourcedIds', periods: 'periods', subjects: 'subjects', grades: 'grades' }, org: ['schoolId'] },
  enrollments: { table: 'enrollments', map: { id: 'sourcedId', classId: 'classSourcedId', userId: 'userSourcedId', role: 'role', isPrimary: 'isPrimary', beginDate: 'beginDate', endDate: 'endDate', schoolId: 'schoolSourcedId' }, user: 'userId', org: ['schoolId'] },
  lineItems: { table: 'line_items', map: { id: 'sourcedId', title: 'title', classId: 'classSourcedId', category: 'category', assignDate: 'assignDate', dueDate: 'dueDate', pointsMin: 'resultValueMin', pointsPossible: 'resultValueMax', gradingPeriodId: 'gradingPeriodSourcedId' } },
  results: { table: 'results', map: { id: 'sourcedId', lineItemId: 'lineItemSourcedId', studentId: 'studentSourcedId', score: 'score', scoreStatus: 'scoreStatus', scoreDate: 'scoreDate', comment: 'comment' }, user: 'studentId' },
};

/**
 * Rename one row's canonical fields onto its fact-table columns. `resolve`
 * remaps a vendor user or org id onto the Librea entity it refers to, so
 * enrollments and results join to the same students the roster created.
 */
export function passthroughRow(kind, v, { resolveUser, resolveOrg } = {}) {
  const spec = PASSTHROUGH[kind];
  if (!spec) return null;
  const row = {};
  for (const [field, col] of Object.entries(spec.map)) {
    let val = v[field];
    if (val === undefined || val === '') continue;
    if (spec.user === field && resolveUser) {
      val = resolveUser(val, v.role);
      if (!val) return null;
    } else if (spec.org?.includes(field) && resolveOrg) {
      val = resolveOrg(val) || val;
    } else if (NUMERIC.has(col)) {
      const n = col === 'isPrimary' ? toInt(val) : toNumber(val);
      if (n === undefined) continue;
      val = n;
    }
    row[col] = val;
  }
  return row.sourcedId ? row : null;
}
