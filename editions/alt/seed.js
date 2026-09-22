// Librea Alt demo seed: Eastside Continuation & Independent Study.
// 140 students, grades 8-12, high mobility, heavy plan and behavior-support
// work, credits toward graduation as the central number, attendance tied to
// ADA funding. Everything here is synthetic and deterministic given the
// anchor date (LIBREA_SEED_TODAY, default: today).
//
//   LIBREA_DATA=/tmp/x LIBREA_EDITION=alt node editions/alt/seed.js
//
// Wipes the data dir first unless --keep.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../../src/core/store.js';
import { Auth } from '../../src/core/auth.js';
import { SqlProjection } from '../../src/sql/projection.js';
import { installApps } from './seed-apps.js';
import * as D from './seed-data.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const dataDir = process.env.LIBREA_DATA || path.join(ROOT, 'data');
const keep = process.argv.includes('--keep');
const t0 = Date.now();

// ---------------------------------------------------------------- determinism
/** mulberry32: same seed, same school, every run. */
function rngFor(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rnd = rngFor(20260122);
const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];
const chance = (r, p) => r() < p;

// ---------------------------------------------------------------- dates
const TODAY = new Date((process.env.LIBREA_SEED_TODAY || new Date().toISOString().slice(0, 10)) + 'T12:00:00Z');
const iso = (d) => d.toISOString().slice(0, 10);
const shift = (d, days) => new Date(d.getTime() + days * 86400000);
const ago = (days) => iso(shift(TODAY, -days));
const ahead = (days) => iso(shift(TODAY, days));
const isWeekend = (d) => d.getUTCDay() === 0 || d.getUTCDay() === 6;

const AY = TODAY.getUTCMonth() >= 7 ? TODAY.getUTCFullYear() : TODAY.getUTCFullYear() - 1; // Aug starts the year
const yearStart = `${AY}-08-18`;

/**
 * The last `n` weekdays up to and including today, oldest first, never reaching
 * back past the first day of school. Early in the year there simply are not 30
 * school days yet, and inventing them would make every student who enrolled on
 * day one look like they were absent for a week.
 */
function schoolDays(n) {
  const out = [];
  let d = new Date(TODAY);
  while (out.length < n && iso(d) >= yearStart) { if (!isWeekend(d)) out.push(iso(d)); d = shift(d, -1); }
  return out.reverse();
}
const DAYS = schoolDays(30);

/** Term k back from the current one (0 = current fall). */
function term(k) {
  const fall = k % 2 === 0;
  const cy = AY - Math.floor(k / 2);
  return fall
    ? { id: `TRM-${cy}F`, title: `Fall ${cy}`, start: `${cy}-08-18`, end: `${cy}-12-19`, schoolYear: `${cy}-${cy + 1}` }
    : { id: `TRM-${cy}S`, title: `Spring ${cy}`, start: `${cy}-01-12`, end: `${cy}-06-05`, schoolYear: `${cy - 1}-${cy}` };
}
const PRIOR_TERMS = { 8: 0, 9: 0, 10: 2, 11: 4, 12: 6 };

// ---------------------------------------------------------------- open
if (!keep) for (const f of ['ledger.jsonl', 'vectors.db', 'snapshot.json', 'users.json', 'invites.json', 'librea.sqlite', 'librea.sqlite-wal', 'librea.sqlite-shm', 'apps']) fs.rmSync(path.join(dataDir, f), { force: true, recursive: true });

const sql = new SqlProjection(dataDir).open();
const store = await new Store(dataDir).attach(sql).open();
const auth = new Auth(dataDir);
const SCHOOL = 'SCH-EASTSIDE';

store.upsertEntity({ id: SCHOOL, type: 'school', name: 'Eastside Continuation & Independent Study', level: 'high', grades: '8-12', capacity: 200, authorizer: 'Eastside Unified School District', county: 'Valle County Office of Education' }, 'seed');

// ---------------------------------------------------------------- staff
const staff = D.STAFF.map((s, i) => ({ ...s, id: `STF-${String(i + 1).padStart(2, '0')}`, username: `${s.first}.${s.last}`.toLowerCase(), email: `${s.first}.${s.last}`.toLowerCase() + '@eastside.example' }));
for (const s of staff) store.upsertEntity({ id: s.id, type: 'staff', firstName: s.first, lastName: s.last, role: s.role, title: s.title, email: s.email, schoolId: SCHOOL }, 'seed');
const advisors = staff.filter((s) => s.role === 'teacher');
const caseManager = staff.find((s) => s.title.startsWith('Case Manager'));
const counselor = staff.find((s) => s.title === 'School Counselor');
const director = staff.find((s) => s.role === 'principal');

const creds = [];
staff.forEach((s, i) => {
  for (const c of D.CRED_TYPES) {
    if (c.type === 'credential' && s.role !== 'teacher') continue;
    const expired = i === 4 && c.type === 'cpr-first-aid'; // the attendance clerk's CPR card lapsed
    creds.push({ id: `${s.id}-${c.type}`, staffSourcedId: s.id, type: c.title, status: expired ? 'expired' : 'valid', issuedDate: ago(expired ? 800 : 300 + i * 7), expiresDate: expired ? ago(70) : ahead(400 - i * 9), issuer: c.type === 'credential' ? 'State Commission on Teacher Credentialing' : 'Valle County Office of Education' });
  }
});
store.upsertFacts('staff_credentials', creds, 'seed');

// ---------------------------------------------------------------- students
const GRADE_MIX = [[8, 4], [9, 28], [10, 34], [11, 36], [12, 38]];
const profiles = [];
let n = 0;
for (const [grade, count] of GRADE_MIX) {
  for (let i = 0; i < count; i++) {
    n++;
    const r = rngFor(1000 + n * 97);
    const first = FIRSTat(n), last = LASTat(n);
    const advisor = advisors[n % advisors.length];
    const mobility = r();
    // When did this student arrive? Continuation schools take students all year.
    let enrollDate = yearStart, arrival = 'year-start';
    if (mobility > 0.82) { enrollDate = weekdayAgo(Math.floor(5 + r() * 80)); arrival = 'mid-year'; }
    else if (mobility < 0.18 && grade >= 10) { enrollDate = `${AY - 1}-08-18`; arrival = 'continuing'; }
    const p = {
      id: `STU-${String(n).padStart(3, '0')}`, first, last, grade, advisor, r,
      dob: iso(shift(TODAY, -(grade + 5) * 365 - Math.floor(r() * 340))),
      enrollDate, arrival,
      age18: grade === 12 && chance(r, 0.45),
      iep: chance(r, 0.24), p504: false,
      ell: chance(r, 0.3) ? pick(r, ['Intermediate', 'Beginner', 'Advanced', 'Newcomer']) : 'None',
      incidents: Math.max(0, Math.round((r() + r() + r() - 1.35) * 4)),
      successRate: 0.45 + r() * 0.55,
      remote: chance(r, 0.3), // independent study
      exit: null, reengage: false,
    };
    if (!p.iep) p.p504 = chance(r, 0.14);
    profiles.push(p);
  }
}
function FIRSTat(i) { return D.FIRST[(i * 17) % D.FIRST.length]; }
function LASTat(i) { return D.LAST[(i * 23 + 5) % D.LAST.length]; }
function weekdayAgo(days) { let d = shift(TODAY, -days); while (isWeekend(d)) d = shift(d, -1); return iso(d); }

// Exits and one re-enrollment, drawn from the front of the list so they are stable.
const exiting = profiles.filter((p) => p.arrival !== 'mid-year');
exiting.slice(3, 9).forEach((p, i) => { p.exit = { event: 'withdrawn', date: weekdayAgo(12 + i * 5), reason: ['stopped attending', 'moved out of the area', 'aged out', 'employment', 'family relocation', 'enrolled in adult education'][i] }; });
exiting.slice(20, 24).forEach((p, i) => { p.exit = { event: 'transferred', date: weekdayAgo(20 + i * 6), reason: 'transferred to another school', nextSchool: ['Eastside High School', 'Valle Adult School', 'Northgate Charter', 'Riverbend Community School'][i] }; });
const returner = profiles[40];
returner.priorExit = { date: `${AY - 1}-11-04`, reason: 'stopped attending' };
returner.enrollDate = weekdayAgo(26); returner.arrival = 're-enrolled';
// Students to put on the re-engagement list.
profiles.filter((p) => !p.exit).filter((_, i) => i % 11 === 2).slice(0, 12).forEach((p) => { p.reengage = true; });

// ---------------------------------------------------------------- courses, sections, credits
const sessions = [];
const classes = new Map();
const enrollments = [];
const lineItems = [];
const results = [];
const seenTerms = new Map();

function useTerm(k) {
  const t = term(k);
  if (!seenTerms.has(t.id)) {
    seenTerms.set(t.id, t);
    const yrId = `AY-${t.schoolYear}`;
    if (!sessions.some((s) => s.sourcedId === yrId)) sessions.push({ sourcedId: yrId, title: `School year ${t.schoolYear}`, type: 'schoolYear', startDate: `${t.schoolYear.slice(0, 4)}-08-18`, endDate: `${t.schoolYear.slice(5)}-06-05`, schoolYear: t.schoolYear });
    sessions.push({ sourcedId: t.id, title: t.title, type: 'semester', startDate: t.start, endDate: t.end, schoolYear: t.schoolYear, parentSourcedId: yrId });
  }
  return t;
}

function useClass(course, t) {
  const id = `CLS-${course.code}-${t.id}`;
  if (classes.has(id)) return classes.get(id);
  const teacher = advisors[(course.code.charCodeAt(0) + course.code.charCodeAt(4 % course.code.length) + t.id.length) % advisors.length];
  const c = { sourcedId: id, title: `${course.title} — ${t.title}`, classCode: `${course.code}-${t.id.slice(4)}`, classType: 'scheduled', courseSourcedId: `CRS-${course.code}`, schoolSourcedId: SCHOOL, termSourcedIds: t.id, subjects: course.subject, grades: course.grades.join(','), teacher };
  classes.set(id, c);
  enrollments.push({ sourcedId: `ENR-${id}-${teacher.id}`, classSourcedId: id, userSourcedId: teacher.id, role: 'teacher', isPrimary: 1, beginDate: t.start, endDate: t.end, schoolSourcedId: SCHOOL });
  lineItems.push({ sourcedId: `LI-${id}`, title: `${course.title} — semester credit`, classSourcedId: id, category: 'credit', assignDate: t.start, dueDate: t.end, resultValueMin: 0, resultValueMax: course.credits, gradingPeriodSourcedId: t.id });
  return c;
}

const courseRows = D.COURSES.map((c) => ({ sourcedId: `CRS-${c.code}`, title: c.title, courseCode: c.code, orgSourcedId: SCHOOL, subjects: c.subject, grades: c.grades.join(','), credits: c.credits }));

for (const p of profiles) {
  const catalog = [...D.COURSES].sort((a, b) => ((a.code.charCodeAt(2) * 31 + p.id.charCodeAt(6)) % 97) - ((b.code.charCodeAt(2) * 31 + p.id.charCodeAt(5)) % 97));
  let slot = 0;
  p.creditsEarned = 0;
  for (let k = PRIOR_TERMS[p.grade]; k >= 0; k--) {
    const t = useTerm(k);
    const current = k === 0;
    for (let j = 0; j < 5; j++) {
      const course = catalog[slot++ % catalog.length];
      const cls = useClass(course, t);
      enrollments.push({ sourcedId: `ENR-${cls.sourcedId}-${p.id}`, classSourcedId: cls.sourcedId, userSourcedId: p.id, role: 'student', isPrimary: 1, beginDate: current ? p.enrollDate : t.start, endDate: current ? (p.exit?.date || '') : t.end, schoolSourcedId: SCHOOL });
      if (current) {
        results.push({ sourcedId: `RES-${p.id}-${cls.sourcedId}`, lineItemSourcedId: `LI-${cls.sourcedId}`, studentSourcedId: p.id, score: 0, scoreStatus: p.exit ? 'not submitted' : 'partially graded', scoreDate: ago(3), comment: 'In progress this term.' });
        continue;
      }
      const roll = p.r();
      const earned = roll < p.successRate ? course.credits : roll < p.successRate + 0.18 ? Math.round(course.credits / 2) : 0;
      p.creditsEarned += earned;
      results.push({ sourcedId: `RES-${p.id}-${cls.sourcedId}`, lineItemSourcedId: `LI-${cls.sourcedId}`, studentSourcedId: p.id, score: earned, scoreStatus: 'fully graded', scoreDate: t.end, comment: earned === course.credits ? 'Credit awarded.' : earned ? 'Partial credit; balance available through the recovery lab.' : 'No credit earned.' });
    }
  }
  p.creditsNeeded = Math.max(0, D.CREDITS_TO_GRADUATE - p.creditsEarned);
  p.behind = Math.max(0, (D.CREDITS_EXPECTED[p.grade] || 0) - p.creditsEarned);
}

store.upsertFacts('academic_sessions', sessions, 'seed');
store.upsertFacts('courses', courseRows, 'seed');
store.upsertFacts('classes', [...classes.values()].map(({ teacher, ...c }) => c), 'seed');
store.upsertFacts('enrollments', enrollments, 'seed');
store.upsertFacts('line_items', lineItems, 'seed');
store.upsertFacts('results', results, 'seed');

// ---------------------------------------------------------------- attendance (ADA) + re-engagement
// Five students have a genuine hole in the record: the section met, nobody
// took roll. The compliance check should find these, because in real life
// somebody has to go back and reconstruct them.
const gaps = new Map(profiles.filter((_, i) => i % 29 === 7).slice(0, 5).map((p, k) => [p.id, new Set([2 + k, 9 + k, 16 + k])]));

const attendance = [];
for (const p of profiles) {
  const gap = gaps.get(p.id);
  const days = DAYS.filter((d, i) => d >= p.enrollDate && (!p.exit || d <= p.exit.date) && !(gap && gap.has(i)));
  const last10 = new Set(DAYS.slice(-10));
  const targetRecent = p.reengage ? 3 + Math.floor(p.r() * 5) : 0;
  let recentAbs = 0;
  let present = 0;
  days.forEach((date, i) => {
    let code;
    if (last10.has(date) && recentAbs < targetRecent && i % 2 === 0) { code = chance(p.r, 0.35) ? 'excused' : 'absent'; recentAbs++; }
    else {
      const roll = p.r();
      const absentRate = p.reengage ? 0.3 : 0.05 + (1 - p.successRate) * 0.11;
      code = roll < absentRate ? (roll < absentRate * 0.4 ? 'excused' : 'absent') : roll < absentRate + 0.08 ? 'tardy' : p.remote && i % 3 === 0 ? 'remote' : 'present';
    }
    if (code !== 'absent' && code !== 'excused') present++;
    attendance.push({ id: `${p.id}-${date}`, studentSourcedId: p.id, date, code, minutes: code === 'absent' || code === 'excused' ? 0 : code === 'remote' ? 240 : 300, classSourcedId: '' });
  });
  p.daysEnrolled = days.length;
  p.attendancePct = days.length ? Math.round((present / days.length) * 1000) / 10 : 0;
}
store.upsertFacts('attendance', attendance, 'seed');

// ---------------------------------------------------------------- student records
for (const p of profiles) {
  const gpa = Math.round(Math.min(4, Math.max(0.4, p.successRate * 3.6 + (p.r() - 0.5) * 0.6)) * 100) / 100;
  store.upsertEntity({
    id: p.id, type: 'student', firstName: p.first, lastName: p.last, grade: p.grade, schoolId: SCHOOL,
    dob: p.dob, email: `${p.first}.${p.last}`.toLowerCase() + '@student.eastside.example',
    enrollStatus: p.exit ? p.exit.event : 'active', advisorId: p.advisor.id, enrollDate: p.enrollDate,
    externalIds: { stateId: String(9000000 + Number(p.id.slice(4))), prior: p.arrival === 'mid-year' ? 'transfer-in' : '' },
    credits: { earned: p.creditsEarned, needed: p.creditsNeeded, behindPace: p.behind },
    metrics: {
      gpa, attendancePct: p.attendancePct, assignCompletionPct: Math.round(p.successRate * 100),
      courseRigor: 0.25 + p.r() * 0.3, disciplineIncidents: p.incidents,
      extracurricularCount: chance(p.r, 0.3) ? 1 : 0, selScore: 0.3 + p.r() * 0.6,
      counselorVisits: 1 + Math.floor(p.r() * 8), trajectory: Math.round((p.r() - 0.35) * 100) / 100,
      ses: 0.1 + p.r() * 0.4, homeStability: p.arrival === 'mid-year' ? 0.2 + p.r() * 0.3 : 0.4 + p.r() * 0.5,
      ellLevel: p.ell, specialEd: p.iep ? (chance(p.r, 0.5) ? 'IEP-full' : 'IEP-partial') : p.p504 ? '504' : 'None',
      peerConnected: 0.25 + p.r() * 0.6,
    },
  }, 'seed');
}

// ---------------------------------------------------------------- enrollment events
const events = [];
for (const p of profiles) {
  if (p.priorExit) {
    events.push({ id: `${p.id}-e0`, studentSourcedId: p.id, orgSourcedId: SCHOOL, event: 'enrolled', date: `${AY - 1}-08-18`, reason: 'initial enrollment' });
    events.push({ id: `${p.id}-e1`, studentSourcedId: p.id, orgSourcedId: SCHOOL, event: 'withdrawn', date: p.priorExit.date, reason: p.priorExit.reason });
    events.push({ id: `${p.id}-e2`, studentSourcedId: p.id, orgSourcedId: SCHOOL, event: 're-enrolled', date: p.enrollDate, reason: 'returned after outreach', note: 'Came back after a home visit. Credits from the interrupted term were recovered.' });
  } else {
    events.push({ id: `${p.id}-e0`, studentSourcedId: p.id, orgSourcedId: SCHOOL, event: 'enrolled', date: p.enrollDate, reason: p.arrival === 'mid-year' ? 'mid-year enrollment (transfer in)' : p.arrival === 'continuing' ? 'continuing student' : 'start of school year' });
  }
  if (p.exit) events.push({ id: `${p.id}-e3`, studentSourcedId: p.id, orgSourcedId: SCHOOL, event: p.exit.event, date: p.exit.date, reason: p.exit.reason, nextSchool: p.exit.nextSchool || '' });
}
store.upsertFacts('enrollment_events', events, 'seed');

// ---------------------------------------------------------------- services, plans, incidents
// A transition plan is owed to every senior and to everyone 16 or older, not
// just the students with an IEP. Ten are deliberately missing: that is the list
// the director should be working from, and it should not be empty in a demo.
const ageOn = (dob) => Math.floor((TODAY - new Date(dob + 'T12:00:00Z')) / (365.25 * 86400000));
const needsTransition = new Set(profiles.filter((p) => p.grade === 12 || ageOn(p.dob) >= 16).map((p) => p.id));
const noTransition = new Set(profiles.filter((p) => needsTransition.has(p.id) && !p.exit).filter((_, i) => i % 7 === 3).slice(0, 10).map((p) => p.id));

const services = [], plans = [], incidents = [];
for (const p of profiles) {
  const start = p.enrollDate;
  if (p.iep) {
    services.push({ id: `${p.id}-iep`, studentSourcedId: p.id, type: 'IEP', level: chance(p.r, 0.5) ? 'full' : 'partial', startDate: start, provider: caseManager.first + ' ' + caseManager.last, note: 'Specialized academic instruction and accommodations.' });
    const overdue = chance(p.r, 0.22);
    plans.push({ id: `${p.id}-plan-iep`, studentSourcedId: p.id, type: 'IEP', title: 'Annual IEP', status: 'active', startDate: start, reviewDate: overdue ? ago(10 + Math.floor(p.r() * 70)) : ahead(5 + Math.floor(p.r() * 150)), goals: pick(p.r, D.GOALS), owner: caseManager.id, note: overdue ? 'Annual review is past due; meeting not yet held.' : '' });
  } else if (p.p504) {
    services.push({ id: `${p.id}-504`, studentSourcedId: p.id, type: '504', level: 'accommodations', startDate: start, provider: counselor.first + ' ' + counselor.last });
    plans.push({ id: `${p.id}-plan-504`, studentSourcedId: p.id, type: '504', title: 'Section 504 plan', status: 'active', startDate: start, reviewDate: chance(p.r, 0.18) ? ago(5 + Math.floor(p.r() * 50)) : ahead(20 + Math.floor(p.r() * 160)), goals: pick(p.r, D.GOALS), owner: counselor.id });
  }
  if (p.ell !== 'None') services.push({ id: `${p.id}-ell`, studentSourcedId: p.id, type: 'ELL', level: p.ell, startDate: start });
  if (chance(p.r, 0.55)) services.push({ id: `${p.id}-frl`, studentSourcedId: p.id, type: 'FRL', level: 'free', startDate: start });
  if (p.incidents >= 3) plans.push({ id: `${p.id}-plan-bsp`, studentSourcedId: p.id, type: 'BSP', title: 'Behavior support plan', status: 'active', startDate: ago(60 + Math.floor(p.r() * 120)), reviewDate: chance(p.r, 0.3) ? ago(3 + Math.floor(p.r() * 40)) : ahead(10 + Math.floor(p.r() * 80)), goals: 'Use the agreed de-escalation plan; stay on campus during conflict.', owner: p.advisor.id });
  if (needsTransition.has(p.id) && !noTransition.has(p.id)) plans.push({ id: `${p.id}-plan-trans`, studentSourcedId: p.id, type: 'transition', title: p.iep ? 'Transition plan (IEP, postsecondary)' : 'Transition plan (postsecondary)', status: 'active', startDate: start, reviewDate: ahead(20 + Math.floor(p.r() * 120)), goals: pick(p.r, ['Employment or a trade program within six months of graduation.', 'Community college application filed and orientation attended.', 'Apprenticeship placement through the CTE pathway.', 'Full-time work with the employer the student already has, plus a diploma.', 'Military entrance testing and a fallback trade program.']), owner: p.iep ? caseManager.id : counselor.id });
  if (p.behind >= 20) plans.push({ id: `${p.id}-plan-cr`, studentSourcedId: p.id, type: 'credit-recovery', title: `Credit recovery plan (${p.behind} credits behind pace)`, status: 'active', startDate: ago(20 + Math.floor(p.r() * 60)), reviewDate: ahead(15 + Math.floor(p.r() * 60)), goals: pick(p.r, D.GOALS), owner: p.advisor.id, note: `Target: ${p.creditsNeeded} credits remaining for a diploma.` });
  for (let k = 0; k < p.incidents; k++) incidents.push({ id: `${p.id}-inc${k}`, studentSourcedId: p.id, date: DAYS[Math.floor(p.r() * DAYS.length)], type: pick(p.r, D.INCIDENT_TYPES), action: pick(p.r, D.INCIDENT_ACTIONS), description: 'Documented by the advisor the same day.', reportedBy: p.advisor.id, schoolSourcedId: SCHOOL });
}
store.upsertFacts('services', services, 'seed');
store.upsertFacts('learning_plans', plans, 'seed');
store.upsertFacts('discipline_incidents', incidents, 'seed');

// ---------------------------------------------------------------- families, contacts, documents, drills
const contacts = [], docs = [];
let fam = 0;
for (const p of profiles) {
  const hasFamily = !p.age18 && chance(p.r, 0.7);
  if (hasFamily) {
    fam++;
    const relation = pick(p.r, D.RELATIONS);
    const lang = pick(p.r, D.LANGS);
    const gname = `${D.FIRST[(fam * 31) % D.FIRST.length]} ${p.last}`;
    const famId = `FAM-${String(fam).padStart(3, '0')}`;
    store.upsertEntity({ id: famId, type: 'family', name: `${p.last} family`, students: [p.id], schoolId: SCHOOL, members: [{ name: gname, relation, email: gname.split(' ')[0].toLowerCase() + '.' + p.last.toLowerCase() + '@example.test', phone: `555-01${String(fam).padStart(2, '0')}`, language: lang }] }, 'seed');
    contacts.push({ id: `${p.id}-c1`, studentSourcedId: p.id, name: gname, relation, email: gname.split(' ')[0].toLowerCase() + '.' + p.last.toLowerCase() + '@example.test', phone: `555-01${String(fam).padStart(2, '0')}`, language: lang, isPrimary: 1 });
    if (chance(p.r, 0.35)) contacts.push({ id: `${p.id}-c2`, studentSourcedId: p.id, name: `${pick(p.r, D.FIRST)} ${pick(p.r, D.LAST)}`, relation: pick(p.r, D.RELATIONS), phone: `555-02${String(fam).padStart(2, '0')}`, language: lang, isPrimary: 0 });
  } else if (p.age18) {
    contacts.push({ id: `${p.id}-c1`, studentSourcedId: p.id, name: `${p.first} ${p.last}`, relation: 'self (18 or older)', phone: `555-03${p.id.slice(4)}`, language: 'English', isPrimary: 1 });
  }
  for (const dt of D.DOC_TYPES) {
    const missing = chance(p.r, p.arrival === 'mid-year' ? 0.28 : 0.08);
    docs.push({ id: `${p.id}-${dt.type}`, subjectType: 'student', subjectSourcedId: p.id, type: dt.type, title: dt.title, status: missing ? 'missing' : 'on-file', issuedDate: missing ? '' : p.enrollDate, path: missing ? '' : `documents/${p.id}/${dt.type}.pdf`, note: missing && dt.type === 'residency' ? 'Not requested — possible housing instability; see the county liaison.' : '' });
  }
  if (p.grade >= 10 && chance(p.r, 0.4)) docs.push({ id: `${p.id}-work-permit`, subjectType: 'student', subjectSourcedId: p.id, type: 'work-permit', title: 'Work permit', status: chance(p.r, 0.2) ? 'expired' : 'on-file', issuedDate: ago(120), expiresDate: chance(p.r, 0.2) ? ago(15) : ahead(200), path: `documents/${p.id}/work-permit.pdf` });
}
// Immunizations: nearly everyone has a record, a few have a filed exemption,
// and a handful genuinely have nothing on file — which is exactly the list a
// public-health review asks for.
const immun = [];
const noShots = new Set(profiles.filter((p) => !p.exit).filter((_, i) => i % 37 === 11).slice(0, 4).map((p) => p.id));
for (const p of profiles) {
  if (noShots.has(p.id)) continue;
  const exemption = chance(p.r, 0.05) ? pick(p.r, ['medical', 'religious', 'personal']) : 'none';
  if (exemption !== 'none') {
    immun.push({ id: `${p.id}-exempt`, studentSourcedId: p.id, vaccine: 'all', exemption, date: p.enrollDate, verifiedBy: staff[3].id, note: `${exemption} exemption on file` });
    continue;
  }
  D.VACCINES.forEach((v, i) => {
    immun.push({ id: `${p.id}-${v.code}`, studentSourcedId: p.id, vaccine: v.name, doseNumber: v.doses, exemption: 'none', date: iso(shift(new Date(p.dob + 'T12:00:00Z'), v.ageYears * 365)), verifiedBy: staff[3].id, note: i === 0 ? 'Verified against the record from the prior school.' : '' });
  });
}
store.upsertFacts('immunizations', immun, 'seed');
store.upsertFacts('contacts', contacts, 'seed');
store.upsertFacts('documents', docs, 'seed');
// Fire, earthquake and lockdown all fall inside the current school year; the
// evacuation is last year's, so the record shows history as well as compliance.
const DRILL_AGE = { fire: 8, earthquake: 28, lockdown: 19, evacuation: 81 };
store.upsertFacts('drills', D.DRILL_TYPES.map((type, i) => ({ id: `DRL-${type}`, orgSourcedId: SCHOOL, type, date: weekdayAgo(DRILL_AGE[type]), durationMinutes: [9, 6, 14, 11][i], participants: 138 - i * 3, ledBy: director.id, note: 'Logged the same day; all sections cleared.' })), 'seed');

// ---------------------------------------------------------------- fragments (the co-authored record)
const frags = [];
for (const p of profiles) {
  if (chance(p.r, 0.72)) frags.push({ entityId: p.id, kind: 'self', visibility: 'school', text: pick(p.r, D.SELF).replace('{behind}', String(p.behind || 15)).replace('{interest}', pick(p.r, D.INTERESTS)), author: { id: p.id.toLowerCase(), role: 'student', name: p.first }, source: 'seed' });
  frags.push({ entityId: p.id, kind: 'note', visibility: 'staff', text: pick(p.r, D.CASE_NOTES).replace('{behind}', String(p.behind || 10)), author: { id: p.advisor.id, role: 'staff', name: `${p.advisor.first} ${p.advisor.last}` }, source: 'seed' });
  if (p.reengage || p.exit || chance(p.r, 0.18)) {
    const days = 1 + Math.floor(p.r() * 9);
    frags.push({ entityId: p.id, kind: 'record', visibility: 'staff', text: pick(p.r, D.CONTACT_LOG).replace('{ago}', days === 1 ? 'yesterday' : `${days} days ago`), author: { id: p.advisor.id, role: 'staff', name: `${p.advisor.first} ${p.advisor.last}` }, source: 'seed' });
  }
}
for (let i = 0; i < frags.length; i += 60) { await store.addFragments(frags.slice(i, i + 60), 'seed'); process.stdout.write(`  fragments ${Math.min(i + 60, frags.length)}/${frags.length}\r`); }

// ---------------------------------------------------------------- accounts, invites, apps
const demoStudent = profiles.find((p) => p.reengage && !p.exit && p.grade >= 11) || profiles.find((p) => !p.exit) || profiles[0];
const demoFamilyStudent = profiles.find((p) => contacts.some((c) => c.studentSourcedId === p.id && c.isPrimary === 1 && c.relation !== 'self (18 or older)'));
const logins = [];
if (!keep && !auth.bootstrapped) {
  const add = (username, password, role, extra, label) => { auth.createUser({ username, password, role, ...extra }); logins.push(`${username}/${password} (${label})`); };
  add('admin', 'librea-admin', 'admin', { entityId: director.id, displayName: `${director.first} ${director.last}, Director` }, 'director / admin');
  // The advisor account is caseload-scoped: their own sections, their own
  // plan-owned students, their own advisees. The case manager and the director
  // see the whole school, which is how those two jobs actually work.
  add('advisor', 'librea-staff', 'staff', { entityId: advisors[0].id, displayName: `${advisors[0].first} ${advisors[0].last}` }, 'advisor, caseload-scoped');
  auth.updateUser('advisor', { caseload: true });
  add('casemanager', 'librea-staff', 'staff', { entityId: caseManager.id, displayName: `${caseManager.first} ${caseManager.last}` }, 'case manager');
  add(demoStudent.id.toLowerCase(), 'librea-student', 'student', { entityId: demoStudent.id, displayName: demoStudent.first }, `student, grade ${demoStudent.grade}`);
  add('family.' + demoFamilyStudent.id.toLowerCase(), 'librea-family', 'family', { entityIds: [demoFamilyStudent.id], displayName: `${demoFamilyStudent.last} family` }, 'guardian');
}
const invites = keep ? [] : [
  auth.createInvite({ role: 'staff', displayName: 'New advisor', days: 30, createdBy: 'admin' }),
  auth.createInvite({ role: 'student', entityId: profiles.find((p) => p.age18).id, displayName: 'Student, 16 or older', days: 30, createdBy: 'admin' }),
  auth.createInvite({ role: 'family', entityIds: [demoFamilyStudent.id], displayName: `${demoFamilyStudent.last} family guardian`, days: 30, createdBy: 'admin' }),
];

const installed = installApps({ store, dataDir, dir: path.join(HERE, 'apps'), author: { username: 'admin', role: 'admin', displayName: `${director.first} ${director.last}, Director` } });

sql.close();
store.snapshot();
const s = store.stats();
const behind = profiles.filter((p) => p.behind >= 20).length;
console.log(`\nEastside Continuation & Independent Study seeded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`  ${s.students} students, ${staff.length} staff, ${fam} families, ${s.fragments} fragments`);
console.log(`  ${results.length} credit results across ${lineItems.length} sections, ${attendance.length} attendance rows, ${plans.length} plans, ${events.length} enrollment events`);
console.log(`  ${behind} students 20+ credits behind pace, ${profiles.filter((p) => p.reengage).length} on the re-engagement list`);
console.log(`  apps installed: ${installed.join(', ')}`);
console.log(`  ledger head: ${store.ledger.verify().head.slice(0, 12)}`);
if (logins.length) console.log('Demo logins: ' + logins.join(', '));
if (invites.length) console.log('Invite codes: ' + invites.map((i) => `${i.code} (${i.role})`).join(', '));
