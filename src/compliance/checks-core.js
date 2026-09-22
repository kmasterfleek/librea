// Core pack: what every school, of every kind, must be able to show. Each
// check answers one question a parent, an insurer, or a state reviewer asks,
// and names the exact table to fix it in.
import { today, shiftDays, lastSchoolDays, ph, enrolledStudents, allStaff, nameOf, currentDocuments, validCredentials, idSet, outcome } from './util.js';

const PACK = 'core';
const check = (c) => ({ pack: PACK, severity: 'required', ...c });

const FIX_ATTENDANCE = { action: 'take-attendance', table: 'attendance', hint: 'Add one attendance row per student per school day with a code: present, absent, tardy, excused, remote.' };

/** Students missing a document of a given kind. */
function missingDoc(db, re, on, detail) {
  const students = enrolledStudents(db);
  const have = idSet(currentDocuments(db, 'student', re, on), 'subjectSourcedId');
  return { students, failing: students.filter((s) => !have.has(s.id)).map((s) => ({ id: s.id, label: nameOf(s), detail })) };
}

/** Staff missing a current credential of a given kind. */
function missingCred(db, re, on, detail) {
  const staff = allStaff(db);
  const have = idSet(validCredentials(db, re, on), 'staffSourcedId');
  return { staff, failing: staff.filter((s) => !have.has(s.id)).map((s) => ({ id: s.id, label: nameOf(s), detail })) };
}

const isValidCred = (c, on) => String(c.status || '').trim().toLowerCase() === 'valid' && (!c.expiresDate || c.expiresDate >= on);
const isPendingCred = (c) => String(c.status || '').trim().toLowerCase() === 'pending';
/** When a credential row happened: issue date, else expiry, else unknown. */
const credAt = (c) => c.issuedDate || c.expiresDate || '';
const latestCred = (list) => list.reduce((a, b) => (credAt(b) >= credAt(a) ? b : a), list[0]);

function describeStaleCred(c, on) {
  const status = String(c.status || '').trim().toLowerCase();
  const kind = c.type || 'clearance';
  if (status === 'pending') return `${kind} is still pending`;
  if (c.expiresDate && c.expiresDate < on) return `${kind} expired ${c.expiresDate}`;
  return `${kind} is ${status || 'missing'}`;
}

/**
 * Staff whose latest clearance is not a clearance. The newest matching row
 * decides: a valid fingerprinting record from two years ago does not answer
 * for a background check filed last week and still pending, so an older valid
 * row of another type no longer masks a newer pending or expired one. A valid
 * row dated on or after the stale one does clear it.
 *
 * A pending row is never satisfied by another row, dated or not. This is the
 * one check where a false pass puts an uncleared adult alone with children, so
 * an open application stays open until its own row says otherwise — however
 * old it is, and whatever else has been filed since. The remedy is one field:
 * resolve the pending row, or remove it.
 */
function staleClearance(db, re, on) {
  const staff = allStaff(db);
  const rows = db.prepare('SELECT * FROM staff_credentials').all().filter((c) => re.test(String(c.type || '')));
  const byStaff = new Map();
  for (const c of rows) byStaff.set(c.staffSourcedId, [...(byStaff.get(c.staffSourcedId) || []), c]);
  const failing = [];
  for (const s of staff) {
    const mine = byStaff.get(s.id) || [];
    if (!mine.length) { failing.push({ id: s.id, label: nameOf(s), detail: 'no clearance on record' }); continue; }
    const valid = mine.filter((c) => isValidCred(c, on));
    const stale = mine.filter((c) => !isValidCred(c, on));
    if (!valid.length) { failing.push({ id: s.id, label: nameOf(s), detail: describeStaleCred(latestCred(stale), on) }); continue; }
    const newestValid = credAt(latestCred(valid));
    const blocking = stale.filter((c) => isPendingCred(c) || credAt(c) > newestValid);
    if (blocking.length) failing.push({ id: s.id, label: nameOf(s), detail: describeStaleCred(latestCred(blocking), on) });
  }
  return { staff, failing };
}

/**
 * Was a drill of this kind held inside the window? Organization-level.
 *
 * The window is the last `days` school days when the register goes back that
 * far. When it does not, we fall back to the calendar equivalent rather than
 * shrinking the window to whatever attendance happens to exist — otherwise
 * "did you drill in the last 90 school days" would quietly be answered by how
 * many days of attendance had been entered, and a school could flip from fail
 * to pass by backfilling its register alone.
 */
function drillCheck(db, re, days, ctx, label) {
  const school = lastSchoolDays(db, days, { upTo: ctx.today });
  const since = school.length >= days ? school[school.length - 1] : shiftDays(ctx.today, -Math.round(days * 1.5));
  const orgs = db.prepare("SELECT sourcedId AS id, name FROM orgs WHERE type = 'school' OR type IS NULL").all();
  const drills = db.prepare('SELECT * FROM drills WHERE date >= ? AND date <= ?').all(since, ctx.today).filter((d) => re.test(String(d.type || '')));
  const subjects = orgs.length ? orgs : [{ id: '(school)', name: '(school)' }];
  const held = idSet(drills, 'orgSourcedId');
  const failing = subjects.filter((o) => !(held.has(o.id) || (orgs.length <= 1 && drills.length)))
    .map((o) => ({ id: o.id, label: o.name || o.id, detail: `no ${label} drill logged since ${since}` }));
  return outcome({ total: subjects.length, failing, fix: { action: 'log-drill', table: 'drills', hint: `Add a drills row: orgSourcedId, type "${label}", date, participants.` } });
}

export const CORE_CHECKS = [
  check({
    id: 'core.emergency-contact', subject: 'student', title: 'Every student has an emergency contact',
    why: 'If a child is hurt, someone must be reachable in the first minute.',
    run(db, ctx) {
      const students = enrolledStudents(db);
      const have = idSet(db.prepare('SELECT DISTINCT studentSourcedId FROM contacts').all(), 'studentSourcedId');
      const failing = students.filter((s) => !have.has(s.id)).map((s) => ({ id: s.id, label: nameOf(s), detail: 'no contact on record' }));
      return outcome({ total: students.length, failing, fix: { action: 'add-contact', table: 'contacts', hint: 'Add a contacts row with name, relation, and a phone that answers.' } });
    },
  }),
  check({
    id: 'core.immunization', subject: 'student', title: 'Immunization record or exemption per student',
    why: 'Public health law requires proof of immunization, or a filed exemption, before a child attends.',
    run(db, ctx) {
      const students = enrolledStudents(db);
      const have = idSet(db.prepare('SELECT DISTINCT studentSourcedId FROM immunizations').all(), 'studentSourcedId');
      const failing = students.filter((s) => !have.has(s.id)).map((s) => ({ id: s.id, label: nameOf(s), detail: 'no immunization record and no exemption' }));
      return outcome({ total: students.length, failing, fix: { action: 'add-immunization', table: 'immunizations', hint: 'Add an immunizations row per vaccine, or one row with exemption set to medical/religious/personal.' } });
    },
  }),
  check({
    id: 'core.enrollment-form', subject: 'student', title: 'Enrollment form on file',
    why: 'The signed enrollment form is what proves a family chose this school and agreed to its terms.',
    run(db, ctx) {
      const { students, failing } = missingDoc(db, /enroll/i, ctx.today, 'no current enrollment form');
      return outcome({ total: students.length, failing, fix: { action: 'upload-document', table: 'documents', hint: "Add a documents row: subjectType 'student', type 'enrollment', status 'on-file'." } });
    },
  }),
  check({
    id: 'core.emergency-card', subject: 'student', title: 'Emergency card on file',
    why: 'Medical, allergy, and pickup authorization have to be in one place a substitute can find.',
    run(db, ctx) {
      const { students, failing } = missingDoc(db, /emergency/i, ctx.today, 'no current emergency card');
      return outcome({ total: students.length, failing, fix: { action: 'upload-document', table: 'documents', hint: "Add a documents row: subjectType 'student', type 'emergency-card', status 'on-file'." } });
    },
  }),
  check({
    id: 'core.attendance-complete', subject: 'student', title: 'Attendance recorded every school day (last 30)',
    why: 'Attendance is the legal record of who was in your care, and most funding and truancy law rests on it.',
    run(db, ctx) {
      const days = lastSchoolDays(db, 30, { upTo: ctx.today });
      if (!days.length) return outcome({ total: 0, failing: [], fix: FIX_ATTENDANCE });
      const students = enrolledStudents(db);
      const counted = new Map(db.prepare(`SELECT studentSourcedId id, count(DISTINCT date) n FROM attendance WHERE date IN (${ph(days)}) GROUP BY studentSourcedId`)
        .all(...days).map((r) => [r.id, r.n]));
      const failing = students.map((s) => ({ s, missing: days.length - (counted.get(s.id) || 0) })).filter((x) => x.missing > 0)
        .sort((a, b) => b.missing - a.missing)
        .map(({ s, missing }) => ({ id: s.id, label: nameOf(s), detail: `missing ${missing} of ${days.length} school days` }));
      return outcome({ total: students.length, failing, fix: FIX_ATTENDANCE });
    },
  }),
  check({
    id: 'core.background-check', subject: 'staff', title: 'Every adult has a valid background check',
    why: 'No adult should be alone with children without a current criminal-record clearance on file.',
    run(db, ctx) {
      const { staff, failing } = staleClearance(db, /background|fingerprint|livescan|live.?scan|dbs|crb/i, ctx.today);
      return outcome({ total: staff.length, failing, fix: { action: 'add-credential', table: 'staff_credentials', hint: "Add a staff_credentials row: type 'background-check', status 'valid', issuedDate, expiresDate." } });
    },
  }),
  check({
    id: 'core.mandated-reporter', subject: 'staff', title: 'Mandated-reporter training current',
    why: 'Everyone who works with children is legally required to recognize and report suspected abuse.',
    run(db, ctx) {
      const { staff, failing } = missingCred(db, /mandat|reporter|child.?abuse|safeguard/i, ctx.today, 'training missing or expired');
      return outcome({ total: staff.length, failing, fix: { action: 'add-credential', table: 'staff_credentials', hint: "Add a staff_credentials row: type 'mandated-reporter', status 'valid', with the renewal date in expiresDate." } });
    },
  }),
  check({
    id: 'core.cpr-first-aid', subject: 'organization', title: 'Someone on site holds current CPR and first aid',
    why: 'In a medical emergency, minutes matter and at least one trained adult must already be in the building.',
    run(db, ctx) {
      const staff = allStaff(db);
      const holders = validCredentials(db, /cpr|first.?aid|aed/i, ctx.today);
      const failing = holders.length ? [] : [{ id: '(school)', label: 'school', detail: 'no staff member holds a current CPR or first-aid certificate' }];
      return outcome({ total: staff.length ? 1 : 0, failing, fix: { action: 'add-credential', table: 'staff_credentials', hint: "Add a staff_credentials row: type 'cpr-first-aid', status 'valid', expiresDate." } });
    },
  }),
  check({
    id: 'core.fire-drill', subject: 'organization', title: 'Fire drill in the last 30 school days',
    why: 'Children evacuate safely only if they have practiced recently, and drill logs are the first thing a fire marshal asks for.',
    run: (db, ctx) => drillCheck(db, /fire|evacuat/i, 30, ctx, 'fire'),
  }),
  check({
    id: 'core.lockdown-drill', subject: 'organization', title: 'Evacuation or lockdown drill in the last 90 school days',
    why: 'A school must have practiced the non-fire emergency it hopes never to have.',
    run: (db, ctx) => drillCheck(db, /lockdown|evacuat|shelter|earthquake|intruder/i, 90, ctx, 'lockdown or evacuation'),
  }),
  check({
    id: 'core.incident-action', subject: 'student', title: 'Every discipline incident records an action',
    why: 'An incident with no recorded response cannot be defended to a family, an attorney, or a state reviewer.',
    run(db, ctx) {
      const rows = db.prepare(`SELECT i.id, i.date, i.type, i.action, i.studentSourcedId, s.givenName, s.familyName FROM discipline_incidents i
        LEFT JOIN students s ON s.sourcedId = i.studentSourcedId ORDER BY i.date DESC`).all();
      const failing = rows.filter((r) => !String(r.action || '').trim())
        .map((r) => ({ id: r.id, label: `${r.date || '?'} ${r.type || 'incident'} — ${nameOf(r)}`, detail: 'no action recorded' }));
      return outcome({ total: rows.length, failing, fix: { action: 'record-action', table: 'discipline_incidents', hint: 'Set the action column: conference, restorative circle, suspension, referral.' } });
    },
  }),
  check({
    id: 'core.plan-review-overdue', subject: 'student', title: 'No learning plan is past its review date',
    why: 'A plan nobody reviewed is a promise to a family that quietly stopped being kept.',
    run(db, ctx) {
      const rows = db.prepare(`SELECT p.id, p.type, p.reviewDate, p.studentSourcedId, s.givenName, s.familyName FROM learning_plans p
        LEFT JOIN students s ON s.sourcedId = p.studentSourcedId
        WHERE (p.status IS NULL OR lower(p.status) != 'closed') ORDER BY p.reviewDate`).all();
      const failing = rows.filter((r) => r.reviewDate && r.reviewDate < ctx.today)
        .map((r) => ({ id: r.id, label: `${r.type || 'plan'} — ${nameOf(r)}`, detail: `review was due ${r.reviewDate}` }));
      return outcome({ total: rows.length, failing, fix: { action: 'review-plan', table: 'learning_plans', hint: 'Hold the review, then set a new reviewDate (or set status to closed).' } });
    },
  }),
  check({
    id: 'core.documents-expiring', severity: 'recommended', subject: 'organization', title: 'Documents expiring in the next 30 days',
    why: 'Paperwork that lapses on a Tuesday is easier to renew the month before than the morning of.',
    run(db, ctx) {
      const soon = shiftDays(ctx.today, 30);
      const docs = db.prepare('SELECT * FROM documents WHERE expiresDate IS NOT NULL AND expiresDate >= ? AND expiresDate <= ? ORDER BY expiresDate').all(ctx.today, soon);
      const creds = db.prepare('SELECT * FROM staff_credentials WHERE expiresDate IS NOT NULL AND expiresDate >= ? AND expiresDate <= ? ORDER BY expiresDate').all(ctx.today, soon);
      const failing = [
        ...docs.map((d) => ({ id: d.id, label: `${d.type || 'document'} — ${d.subjectSourcedId || ''}`.trim(), detail: `expires ${d.expiresDate}` })),
        ...creds.map((c) => ({ id: c.id, label: `${c.type || 'credential'} — ${c.staffSourcedId || ''}`.trim(), detail: `expires ${c.expiresDate}` })),
      ];
      return outcome({ total: failing.length || 1, failing, warn: true, fix: { action: 'renew', table: 'documents', hint: 'Renew, then update issuedDate and expiresDate on the row.' } });
    },
  }),
  check({
    id: 'core.attendance-gap', severity: 'recommended', subject: 'student', title: 'Students absent from the register 10+ school days',
    why: 'A child with no attendance at all for two weeks has probably left, and an unreported withdrawal is both a funding error and a safety question.',
    run(db, ctx) {
      const days = lastSchoolDays(db, 10, { upTo: ctx.today });
      if (days.length < 10) return outcome({ total: 0, failing: [], fix: FIX_ATTENDANCE, warn: true });
      const students = enrolledStudents(db);
      const seen = idSet(db.prepare(`SELECT DISTINCT studentSourcedId FROM attendance WHERE date IN (${ph(days)})`).all(...days), 'studentSourcedId');
      const failing = students.filter((s) => !seen.has(s.id)).map((s) => ({ id: s.id, label: nameOf(s), detail: `no attendance row since before ${days[days.length - 1]}` }));
      return outcome({ total: students.length, failing, warn: true, fix: { action: 'confirm-enrollment', table: 'enrollment_events', hint: 'Confirm the family is still enrolled, or record an enrollment_events row with event "withdrawn" and a reason.' } });
    },
  }),
];
