// Reports: the paper a school hands someone. Every one is a CSV a person can
// open without Librea, print, and sign. Nothing here is computed twice — it is
// the projection, laid out the way the asking party wants to read it.
import { today, isWeekday, enrolledStudents, allStaff, nameOf, toCsv, schoolYearLabel, schoolYearStart } from './util.js';

const monthOf = (q) => (/^\d{4}-\d{2}$/.test(String(q?.month || '')) ? q.month : today().slice(0, 7));

/** Every calendar day in a YYYY-MM month. */
function daysOfMonth(month) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

const CODE_LETTER = { present: 'P', absent: 'A', tardy: 'T', excused: 'E', remote: 'R', unexcused: 'A' };
const letter = (code) => CODE_LETTER[String(code || '').toLowerCase()] || (code ? String(code)[0].toUpperCase() : '');

const report = (r) => ({ params: [], ...r });

export const REPORTS = [
  report({
    id: 'attendance-register', title: 'Attendance register', params: ['month'],
    why: 'The month-by-month register a state reviewer or a truancy officer asks to see.',
    generate(db, q) {
      const month = monthOf(q);
      const days = daysOfMonth(month).filter(isWeekday);
      const students = enrolledStudents(db);
      const rows = db.prepare('SELECT studentSourcedId AS id, date, code FROM attendance WHERE date >= ? AND date <= ?').all(month + '-01', month + '-31');
      const by = new Map();
      for (const r of rows) by.set(r.id + '|' + String(r.date).slice(0, 10), r.code);
      const head = ['studentId', 'student', 'grade', ...days.map((d) => d.slice(8)), 'present', 'absent', 'recorded', 'ofSchoolDays'];
      const out = students.map((s) => {
        const cells = days.map((d) => letter(by.get(s.id + '|' + d)));
        const n = (ch) => cells.filter((c) => c === ch).length;
        return [s.id, nameOf(s), s.grade, ...cells, n('P') + n('R'), n('A'), cells.filter(Boolean).length, days.length];
      });
      return { filename: `attendance-register-${month}.csv`, csv: toCsv(head, out) };
    },
  }),
  report({
    id: 'enrollment-roster', title: 'Enrollment roster',
    why: 'Who is enrolled today, when they arrived, and what happened to everyone who left.',
    generate(db) {
      const head = ['studentId', 'student', 'grade', 'school', 'enrollStatus', 'firstEvent', 'firstDate', 'lastEvent', 'lastDate', 'lastReason', 'nextSchool'];
      const orgs = new Map(db.prepare('SELECT sourcedId, name FROM orgs').all().map((o) => [o.sourcedId, o.name]));
      const students = db.prepare('SELECT sourcedId AS id, givenName, familyName, grade, schoolSourcedId, enrollStatus FROM students ORDER BY grade, familyName, givenName').all();
      const events = db.prepare('SELECT * FROM enrollment_events ORDER BY date').all();
      const by = new Map();
      for (const e of events) by.set(e.studentSourcedId, [...(by.get(e.studentSourcedId) || []), e]);
      const rows = students.map((s) => {
        const evs = by.get(s.id) || [];
        const first = evs[0] || {}, last = evs[evs.length - 1] || {};
        return [s.id, nameOf(s), s.grade, orgs.get(s.schoolSourcedId) || s.schoolSourcedId, s.enrollStatus, first.event, first.date, last.event, last.date, last.reason, last.nextSchool];
      });
      return { filename: 'enrollment-roster.csv', csv: toCsv(head, rows) };
    },
  }),
  report({
    id: 'immunization-status', title: 'Immunization status',
    why: 'The list a public-health nurse works through, one line per student with what is on file.',
    generate(db, q) {
      const head = ['studentId', 'student', 'grade', 'status', 'exemption', 'vaccines', 'lastDate', 'verifiedBy'];
      const students = enrolledStudents(db);
      const recs = db.prepare('SELECT * FROM immunizations ORDER BY date').all();
      const by = new Map();
      for (const r of recs) by.set(r.studentSourcedId, [...(by.get(r.studentSourcedId) || []), r]);
      const rows = students.map((s) => {
        const rs = by.get(s.id) || [];
        const exempt = rs.map((r) => r.exemption).find((e) => e && e !== 'none') || '';
        const vaccines = [...new Set(rs.map((r) => r.vaccine).filter(Boolean))].join('|');
        const status = exempt ? 'exempt' : rs.length ? 'on file' : 'missing';
        return [s.id, nameOf(s), s.grade, status, exempt, vaccines, rs.map((r) => r.date).filter(Boolean).pop() || '', rs.map((r) => r.verifiedBy).filter(Boolean).pop() || ''];
      });
      return { filename: 'immunization-status.csv', csv: toCsv(head, rows) };
    },
  }),
  report({
    id: 'staff-credentials', title: 'Staff credentials',
    why: 'One page that shows every adult in the building is cleared, trained, and current.',
    generate(db, q) {
      const on = q?.on || today();
      const head = ['staffId', 'staff', 'role', 'credential', 'status', 'issued', 'expires', 'issuer', 'current'];
      const staff = new Map(allStaff(db).map((s) => [s.id, s]));
      const creds = db.prepare('SELECT * FROM staff_credentials ORDER BY staffSourcedId, type').all();
      const rows = creds.map((c) => {
        const s = staff.get(c.staffSourcedId) || {};
        const current = String(c.status || '').toLowerCase() === 'valid' && (!c.expiresDate || c.expiresDate >= on);
        return [c.staffSourcedId, nameOf({ ...s, id: c.staffSourcedId }), s.role, c.type, c.status, c.issuedDate, c.expiresDate, c.issuer, current ? 'yes' : 'no'];
      });
      for (const s of staff.values()) if (!creds.some((c) => c.staffSourcedId === s.id)) rows.push([s.id, nameOf(s), s.role, '(none on file)', 'missing', '', '', '', 'no']);
      return { filename: 'staff-credentials.csv', csv: toCsv(head, rows) };
    },
  }),
  report({
    id: 'learning-plan-calendar', title: 'Learning plan review calendar',
    why: 'Every plan review, soonest first, so no family finds out afterwards that theirs was missed.',
    generate(db, q) {
      const on = q?.on || today();
      const head = ['reviewDate', 'overdue', 'planId', 'type', 'title', 'status', 'studentId', 'student', 'grade', 'owner'];
      const rows = db.prepare(`SELECT p.*, s.givenName, s.familyName, s.grade FROM learning_plans p
        LEFT JOIN students s ON s.sourcedId = p.studentSourcedId
        WHERE (p.status IS NULL OR lower(p.status) != 'closed')
        ORDER BY (p.reviewDate IS NULL), p.reviewDate`).all()
        .map((p) => [p.reviewDate, p.reviewDate && p.reviewDate < on ? 'yes' : 'no', p.id, p.type, p.title, p.status, p.studentSourcedId, nameOf({ givenName: p.givenName, familyName: p.familyName, id: p.studentSourcedId }), p.grade, p.owner]);
      return { filename: 'learning-plan-calendar.csv', csv: toCsv(head, rows) };
    },
  }),
  report({
    id: 'incident-log', title: 'Incident log', params: ['from', 'to'],
    why: 'The behavior record with the response beside it, which is the only form of it worth having.',
    generate(db, q) {
      const from = /^\d{4}-\d{2}-\d{2}$/.test(String(q?.from || '')) ? q.from : schoolYearStart();
      const to = /^\d{4}-\d{2}-\d{2}$/.test(String(q?.to || '')) ? q.to : today();
      const head = ['date', 'incidentId', 'studentId', 'student', 'grade', 'type', 'description', 'action', 'reportedBy', 'school'];
      const rows = db.prepare(`SELECT i.*, s.givenName, s.familyName, s.grade FROM discipline_incidents i
        LEFT JOIN students s ON s.sourcedId = i.studentSourcedId
        WHERE i.date >= ? AND i.date <= ? ORDER BY i.date`).all(from, to)
        .map((i) => [i.date, i.id, i.studentSourcedId, nameOf({ givenName: i.givenName, familyName: i.familyName, id: i.studentSourcedId }), i.grade, i.type, i.description, i.action || '(none recorded)', i.reportedBy, i.schoolSourcedId]);
      return { filename: `incident-log-${from}-to-${to}.csv`, csv: toCsv(head, rows) };
    },
  }),
  report({
    id: 'affidavit-datasheet', title: 'Affidavit datasheet',
    why: 'Every number a private-school affidavit or annual registration asks for, gathered on one sheet.',
    generate(db, q) {
      const on = q?.on || today();
      const head = ['section', 'key', 'value'];
      const rows = [];
      const orgs = db.prepare('SELECT * FROM orgs').all();
      rows.push(['school-year', 'label', schoolYearLabel(on)], ['school-year', 'startedOn', schoolYearStart(on)], ['school-year', 'preparedOn', on]);
      for (const o of orgs) {
        rows.push(['organization', 'sourcedId', o.sourcedId], ['organization', 'name', o.name || '(missing)'], ['organization', 'type', o.type], ['organization', 'level', o.level || ''], ['organization', 'identifier', o.identifier || '']);
        const docs = db.prepare("SELECT type, title, status, issuedDate, expiresDate FROM documents WHERE subjectType = 'organization' AND subjectSourcedId = ? ORDER BY issuedDate").all(o.sourcedId);
        for (const d of docs) rows.push(['organization-document', `${d.type || 'document'}${d.title ? ' — ' + d.title : ''}`, `${d.status || ''}${d.expiresDate ? ' until ' + d.expiresDate : ''}`]);
      }
      const students = enrolledStudents(db);
      const byGrade = new Map();
      for (const s of students) { const g = s.grade == null ? 'ungraded' : String(s.grade); byGrade.set(g, (byGrade.get(g) || 0) + 1); }
      for (const g of [...byGrade.keys()].sort((a, b) => Number(a) - Number(b) || String(a).localeCompare(String(b)))) rows.push(['enrollment-by-grade', `grade ${g}`, byGrade.get(g)]);
      rows.push(['enrollment-by-grade', 'total', students.length]);
      const staff = allStaff(db);
      for (const s of staff) rows.push(['staff', nameOf(s), s.role || 'staff']);
      rows.push(['staff', 'total', staff.length]);
      rows.push(['ratio', 'students-per-adult', staff.length ? Math.round((students.length / staff.length) * 10) / 10 : 'no adults on record']);
      return { filename: `affidavit-datasheet-${schoolYearLabel(on)}.csv`, csv: toCsv(head, rows) };
    },
  }),
  report({
    id: 'ada-summary', title: 'ADA summary', params: ['month'],
    why: 'Days enrolled against days present per student per month: the arithmetic funding is calculated from.',
    generate(db, q) {
      const only = /^\d{4}-\d{2}$/.test(String(q?.month || '')) ? q.month : null;
      const head = ['month', 'studentId', 'student', 'grade', 'schoolDays', 'daysRecorded', 'daysPresent', 'daysAbsent', 'apportionmentRate'];
      const args = only ? [only + '-01', only + '-31'] : ['0000-01-01', '9999-12-31'];
      const rows = db.prepare('SELECT studentSourcedId AS id, date, code FROM attendance WHERE date >= ? AND date <= ?').all(...args)
        .filter((r) => r.date && isWeekday(String(r.date).slice(0, 10)));
      const months = [...new Set(rows.map((r) => String(r.date).slice(0, 7)))].sort();
      const schoolDaysIn = new Map(months.map((m) => [m, new Set(rows.filter((r) => String(r.date).startsWith(m)).map((r) => String(r.date).slice(0, 10))).size]));
      const students = enrolledStudents(db);
      const names = new Map(students.map((s) => [s.id, s]));
      const out = [];
      for (const m of months) {
        const inMonth = rows.filter((r) => String(r.date).startsWith(m));
        for (const s of students) {
          const mine = inMonth.filter((r) => r.id === s.id);
          const present = mine.filter((r) => ['present', 'tardy', 'remote', 'excused'].includes(String(r.code || '').toLowerCase())).length;
          const absent = mine.length - present;
          const sd = schoolDaysIn.get(m) || 0;
          out.push([m, s.id, nameOf(names.get(s.id) || s), s.grade, sd, mine.length, present, absent, sd ? Math.round((present / sd) * 1000) / 1000 : '']);
        }
      }
      return { filename: `ada-summary-${only || 'all-months'}.csv`, csv: toCsv(head, out) };
    },
  }),
];

export const listReports = () => REPORTS.map((r) => ({ id: r.id, title: r.title, why: r.why, params: r.params, path: `/api/compliance/reports/${r.id}.csv` }));
export const getReport = (id) => REPORTS.find((r) => r.id === id) || null;
