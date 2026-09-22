import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';
import { SqlProjection } from '../src/sql/projection.js';
import { Store } from '../src/core/store.js';
import { runAll, summarize, getCheck, runCheck, checkContext, checksFor, ALL_CHECKS } from '../src/compliance/checks.js';
import { getReport, listReports } from '../src/compliance/reports.js';
import { shiftDays, today } from '../src/compliance/util.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'librea-compliance-'));
const NOW = today();
const ago = (n) => shiftDays(NOW, -n);

/** The last `n` weekdays, oldest first. */
function weekdaysBack(n) {
  const out = [];
  for (let i = 1; out.length < n; i++) { const d = ago(i); const w = new Date(d + 'T00:00:00Z').getUTCDay(); if (w >= 1 && w <= 5) out.push(d); }
  return out.reverse();
}

/**
 * A small school where STU-1 is fully papered and STU-2 is not, so every check
 * has one passing subject and one failing one.
 */
async function fixture() {
  const dir = tmp();
  const sql = new SqlProjection(dir).open();
  const store = await new Store(dir).attach(sql).open();
  store.upsertEntity({ id: 'SCH-A', type: 'school', name: 'Oak Pod', level: 'elementary' });
  store.upsertEntity({ id: 'STU-1', type: 'student', firstName: 'Ana', lastName: 'Lopez', grade: 11, schoolId: 'SCH-A', dob: ago(365 * 17) });
  store.upsertEntity({ id: 'STU-2', type: 'student', firstName: 'Ben', lastName: 'Ng', grade: 12, schoolId: 'SCH-A', dob: ago(365 * 18) });
  store.upsertEntity({ id: 'STF-1', type: 'staff', firstName: 'Tess', lastName: 'Ruiz', role: 'teacher', schoolId: 'SCH-A' });
  store.upsertEntity({ id: 'STF-2', type: 'staff', firstName: 'Sam', lastName: 'Cole', role: 'aide', schoolId: 'SCH-A' });

  const days = weekdaysBack(30);
  const att = [];
  for (const d of days) {
    att.push({ id: `a1-${d}`, studentSourcedId: 'STU-1', date: d, code: 'present' });
    // STU-2 is absent for the last 4 school days and missing 6 days before that.
    const i = days.indexOf(d);
    // ...and one day carries a code no apportionment report recognizes.
    if (i >= 6) att.push({ id: `a2-${d}`, studentSourcedId: 'STU-2', date: d, code: i === days.length - 5 ? '' : i >= days.length - 4 ? 'absent' : 'present' });
  }
  store.upsertFacts('attendance', att, 'test');

  store.upsertFacts('contacts', [{ id: 'c1', studentSourcedId: 'STU-1', name: 'Mom', relation: 'mother', phone: '555' }], 'test');
  store.upsertFacts('immunizations', [{ id: 'i1', studentSourcedId: 'STU-1', vaccine: 'MMR', date: ago(400), exemption: 'none' }], 'test');
  store.upsertFacts('documents', [
    { id: 'd1', subjectType: 'student', subjectSourcedId: 'STU-1', type: 'enrollment', status: 'on-file', issuedDate: ago(100) },
    { id: 'd2', subjectType: 'student', subjectSourcedId: 'STU-1', type: 'emergency-card', status: 'on-file', issuedDate: ago(100), expiresDate: shiftDays(NOW, 10) },
    { id: 'd3', subjectType: 'student', subjectSourcedId: 'STU-1', type: 'consent', status: 'on-file' },
    { id: 'd4', subjectType: 'student', subjectSourcedId: 'STU-1', type: 'residency', status: 'on-file' },
    { id: 'd5', subjectType: 'student', subjectSourcedId: 'STU-2', type: 'enrollment', status: 'expired', issuedDate: ago(900), expiresDate: ago(30) },
    { id: 'd6', subjectType: 'organization', subjectSourcedId: 'SCH-A', type: 'affidavit', status: 'on-file', issuedDate: NOW },
  ], 'test');
  store.upsertFacts('staff_credentials', [
    { id: 'k1', staffSourcedId: 'STF-1', type: 'background-check', status: 'valid', expiresDate: shiftDays(NOW, 200) },
    { id: 'k2', staffSourcedId: 'STF-1', type: 'mandated-reporter', status: 'valid', expiresDate: shiftDays(NOW, 200) },
    { id: 'k3', staffSourcedId: 'STF-1', type: 'cpr-first-aid', status: 'valid', expiresDate: shiftDays(NOW, 200) },
    { id: 'k4', staffSourcedId: 'STF-1', type: 'teaching-credential', status: 'valid' },
    { id: 'k5', staffSourcedId: 'STF-2', type: 'background-check', status: 'valid', expiresDate: ago(1) }, // expired
  ], 'test');
  store.upsertFacts('drills', [{ id: 'dr1', orgSourcedId: 'SCH-A', type: 'fire', date: ago(7), participants: 20 }], 'test');
  store.upsertFacts('discipline_incidents', [
    { id: 'x1', studentSourcedId: 'STU-2', date: ago(5), type: 'conflict', action: 'restorative circle' },
    { id: 'x2', studentSourcedId: 'STU-2', date: ago(12), type: 'conflict', action: '' },
    { id: 'x3', studentSourcedId: 'STU-2', date: ago(20), type: 'conflict', action: 'conference' },
  ], 'test');
  store.upsertFacts('learning_plans', [
    { id: 'p1', studentSourcedId: 'STU-1', type: 'ILP', status: 'active', reviewDate: shiftDays(NOW, 30) },
    { id: 'p2', studentSourcedId: 'STU-2', type: 'ILP', status: 'active', reviewDate: ago(15) }, // overdue
  ], 'test');
  store.upsertFacts('services', [{ id: 'sv1', studentSourcedId: 'STU-2', type: 'IEP' }], 'test');
  store.upsertFacts('classes', [{ sourcedId: 'CL-1', title: 'Oak Pod Morning', classType: 'homeroom', schoolSourcedId: 'SCH-A' }, { sourcedId: 'CL-2', title: 'Afternoon Pod', classType: 'homeroom', schoolSourcedId: 'SCH-A' }], 'test');
  store.upsertFacts('enrollments', [
    { sourcedId: 'e1', classSourcedId: 'CL-1', userSourcedId: 'STF-1', role: 'teacher' },
    { sourcedId: 'e2', classSourcedId: 'CL-2', userSourcedId: 'STF-2', role: 'teacher' },
  ], 'test');
  return { dir, sql, store, days };
}

const byId = (results) => Object.fromEntries(results.map((r) => [r.id, r]));
const failingIds = (r) => r.failing.map((f) => f.id);

test('core pack: one passing subject and one failing one for every check', async () => {
  const { sql } = await fixture();
  const r = byId(runAll(sql.db, { packs: ['core'] }));

  assert.equal(r['core.emergency-contact'].status, 'fail');
  assert.deepEqual(failingIds(r['core.emergency-contact']), ['STU-2']);
  assert.equal(r['core.emergency-contact'].total, 2);

  assert.deepEqual(failingIds(r['core.immunization']), ['STU-2']);
  assert.deepEqual(failingIds(r['core.enrollment-form']), ['STU-2'], 'an expired enrollment form is not on file');
  assert.deepEqual(failingIds(r['core.emergency-card']), ['STU-2']);

  assert.equal(r['core.attendance-complete'].status, 'fail');
  assert.deepEqual(failingIds(r['core.attendance-complete']), ['STU-2']);
  assert.match(r['core.attendance-complete'].failing[0].detail, /missing 6 of 30 school days/);

  assert.deepEqual(failingIds(r['core.background-check']), ['STF-2'], 'an expired clearance is not a clearance');
  assert.deepEqual(failingIds(r['core.mandated-reporter']), ['STF-2']);
  assert.equal(r['core.cpr-first-aid'].status, 'pass');
  assert.equal(r['core.fire-drill'].status, 'pass');
  assert.equal(r['core.lockdown-drill'].status, 'fail', 'a fire drill is not a lockdown drill');

  assert.deepEqual(failingIds(r['core.incident-action']), ['x2']);
  assert.deepEqual(failingIds(r['core.plan-review-overdue']), ['p2']);
  assert.equal(r['core.documents-expiring'].status, 'warn');
  assert.ok(failingIds(r['core.documents-expiring']).includes('d2'));
  assert.equal(r['core.attendance-gap'].status, 'pass', 'STU-2 is absent but still on the register');

  for (const c of r ? Object.values(r) : []) {
    assert.ok(['pass', 'fail', 'warn', 'n/a'].includes(c.status), `${c.id} status`);
    assert.ok(c.why.length > 10 && c.fix?.hint, `${c.id} explains itself`);
    assert.ok(c.failing.length <= 200);
  }
  sql.close();
});

test('an empty school reports n/a, never a false pass', async () => {
  const dir = tmp();
  const sql = new SqlProjection(dir).open();
  await new Store(dir).attach(sql).open();
  const r = byId(runAll(sql.db, { packs: ['core', 'micro', 'alt'] }));
  assert.equal(r['core.emergency-contact'].status, 'n/a');
  assert.equal(r['core.attendance-complete'].status, 'n/a');
  assert.equal(r['core.cpr-first-aid'].status, 'n/a');
  assert.equal(r['alt.credit-progress'].status, 'n/a');
  sql.close();
});

test('an open pending clearance is never satisfied by another row', async () => {
  const { sql, store } = await fixture();
  store.upsertEntity({ id: 'STF-3', type: 'staff', firstName: 'Pat', lastName: 'Osei', role: 'aide', schoolId: 'SCH-A' });
  store.upsertFacts('staff_credentials', [
    { id: 'k6', staffSourcedId: 'STF-3', type: 'fingerprinting', status: 'valid', issuedDate: ago(700), expiresDate: shiftDays(NOW, 300) },
    { id: 'k7', staffSourcedId: 'STF-3', type: 'background-check', status: 'pending', issuedDate: ago(10) },
  ], 'test');
  const run = () => runCheck(getCheck('core.background-check'), sql.db, checkContext(null));
  const detail = (r) => r.failing.find((f) => f.id === 'STF-3')?.detail;
  assert.ok(failingIds(run()).includes('STF-3'), 'a valid row of another type does not answer for a pending clearance');
  assert.match(detail(run()), /pending/);

  // The clearance comes back and they are cleared.
  store.upsertFacts('staff_credentials', [{ id: 'k7', staffSourcedId: 'STF-3', type: 'background-check', status: 'valid', issuedDate: ago(2), expiresDate: shiftDays(NOW, 700) }], 'test');
  assert.equal(failingIds(run()).includes('STF-3'), false);

  // A pending row blocks however old it is: an application nobody resolved is
  // still an application nobody resolved.
  store.upsertFacts('staff_credentials', [{ id: 'k8', staffSourcedId: 'STF-3', type: 'livescan', status: 'pending', issuedDate: ago(400) }], 'test');
  assert.ok(failingIds(run()).includes('STF-3'), 'an old dated pending row is not superseded');
  assert.match(detail(run()), /pending/);

  // ...and just as much when it carries no dates at all.
  store.upsertFacts('staff_credentials', [{ id: 'k8', staffSourcedId: 'STF-3', type: 'background-check', status: 'pending' }], 'test');
  assert.ok(failingIds(run()).includes('STF-3'), 'an undated pending row is not superseded');

  // Resolving the row is the remedy, and it is one field.
  store.deleteFacts('staff_credentials', ['k8'], 'test');
  assert.equal(failingIds(run()).includes('STF-3'), false);

  // An expired row blocks only when it is the newest thing on file.
  store.upsertFacts('staff_credentials', [{ id: 'k9', staffSourcedId: 'STF-3', type: 'background-check', status: 'expired', issuedDate: ago(900), expiresDate: ago(700) }], 'test');
  assert.equal(failingIds(run()).includes('STF-3'), false, 'an old expired row is superseded by the later valid one');
  store.upsertFacts('staff_credentials', [{ id: 'k9', staffSourcedId: 'STF-3', type: 'background-check', status: 'valid', issuedDate: ago(1), expiresDate: ago(1) }], 'test');
  assert.ok(failingIds(run()).includes('STF-3'), 'a clearance that lapsed since the last valid one does block');
  assert.match(detail(run()), /expired/);
  sql.close();
});

test('a short attendance register does not shrink the drill window', async () => {
  const { sql, store } = await fixture();
  // The fixture has 30 school days of register. The lockdown check asks about
  // the last 90 school days, which the register cannot reach, so the window
  // falls back to the calendar equivalent instead of collapsing to 30 days.
  store.upsertFacts('drills', [{ id: 'dr2', orgSourcedId: 'SCH-A', type: 'earthquake', date: ago(60), participants: 20 }], 'test');
  const r = byId(runAll(sql.db, { packs: ['core'] }));
  assert.equal(r['core.lockdown-drill'].status, 'pass', 'an earthquake drill 60 days ago is inside the 90-school-day window');
  assert.equal(r['core.fire-drill'].status, 'pass');
  // Far enough back and it is outside the window again — the answer depends on
  // when the school drilled, never on how much attendance has been entered.
  store.upsertFacts('drills', [{ id: 'dr2', orgSourcedId: 'SCH-A', type: 'earthquake', date: ago(200), participants: 20 }], 'test');
  assert.equal(byId(runAll(sql.db, { packs: ['core'] }))['core.lockdown-drill'].status, 'fail');
  sql.close();
});

test('a withdrawn student stops being the school\'s problem', async () => {
  const { sql, store } = await fixture();
  store.upsertFacts('enrollment_events', [
    { id: 'ev1', studentSourcedId: 'STU-2', orgSourcedId: 'SCH-A', event: 'enrolled', date: ago(300) },
    { id: 'ev2', studentSourcedId: 'STU-2', orgSourcedId: 'SCH-A', event: 'withdrawn', date: ago(2), reason: 'moved' },
  ], 'test');
  const r = byId(runAll(sql.db, { packs: ['core'] }));
  assert.equal(r['core.emergency-contact'].status, 'pass');
  assert.equal(r['core.emergency-contact'].total, 1);
  sql.close();
});

test('micro pack: consent, residency, ratio, guides, ILP, affidavit', async () => {
  const { sql, store } = await fixture();
  const r = byId(runAll(sql.db, { packs: ['micro'] }));
  assert.deepEqual(failingIds(r['micro.consent']), ['STU-2']);
  assert.deepEqual(failingIds(r['micro.residency']), ['STU-2']);
  assert.equal(r['micro.ratio'].status, 'pass', '2 students to 2 adults is inside 12:1');
  assert.deepEqual(failingIds(r['micro.guide-credential']), ['CL-2'], 'STF-2 holds no teaching credential');
  assert.equal(r['micro.ilp-term'].status, 'pass', 'both ILPs were reviewed inside the window');
  assert.equal(r['micro.affidavit'].status, 'pass');

  // An ILP last reviewed two terms ago is not an ILP reviewed this term.
  store.upsertFacts('learning_plans', [{ id: 'p2', studentSourcedId: 'STU-2', type: 'ILP', status: 'active', reviewDate: ago(200) }], 'test');
  const stale = runCheck(getCheck('micro.ilp-term'), sql.db, checkContext(null));
  assert.deepEqual(failingIds(stale), ['STU-2']);

  // A learner on an IEP or a 504 already has an individual plan and is not
  // asked for a second one saying the same thing.
  store.upsertFacts('learning_plans', [{ id: 'p2', studentSourcedId: 'STU-2', type: '504', status: 'active', reviewDate: ago(10) }], 'test');
  assert.equal(runCheck(getCheck('micro.ilp-term'), sql.db, checkContext(null)).status, 'pass');
  store.upsertFacts('learning_plans', [{ id: 'p2', studentSourcedId: 'STU-2', type: 'IEP', status: 'active', reviewDate: ago(10) }], 'test');
  assert.equal(runCheck(getCheck('micro.ilp-term'), sql.db, checkContext(null)).status, 'pass');

  // Enough students and the ratio turns over.
  for (let i = 3; i <= 40; i++) store.upsertEntity({ id: 'STU-' + i, type: 'student', firstName: 'Kid' + i, grade: 5, schoolId: 'SCH-A' });
  const ratio = runCheck(getCheck('micro.ratio'), sql.db, checkContext(null));
  assert.equal(ratio.status, 'fail');
  assert.match(ratio.failing[0].detail, /40 students to 2 adults/);
  // The limit is configurable.
  assert.equal(runCheck(getCheck('micro.ratio'), sql.db, checkContext({ compliance: { ratio: 15 } })).status, 'fail');
  assert.equal(runCheck(getCheck('micro.ratio'), sql.db, checkContext({ compliance: { ratio: 25 } })).status, 'pass', '20:1 is inside a 25:1 limit');
  sql.close();
});

test('alt pack: plans, credits, transition, re-engagement, ADA', async () => {
  const { sql, store } = await fixture();
  const r = byId(runAll(sql.db, { packs: ['alt'] }));
  assert.deepEqual(failingIds(r['alt.iep-504-plan']), ['STU-2'], 'an IEP service with no IEP plan');
  assert.equal(r['alt.behavior-plan'].status, 'fail');
  assert.deepEqual(failingIds(r['alt.behavior-plan']), ['STU-2'], '3 incidents in 60 days and no BSP');
  assert.equal(r['alt.transition-plan'].status, 'fail');
  assert.deepEqual(failingIds(r['alt.transition-plan']).sort(), ['STU-1', 'STU-2'], 'grade 12 and everyone 16+');
  assert.equal(r['alt.re-engagement'].status, 'warn');
  assert.deepEqual(failingIds(r['alt.re-engagement']), ['STU-2'], 'absent 4 of the last 10 school days');
  assert.equal(r['alt.ada-completeness'].status, 'fail');
  assert.ok(r['alt.ada-completeness'].failing.some((f) => /not an apportionment code/.test(f.detail) && f.id.startsWith('STU-2')));
  assert.equal(r['alt.ada-completeness'].total, 40, 'two students over twenty apportionment days');

  // Give STU-2 a plan and a transition plan; the checks clear.
  store.upsertFacts('learning_plans', [
    { id: 'p3', studentSourcedId: 'STU-2', type: 'IEP', status: 'active', reviewDate: ago(30) },
    { id: 'p4', studentSourcedId: 'STU-2', type: 'BSP', status: 'active', reviewDate: shiftDays(NOW, 30) },
    { id: 'p5', studentSourcedId: 'STU-1', type: 'transition', status: 'active' },
    { id: 'p6', studentSourcedId: 'STU-2', type: 'transition', status: 'active' },
  ], 'test');
  const after = byId(runAll(sql.db, { packs: ['alt'] }));
  assert.equal(after['alt.iep-504-plan'].status, 'pass');
  assert.equal(after['alt.behavior-plan'].status, 'pass');
  assert.equal(after['alt.transition-plan'].status, 'pass');

  // Credits: STU-1 is a junior with nothing recorded, so she is behind.
  assert.equal(r['alt.credit-progress'].status, 'fail');
  store.upsertFacts('line_items', [{ sourcedId: 'li1', title: 'English 3', classSourcedId: 'CL-1', category: 'credit' }], 'test');
  store.upsertFacts('results', [
    { sourcedId: 'r1', lineItemSourcedId: 'li1', studentSourcedId: 'STU-1', score: 20, scoreStatus: 'fully graded' },
    { sourcedId: 'r2', lineItemSourcedId: 'li1', studentSourcedId: 'STU-2', score: 2, scoreStatus: 'fully graded' },
  ], 'test');
  const credit = runCheck(getCheck('alt.credit-progress'), sql.db, checkContext(null));
  assert.deepEqual(failingIds(credit), ['STU-2']);
  assert.match(credit.failing[0].detail, /2 of 16.5 credits/);
  sql.close();
});

test('checks are well formed and packs select them', () => {
  const ids = ALL_CHECKS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  for (const c of ALL_CHECKS) {
    assert.ok(['core', 'micro', 'alt'].includes(c.pack));
    assert.ok(['required', 'recommended'].includes(c.severity));
    assert.ok(['student', 'staff', 'organization'].includes(c.subject));
    assert.equal(c.id.split('.')[0], c.pack, `${c.id} is named for its pack`);
  }
  assert.ok(checksFor(['core']).every((c) => c.pack === 'core'));
  assert.ok(checksFor(['core', 'micro']).some((c) => c.pack === 'micro'));
  assert.ok(checksFor(['nonsense']).length, 'an unknown pack falls back to core');
  const summary = summarize([{ severity: 'required', status: 'pass' }, { severity: 'required', status: 'fail' }, { severity: 'recommended', status: 'warn' }]);
  assert.deepEqual(summary.required, { pass: 1, fail: 1, warn: 0, 'n/a': 0 });
  assert.equal(summary.recommended.warn, 1);
});

test('a check that throws degrades to a warning, not a 500', async () => {
  const { sql } = await fixture();
  const bad = { id: 'core.boom', pack: 'core', severity: 'required', subject: 'student', title: 'Boom', why: 'x', run() { throw new Error('no such column'); } };
  const r = runCheck(bad, sql.db, checkContext(null));
  assert.equal(r.status, 'warn');
  assert.match(r.failing[0].detail, /no such column/);
  sql.close();
});

test('reports produce headed CSV a person can open', async () => {
  const { sql, days } = await fixture();
  const month = days[days.length - 1].slice(0, 7);

  const reg = getReport('attendance-register').generate(sql.db, { month });
  const regLines = reg.csv.split('\n');
  assert.equal(reg.filename, `attendance-register-${month}.csv`);
  assert.match(regLines[0], /^studentId,student,grade,\d\d,/);
  assert.match(regLines[0], /present,absent,recorded,ofSchoolDays$/);
  assert.ok(regLines.length >= 3, 'a header and both students');
  assert.ok(regLines.some((l) => l.startsWith('STU-1,Ana Lopez,11,')));

  const cred = getReport('staff-credentials').generate(sql.db, {});
  assert.equal(cred.csv.split('\n')[0], 'staffId,staff,role,credential,status,issued,expires,issuer,current');
  assert.ok(cred.csv.includes('background-check'));
  assert.ok(/STF-2.*background-check.*no/.test(cred.csv), 'an expired clearance is not current');

  const aff = getReport('affidavit-datasheet').generate(sql.db, {});
  assert.equal(aff.csv.split('\n')[0], 'section,key,value');
  assert.ok(aff.csv.includes('Oak Pod'));
  assert.ok(/enrollment-by-grade,total,2/.test(aff.csv));

  const imm = getReport('immunization-status').generate(sql.db, {});
  assert.ok(imm.csv.includes('STU-2,Ben Ng,12,missing'));

  const ada = getReport('ada-summary').generate(sql.db, { month });
  const adaLines = ada.csv.split('\n');
  assert.equal(adaLines[0], 'month,studentId,student,grade,schoolDays,daysRecorded,daysPresent,daysAbsent,apportionmentRate');
  assert.equal(ada.filename, `ada-summary-${month}.csv`);
  assert.ok(adaLines.length >= 3, 'a row per student for the month');
  assert.ok(adaLines.slice(1).every((l) => l.startsWith(month + ',')), 'only the month asked for');

  for (const r of listReports()) {
    const out = getReport(r.id).generate(sql.db, {});
    assert.ok(out.filename.endsWith('.csv'), r.id);
    assert.ok(out.csv.split('\n')[0].includes(','), `${r.id} has a header row`);
  }
  sql.close();
});

test('HTTP: status, one check, reports, and the family to-do list', async (t) => {
  const dataDir = tmp();
  const app = await createApp({ dataDir, warm: false });
  const server = await app.router.listen(0);
  t.after(() => { app.close(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body, token) => {
    const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    return { status: res.status, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
  };
  await call('POST', '/api/auth/bootstrap', { username: 'admin', password: 'librea-admin' });
  const tok = (await call('POST', '/api/auth/login', { username: 'admin', password: 'librea-admin' })).json.token;

  app.store.upsertEntity({ id: 'SCH-A', type: 'school', name: 'Oak Pod' });
  app.store.upsertEntity({ id: 'STU-1', type: 'student', firstName: 'Ana', lastName: 'Lopez', grade: 4, schoolId: 'SCH-A' });
  app.store.upsertFacts('contacts', [{ id: 'c1', studentSourcedId: 'STU-1', name: 'Mom', phone: '555' }], 'test');
  app.store.upsertFacts('documents', [{ id: 'd1', subjectType: 'student', subjectSourcedId: 'STU-1', type: 'enrollment', status: 'on-file' }], 'test');

  const st = (await call('GET', '/api/compliance/status', null, tok)).json;
  assert.ok(st.packs.includes('core'));
  assert.ok(st.checks.length >= 14);
  assert.equal(st.checks.some((c) => 'failing' in c), false, 'status carries no failing lists');
  const contact = st.checks.find((c) => c.id === 'core.emergency-contact');
  assert.equal(contact.status, 'pass');
  assert.equal(contact.failingCount, 0);
  assert.ok(contact.why && contact.fix.table === 'contacts');
  assert.equal(st.summary.required.fail + st.summary.required.pass + st.summary.required.warn + st.summary.required['n/a'] > 0, true);

  const card = (await call('GET', '/api/compliance/checks/core.emergency-card', null, tok)).json;
  assert.equal(card.status, 'fail');
  assert.deepEqual(card.failing.map((f) => f.id), ['STU-1']);
  assert.equal((await call('GET', '/api/compliance/checks/core.nope', null, tok)).status, 404);

  const reports = (await call('GET', '/api/compliance/reports', null, tok)).json.reports;
  assert.ok(reports.some((r) => r.id === 'ada-summary'));
  const csv = await call('GET', '/api/compliance/reports/enrollment-roster.csv', null, tok);
  assert.equal(csv.status, 200);
  assert.match(csv.text.split('\n')[0], /^studentId,student,grade,school,/);
  assert.equal((await call('GET', '/api/compliance/reports/nope.csv', null, tok)).status, 404);

  // The run is on the ledger, with no names in it.
  const ledger = fs.readFileSync(path.join(dataDir, 'ledger.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse);
  const runs = ledger.filter((e) => e.type === 'compliance.run');
  assert.equal(runs.length, 1);
  assert.ok(runs[0].data.packs.includes('core'));
  assert.ok(runs[0].data.summary.required);
  assert.equal(/Ana|Lopez|STU-1/.test(JSON.stringify(runs[0].data)), false, 'the proof-of-check carries no PII');
  assert.equal(app.store.ledger.verify().ok, true);
  assert.equal(app.sql.seq, app.store.ledger.seq, 'the projection kept up with the log');

  // Families and students are not given the school-side view.
  const fam = app.auth.createUser({ username: 'fam1', password: 'family-pass-1', role: 'family', entityIds: ['STU-1'] });
  const famTok = (await call('POST', '/api/auth/login', { username: 'fam1', password: 'family-pass-1' })).json.token;
  assert.equal((await call('GET', '/api/compliance/status', null, famTok)).status, 403);
  assert.equal((await call('GET', '/api/compliance/checks/core.emergency-card', null, famTok)).status, 403);
  assert.equal((await call('GET', '/api/compliance/reports/enrollment-roster.csv', null, famTok)).status, 403);
  assert.equal((await call('GET', '/api/compliance/status')).status, 401);

  const mine = (await call('GET', '/api/compliance/mine', null, famTok)).json;
  assert.equal(mine.students.length, 1);
  assert.equal(mine.students[0].studentId, 'STU-1');
  assert.equal(mine.students[0].complete, false);
  assert.match(mine.students[0].headline, /^Missing: /);
  assert.match(mine.students[0].headline, /emergency card/);
  assert.equal(mine.students[0].items.find((i) => i.key === 'enrollment').status, 'pass');
  assert.equal(mine.students[0].items.find((i) => i.key === 'emergency-contact').status, 'pass');
  assert.equal(mine.students[0].items.find((i) => i.key === 'emergency-card').status, 'fail');
  assert.ok(mine.students[0].items.every((i) => i.why && i.detail), 'every line says why it matters and what to do');
  // The flat list a home-page card renders, without knowing how many children.
  assert.equal(mine.items.length, mine.students[0].items.length);
  assert.equal(mine.missingCount, 2, 'the immunization record and the emergency card');
  assert.equal(mine.items.filter((i) => i.status !== 'pass').length, 2);
  assert.ok(mine.items.every((i) => i.studentId === 'STU-1'));
  assert.equal((await call('GET', '/api/compliance/mine', null, tok)).status, 400, 'an admin has no own-child list');
  assert.ok(fam);
});

test('HTTP: the edition chooses the packs', async (t) => {
  const prev = process.env.LIBREA_EDITION;
  process.env.LIBREA_EDITION = 'micro';
  try {
    const dataDir = tmp();
    const app = await createApp({ dataDir, warm: false });
    const server = await app.router.listen(0);
    t.after(() => { app.close(); server.close(); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = async (method, url, body, token) => { const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, json: await res.json().catch(() => null) }; };
    await call('POST', '/api/auth/bootstrap', { username: 'admin', password: 'librea-admin' });
    const tok = (await call('POST', '/api/auth/login', { username: 'admin', password: 'librea-admin' })).json.token;
    const st = (await call('GET', '/api/compliance/status', null, tok)).json;
    // editions/micro/edition.json may not exist yet; loadEdition then falls back to base.
    assert.ok(st.packs.includes('core'));
    assert.ok(st.checks.every((c) => st.packs.includes(c.pack)));
    const catalog = (await call('GET', '/api/compliance/catalog', null, tok)).json;
    assert.ok(catalog.checks.some((c) => c.pack === 'micro'), 'the micro checks exist whether or not this edition runs them');
  } finally {
    if (prev === undefined) delete process.env.LIBREA_EDITION; else process.env.LIBREA_EDITION = prev;
  }
});
