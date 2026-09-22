// Micro pack: microschools and parent co-ops. A handful of adults, a mixed-age
// pod, somebody's living room or a rented hall. These are the questions an
// insurer, a state private-school registrar, and a nervous grandparent ask.
import { today, shiftDays, enrolledStudents, allStaff, nameOf, currentDocuments, validCredentials, idSet, outcome, schoolYearStart, schoolYearLabel } from './util.js';

const PACK = 'micro';
const check = (c) => ({ pack: PACK, severity: 'required', ...c });

const FIX_DOC = (type) => ({ action: 'upload-document', table: 'documents', hint: `Add a documents row: subjectType 'student', type '${type}', status 'on-file', with an expiresDate if it lapses.` });

/** The academic session in progress, if the school has defined one. */
export function currentTerm(db, on = today()) {
  const rows = db.prepare(`SELECT * FROM academic_sessions WHERE startDate IS NOT NULL AND endDate IS NOT NULL
    AND startDate <= ? AND endDate >= ? AND lower(COALESCE(type,'')) IN ('term','semester','gradingperiod')
    ORDER BY startDate DESC`).all(on, on);
  return rows[0] || null;
}

export const MICRO_CHECKS = [
  check({
    id: 'micro.consent', subject: 'student', title: 'Custody and consent paperwork on file',
    why: 'A co-op must know who may collect a child and who has agreed to medical care, field trips, and photographs.',
    run(db, ctx) {
      const students = enrolledStudents(db);
      const have = idSet(currentDocuments(db, 'student', /consent|custody|guardian|authoriz/i, ctx.today), 'subjectSourcedId');
      const failing = students.filter((s) => !have.has(s.id)).map((s) => ({ id: s.id, label: nameOf(s), detail: 'no current consent or custody document' }));
      return outcome({ total: students.length, failing, fix: FIX_DOC('consent') });
    },
  }),
  check({
    id: 'micro.residency', subject: 'student', title: 'Proof of residency on file',
    why: 'Residency is what lets a community show a regulator which families it actually serves.',
    run(db, ctx) {
      const students = enrolledStudents(db);
      const have = idSet(currentDocuments(db, 'student', /residen|address|utility|lease/i, ctx.today), 'subjectSourcedId');
      const failing = students.filter((s) => !have.has(s.id)).map((s) => ({ id: s.id, label: nameOf(s), detail: 'no current proof of residency' }));
      return outcome({ total: students.length, failing, fix: FIX_DOC('residency') });
    },
  }),
  check({
    id: 'micro.ratio', subject: 'organization', title: 'Adults to children within the stated ratio',
    why: 'Supervision ratio is the single number an insurer and a licensing officer will both ask for.',
    run(db, ctx) {
      const max = Number(ctx.config.ratio) || 12;
      const students = enrolledStudents(db);
      const staff = allStaff(db);
      const sites = [...new Set(students.map((s) => s.schoolSourcedId || '(unassigned)'))];
      const names = new Map(db.prepare('SELECT sourcedId, name FROM orgs').all().map((o) => [o.sourcedId, o.name]));
      const failing = sites.map((site) => {
        const kids = students.filter((s) => (s.schoolSourcedId || '(unassigned)') === site).length;
        const adults = staff.filter((s) => (s.schoolSourcedId || '(unassigned)') === site).length;
        const ratio = adults ? kids / adults : Infinity;
        return { site, kids, adults, ratio };
      }).filter((r) => r.ratio > max).map((r) => ({
        id: r.site, label: names.get(r.site) || r.site,
        detail: r.adults ? `${r.kids} students to ${r.adults} adults (${r.ratio.toFixed(1)}:1, limit ${max}:1)` : `${r.kids} students and no adult on record`,
      }));
      return outcome({ total: sites.length, failing, fix: { action: 'add-staff', table: 'staff', hint: `Add the adults who are actually there, or lower enrollment. Limit is ${max} students per adult; set compliance.ratio in the edition to change it.` } });
    },
  }),
  check({
    id: 'micro.guide-credential', subject: 'organization', title: 'Every pod has a credentialed guide',
    why: 'Families are trusting one named adult with the learning; that adult should hold something they can show.',
    run(db, ctx) {
      const all = db.prepare('SELECT sourcedId AS id, title, classType FROM classes').all();
      const pods = all.filter((c) => String(c.classType || '').toLowerCase() === 'homeroom');
      const subjects = pods.length ? pods : all;
      if (!subjects.length) return outcome({ total: 0, failing: [], fix: FIX_GUIDE });
      const credentialed = idSet(validCredentials(db, /guide|teach|credential|certif|montessori|early.?childhood/i, ctx.today), 'staffSourcedId');
      const teachers = db.prepare("SELECT classSourcedId, userSourcedId FROM enrollments WHERE lower(COALESCE(role,'')) IN ('teacher','aide','guide')").all();
      const byClass = new Map();
      for (const t of teachers) byClass.set(t.classSourcedId, [...(byClass.get(t.classSourcedId) || []), t.userSourcedId]);
      const failing = subjects.filter((c) => !(byClass.get(c.id) || []).some((u) => credentialed.has(u)))
        .map((c) => ({ id: c.id, label: c.title || c.id, detail: (byClass.get(c.id) || []).length ? 'no assigned guide holds a current credential' : 'no guide assigned' }));
      return outcome({ total: subjects.length, failing, fix: FIX_GUIDE });
    },
  }),
  check({
    id: 'micro.ilp-term', subject: 'student', title: 'Each student has an individual plan reviewed this term',
    why: 'A microschool promises an individual path; the plan and its review date are the proof it is real.',
    run(db, ctx) {
      const term = currentTerm(db, ctx.today);
      const since = term ? term.startDate : shiftDays(ctx.today, -90);
      const students = enrolledStudents(db);
      // An IEP or a 504 is an individual plan; a learner who has one is not
      // also required to carry a separate ILP saying the same thing.
      const reviewed = idSet(db.prepare(`SELECT DISTINCT studentSourcedId FROM learning_plans
        WHERE lower(COALESCE(type,'')) IN ('ilp','iep','504') AND reviewDate IS NOT NULL AND reviewDate >= ?`).all(since), 'studentSourcedId');
      const failing = students.filter((s) => !reviewed.has(s.id))
        .map((s) => ({ id: s.id, label: nameOf(s), detail: `no ILP, IEP or 504 with a review date on or after ${since}${term ? ` (${term.title || term.sourcedId})` : ''}` }));
      return outcome({ total: students.length, failing, fix: { action: 'write-plan', table: 'learning_plans', hint: "Add a learning_plans row: type 'ILP', status 'active', goals, and the date of this term's review." } });
    },
  }),
  check({
    id: 'micro.affidavit', subject: 'organization', title: 'Private-school affidavit data complete',
    why: 'Most states let a small school operate on a filed affidavit, and an unfiled or stale one is what makes a community not legit.',
    run(db, ctx) {
      const orgs = db.prepare('SELECT sourcedId AS id, name, identifier FROM orgs').all();
      if (!orgs.length) return outcome({ total: 0, failing: [], fix: FIX_AFFIDAVIT });
      const yearStart = schoolYearStart(ctx.today);
      const filed = currentDocuments(db, 'organization', /affidavit|registration|license/i, ctx.today)
        .filter((d) => !d.issuedDate || d.issuedDate >= yearStart);
      const have = idSet(filed, 'subjectSourcedId');
      const failing = orgs.flatMap((o) => {
        const gaps = [];
        if (!String(o.name || '').trim()) gaps.push('no school name');
        if (!have.has(o.id) && !(orgs.length === 1 && filed.length)) gaps.push(`no affidavit filed for ${schoolYearLabel(ctx.today)}`);
        return gaps.length ? [{ id: o.id, label: o.name || o.id, detail: gaps.join('; ') }] : [];
      });
      return outcome({ total: orgs.length, failing, fix: FIX_AFFIDAVIT });
    },
  }),
];

const FIX_GUIDE = { action: 'add-credential', table: 'staff_credentials', hint: "Assign a guide to the pod (an enrollments row with role 'teacher'), then add their staff_credentials row." };
const FIX_AFFIDAVIT = { action: 'file-affidavit', table: 'documents', hint: "Fill in the school's name and address, then add a documents row: subjectType 'organization', type 'affidavit', status 'on-file', issuedDate in this school year." };
