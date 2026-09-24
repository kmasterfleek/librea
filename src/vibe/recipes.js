// Data recipes: the menu a design model chooses from. The model never sees a
// table or a column; it picks a recipe id and parameters. The server turns the
// recipe into scoped SQL here, on the district's own machine.
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const lim = (p, d = 20) => Math.max(1, Math.min(200, Number(p?.limit) || d));
// A design model names schools the way people do; accept an id or a name (case-insensitive).
const schoolWhere = (p, col = 's.schoolSourcedId') => {
  if (!p?.school) return '';
  const v = q(String(p.school).trim());
  // exact id, exact name, or a name that contains the words given ("Duarte High" -> "Duarte High School")
  return ` AND (${col} = ${v} OR ${col} IN (SELECT sourcedId FROM orgs WHERE lower(name) = lower(${v}) OR lower(name) LIKE '%' || lower(${v}) || '%'))`;
};
const KINDS = ['record', 'observation', 'self', 'family', 'artifact', 'photo', 'note'];
const kindWhere = (p) => (p?.kind && KINDS.includes(String(p.kind)) ? ` AND f.kind = ${q(p.kind)}` : '');
const gradeWhere = (p, col = 's.grade') => (p?.grade != null && p.grade !== '' ? ` AND ${col} = ${Number(p.grade)}` : '');

/**
 * Each recipe: id, kind (stat|bar|line|table|list), describe (plain words for
 * the design model), params (documented), sql(params) -> SQL against the
 * scoped views. Column order matters: charts use column 1 as label, 2 as value.
 */
export const RECIPES = {
  'students.count': { kind: 'stat', describe: 'How many students are enrolled (optionally in one school or grade).', params: 'school? (name or id), grade?', sql: (p) => `SELECT count(*) AS students FROM students s WHERE 1=1${schoolWhere(p)}${gradeWhere(p)}` },
  'students.by_school': { kind: 'bar', describe: 'Students per school.', params: '', sql: () => `SELECT o.name AS school, count(*) AS students FROM students s JOIN orgs o ON o.sourcedId = s.schoolSourcedId GROUP BY o.name ORDER BY students DESC` },
  'students.by_grade': { kind: 'bar', describe: 'Students per grade.', params: 'school?', sql: (p) => `SELECT CASE s.grade WHEN 0 THEN 'K' WHEN -1 THEN 'PK' ELSE 'Grade ' || s.grade END AS grade, count(*) AS students FROM students s WHERE 1=1${schoolWhere(p)} GROUP BY s.grade ORDER BY s.grade` },
  'students.by_outcome': { kind: 'bar', describe: 'Students by outcome label (on-track, watch, high-risk, resilient, hidden-risk, intervention-success).', params: 'school?, grade?', sql: (p) => `SELECT coalesce(s.outcome,'unknown') AS outcome, count(*) AS students FROM students s WHERE 1=1${schoolWhere(p)}${gradeWhere(p)} GROUP BY s.outcome ORDER BY students DESC` },
  'students.flagged': { kind: 'table', describe: 'Students carrying a given pattern flag (chronicAbsent, highDiscipline, decliningGrades, resilient, hiddenRisk) with grade, school, attendance and GPA. No names unless the app is allowed them.', params: 'flag, school?, limit?', sql: (p) => `SELECT s.sourcedId AS id, s.grade, o.name AS school, s.attendancePct, s.gpa, s.outcome FROM students s LEFT JOIN orgs o ON o.sourcedId = s.schoolSourcedId WHERE s.flags LIKE ${q('%' + String(p?.flag || 'chronicAbsent') + '%')}${schoolWhere(p)} ORDER BY s.attendancePct LIMIT ${lim(p)}` },
  'attendance.rate_by_school': { kind: 'bar', describe: 'Attendance rate (percent present) per school, from daily attendance rows.', params: '', sql: () => `SELECT o.name AS school, round(100.0 * sum(a.code IN ('present','tardy','remote')) / count(*), 1) AS attendance_pct FROM attendance a JOIN students s ON s.sourcedId = a.studentSourcedId JOIN orgs o ON o.sourcedId = s.schoolSourcedId GROUP BY o.name ORDER BY attendance_pct` },
  'attendance.absence_rate_by_school': { kind: 'bar', describe: 'Absence rate (absent plus excused) per school.', params: '', sql: () => `SELECT o.name AS school, round(100.0 * sum(a.code IN ('absent','excused')) / count(*), 1) AS absence_pct FROM attendance a JOIN students s ON s.sourcedId = a.studentSourcedId JOIN orgs o ON o.sourcedId = s.schoolSourcedId GROUP BY o.name ORDER BY absence_pct DESC` },
  'attendance.rate_by_month': { kind: 'line', describe: 'Attendance rate by month across the district (or one school).', params: 'school?', sql: (p) => `SELECT substr(a.date,1,7) AS month, round(100.0 * sum(a.code IN ('present','tardy','remote')) / count(*), 1) AS attendance_pct FROM attendance a JOIN students s ON s.sourcedId = a.studentSourcedId WHERE 1=1${schoolWhere(p)} GROUP BY month ORDER BY month` },
  'attendance.lowest_students': { kind: 'table', describe: 'The students with the most absences: id, grade, school, absences.', params: 'school?, limit?', sql: (p) => `SELECT s.sourcedId AS id, s.grade, o.name AS school, sum(a.code IN ('absent','excused')) AS absences FROM attendance a JOIN students s ON s.sourcedId = a.studentSourcedId LEFT JOIN orgs o ON o.sourcedId = s.schoolSourcedId WHERE 1=1${schoolWhere(p)} GROUP BY s.sourcedId ORDER BY absences DESC LIMIT ${lim(p)}` },
  'incidents.by_type': { kind: 'bar', describe: 'Discipline incidents by type.', params: 'school?', sql: (p) => `SELECT d.type, count(*) AS incidents FROM discipline_incidents d JOIN students s ON s.sourcedId = d.studentSourcedId WHERE 1=1${schoolWhere(p)} GROUP BY d.type ORDER BY incidents DESC` },
  'incidents.by_month': { kind: 'line', describe: 'Discipline incidents per month.', params: 'school?', sql: (p) => `SELECT substr(d.date,1,7) AS month, count(*) AS incidents FROM discipline_incidents d JOIN students s ON s.sourcedId = d.studentSourcedId WHERE 1=1${schoolWhere(p)} GROUP BY month ORDER BY month` },
  'enrollment.transfers_out': { kind: 'bar', describe: 'Students who transferred out this year, by destination district or school.', params: '', sql: () => `SELECT coalesce(e.nextSchool,'unknown') AS destination, count(*) AS students FROM enrollment_events e WHERE e.event = 'transferred' GROUP BY destination ORDER BY students DESC` },
  'enrollment.net_by_month': { kind: 'line', describe: 'Net enrollment movement per month (arrivals minus departures).', params: '', sql: () => `SELECT substr(e.date,1,7) AS month, sum(e.event IN ('enrolled','re-enrolled') AND e.reason LIKE 'transferred in%') - sum(e.event IN ('transferred','withdrawn')) AS net FROM enrollment_events e WHERE e.date >= '2025-08-01' GROUP BY month ORDER BY month` },
  'enrollment.reasons': { kind: 'table', describe: 'Reasons recorded when families left.', params: '', sql: () => `SELECT e.reason, count(*) AS families FROM enrollment_events e WHERE e.event = 'transferred' GROUP BY e.reason ORDER BY families DESC` },
  'plans.due': { kind: 'table', describe: 'Learning plans (IEP, 504, ILP, BSP, transition) with the soonest review dates, overdue first.', params: 'type?, limit?', sql: (p) => `SELECT p.studentSourcedId AS id, p.type, p.title, p.reviewDate, p.owner FROM learning_plans p WHERE p.status = 'active'${p?.type ? ` AND p.type = ${q(p.type)}` : ''} ORDER BY p.reviewDate LIMIT ${lim(p)}` },
  'services.by_type': { kind: 'bar', describe: 'Students receiving each service (IEP, 504, ELL, FRL, counseling).', params: '', sql: () => `SELECT sv.type, count(distinct sv.studentSourcedId) AS students FROM services sv GROUP BY sv.type ORDER BY students DESC` },
  'credits.by_grade': { kind: 'bar', describe: 'Average credits earned per student by grade (from credit-bearing results).', params: '', sql: () => `SELECT 'Grade ' || s.grade AS grade, round(avg(t.credits), 1) AS avg_credits FROM (SELECT r.studentSourcedId, sum(r.score) AS credits FROM results r JOIN line_items li ON li.sourcedId = r.lineItemSourcedId WHERE li.category = 'credit' GROUP BY r.studentSourcedId) t JOIN students s ON s.sourcedId = t.studentSourcedId GROUP BY s.grade ORDER BY s.grade` },
  'fragments.recent': { kind: 'list', describe: 'The most recent things written about or by students, as text. kind is one of: observation (staff), self (student), family, note (staff-only), artifact (student work), record (imported summary); omit kind for all.', params: 'kind?, limit?', sql: (p) => `SELECT f.text FROM fragments f WHERE 1=1${kindWhere(p)} ORDER BY f.createdAt DESC LIMIT ${lim(p, 10)}` },
  'artifacts.by_grade': { kind: 'bar', describe: 'Portfolio artifacts (student work) by grade.', params: '', sql: () => `SELECT 'Grade ' || s.grade AS grade, count(*) AS artifacts FROM fragments f JOIN students s ON s.sourcedId = f.entityId WHERE f.kind = 'artifact' GROUP BY s.grade ORDER BY s.grade` },
  'projects.by_department': { kind: 'bar', describe: 'Civic or project-based work grouped by partner department (from artifact fragments tagged [Department]).', params: '', sql: () => `SELECT substr(f.text, instr(f.text,'[')+1, instr(f.text,']')-instr(f.text,'[')-1) AS department, count(*) AS projects FROM fragments f WHERE f.kind = 'artifact' AND f.text LIKE '%[%]%' GROUP BY department ORDER BY projects DESC` },
  'me.attendance': { kind: 'table', describe: 'The viewer\'s own attendance rows (or their children\'s): date, code.', params: 'limit?', sql: (p) => `SELECT a.studentSourcedId AS id, a.date, a.code FROM attendance a ORDER BY a.date DESC LIMIT ${lim(p, 30)}` },
  'me.results': { kind: 'table', describe: 'The viewer\'s own assignment results: assignment, score, status.', params: 'limit?', sql: (p) => `SELECT r.studentSourcedId AS id, li.title AS assignment, r.score, li.resultValueMax AS out_of, r.scoreStatus FROM results r LEFT JOIN line_items li ON li.sourcedId = r.lineItemSourcedId ORDER BY r.scoreDate DESC LIMIT ${lim(p, 30)}` },
  'me.fragments': { kind: 'list', describe: 'What has been written about or by the viewer (own record only).', params: 'limit?', sql: (p) => `SELECT f.text FROM fragments f ORDER BY f.createdAt DESC LIMIT ${lim(p, 10)}` },
  'me.metrics': { kind: 'table', describe: 'The viewer\'s own headline numbers: grade, attendance, GPA, outcome.', params: '', sql: () => `SELECT s.sourcedId AS id, s.grade, s.attendancePct, s.gpa, s.outcome FROM students s` },
};

/** The menu the design model sees: ids, kinds, plain descriptions, params. Nothing about tables. */
export function menuFor(scope = {}) {
  // Students and families design over their own records; staff (even caseload-scoped) get the full menu, row-filtered by the broker.
  const own = ['student', 'family'].includes(scope.role);
  return Object.entries(RECIPES)
    .filter(([id]) => (own ? id.startsWith('me.') || ['students.count', 'fragments.recent'].includes(id) : true))
    .map(([id, r]) => ({ id, kind: r.kind, describe: r.describe, params: r.params }));
}

/** Resolve a recipe + params to SQL, or throw. */
export function recipeSql(id, params = {}) {
  const r = RECIPES[id];
  if (!r) throw new Error(`unknown recipe: ${id}`);
  return { sql: r.sql(params || {}), kind: r.kind };
}
