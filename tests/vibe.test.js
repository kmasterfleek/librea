// The vibe-coding layer: slugs, extraction, offline templates, the broker's
// scope enforcement, app persistence, and the generate route end to end.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/core/store.js';
import { SqlProjection } from '../src/sql/projection.js';
import { slugify, uniqueSlug, isValidSlug, AppStore, defaultScopeFor, scopeBadge, normalizeScope } from '../src/vibe/apps.js';
import { extractHtml, buildMessages, buildSystemPrompt } from '../src/vibe/prompt.js';
import { renderTemplate, chooseTemplate } from '../src/vibe/templates.js';
import { runQuery, K_ANON } from '../src/vibe/query.js';
import { injectRuntime, auditHtml, titleFrom, scrub } from '../src/vibe/routes.js';
import { RUNTIME_JS } from '../src/vibe/runtime.js';
import { narrowScope, scopeFor } from '../src/core/auth.js';
import { createApp } from '../src/server.js';

// ------------------------------------------------------------------ slugs

test('slugify makes path-safe, readable slugs', () => {
  assert.equal(slugify('A dashboard of chronic absenteeism by school'), 'dashboard-chronic-absenteeism-school');
  assert.equal(slugify('A website for the Robotics Club!!'), 'website-robotics-club');
  assert.equal(slugify('me'), 'me-app');
  assert.equal(slugify(''), 'app');
  assert.equal(slugify('../../etc/passwd'), 'etc-passwd');
  for (const s of ['A dashboard of chronic absenteeism', '../../etc/passwd', 'me', '', '???', 'x'.repeat(200)]) {
    assert.ok(isValidSlug(slugify(s)), `not a valid slug: ${slugify(s)}`);
  }
  assert.ok(!isValidSlug('Bad Slug'));
  assert.ok(!isValidSlug('ab'));
  assert.ok(!isValidSlug('../x'));
});

test('uniqueSlug avoids collisions and reserved names', () => {
  const taken = new Set(['roster', 'roster-2']);
  assert.equal(uniqueSlug('roster', taken), 'roster-3');
  assert.equal(uniqueSlug('club', taken), 'club');
  assert.equal(uniqueSlug('api', new Set()), 'api-app');
});

// ------------------------------------------------------------- extractHtml

test('extractHtml pulls the document out of fenced or bare replies', () => {
  const doc = '<!doctype html>\n<html><body>hi</body></html>';
  assert.equal(extractHtml('Sure, here you go:\n\n```html\n' + doc + '\n```\n\nEnjoy!'), doc);
  assert.equal(extractHtml(doc), doc);
  assert.equal(extractHtml('Here it is:\n' + doc + '\nLet me know.'), doc);
  assert.equal(extractHtml('```\n<html><body>x</body></html>\n```'), '<html><body>x</body></html>');
  assert.throws(() => extractHtml('I cannot do that.'), /did not return an HTML document/);
  assert.throws(() => extractHtml(''), /did not return an HTML document/);
});

test('the system prompt carries shapes and a synthetic row, never real data', () => {
  const sys = buildSystemPrompt({ scope: { visibility: ['school'], pii: false, aggregatesOnly: true }, viewer: { role: 'student' } });
  assert.match(sys, /STU-EXAMPLE-0001/);
  assert.match(sys, /window\.librea/);
  assert.match(sys, /AGGREGATES ONLY/);
  assert.match(sys, /attendance\s+Attendance/);
  assert.match(sys, /HARD RULES/);
  const msgs = buildMessages('add a chart', '<html>prior</html>');
  assert.match(msgs[0].content, /prior/);
  assert.match(msgs[0].content, /FULL rewritten HTML document/);
});

// --------------------------------------------------------------- templates

test('the template provider builds a valid app for several prompts', () => {
  const prompts = [
    'a dashboard of chronic absenteeism by school',
    'a website for the robotics club with a roster',
    'a page where my 5th graders submit their science fair reflections',
    'show me my own signal radar',
    'find students who love building things',
  ];
  const seen = new Set();
  for (const p of prompts) {
    const { html, template } = renderTemplate(p, 'Test App');
    seen.add(template);
    assert.ok(html.startsWith('<!doctype html>'), p);
    assert.ok(html.trimEnd().endsWith('</html>'), p);
    assert.match(html, /librea\.ready\s*\(/, p);
    assert.match(html, /librea\.footer\s*\(/, p);
    assert.equal(auditHtml(html).length, 0, `${p}: ${auditHtml(html).join('; ')}`);
    assert.doesNotThrow(() => extractHtml(html));
  }
  assert.ok(seen.size >= 4, `expected several distinct templates, got ${[...seen]}`);
  const dash = renderTemplate('a dashboard of chronic absenteeism by school', 'Absence').html;
  assert.match(dash, /librea\.sql\(/, 'the dashboard reads through SQL');
  assert.match(dash, /FROM attendance a JOIN students/, 'and joins the attendance rows');
  assert.match(dash, /librea\.aggregate\(/, 'with a fallback when no attendance rows exist');
  assert.match(renderTemplate('a class list for my homeroom', 'Class').html, /FROM enrollments e/);
  assert.equal(chooseTemplate('a class list for my homeroom').name, 'enrollments');
  assert.equal(chooseTemplate('something completely unrelated to school apps').name, 'generic');
  assert.equal(chooseTemplate('an attendance dashboard').name, 'dashboard');
});

test('logged error messages carry no quoted literal', () => {
  assert.equal(scrub('no such column: "Ada Lovelace"'), "no such column: '\u2026'");
  assert.equal(scrub("no such column: 'Ada Lovelace'"), "no such column: '\u2026'");
  assert.equal(scrub("near \"STU-0001\": syntax error at 'Rivera'"), "near '\u2026': syntax error at '\u2026'");
  assert.equal(scrub('no such column: "Ada'), "no such column: '\u2026'", 'an unterminated quote is stripped too');
  assert.equal(scrub('only SELECT is allowed'), 'only SELECT is allowed');
  assert.equal(scrub(undefined), 'error');
  assert.ok(scrub('x'.repeat(500)).length === 200);
  for (const m of ["WHERE familyName = 'Rivera'", 'value "9145550101" not found', "a'b'c'd"]) {
    assert.ok(!/Rivera|9145550101|b/.test(scrub(m)), scrub(m));
  }
});

test('default titles break at a word, not mid-word', () => {
  const long = titleFrom('a dashboard of chronic absenteeism by school with a bar chart and a line chart per grade');
  assert.ok(long.length <= 60, long);
  assert.ok(!/\s$/.test(long));
  assert.ok('a dashboard of chronic absenteeism by school with a bar chart and a line chart per grade'.includes(long.slice(1)), 'must cut at a word boundary');
  assert.equal(titleFrom('A website for the Robotics Club!'), 'Website for the Robotics Club');
  assert.equal(titleFrom('Build me a page where I reflect.'), 'Page where I reflect');
  assert.equal(titleFrom('the roster'), 'Roster');
  assert.equal(titleFrom('   '), 'Librea app');
  for (const p of ['a dashboard', 'x'.repeat(200), 'show me my own radar', '???']) {
    const t = titleFrom(p);
    assert.ok(t.length && t.length <= 60 && !/[\s,;:.!?-]$/.test(t), JSON.stringify(t));
  }
});

test('the runtime is injected as the first script in head', () => {
  const out = injectRuntime('<!doctype html>\n<html><head><title>x</title></head><body></body></html>');
  assert.ok(out.indexOf('window.librea') < out.indexOf('<title>'));
  assert.ok(out.includes(RUNTIME_JS));
  assert.match(injectRuntime('<html><body>x</body></html>'), /<head><script>/);
  assert.ok(RUNTIME_JS.split('\n').length < 400);
});

test('auditHtml reports network escapes without rewriting them', () => {
  const bad = '<!doctype html><html><head><script src="https://cdn.example/x.js"></script></head><body><script>fetch("/x")</script></body></html>';
  const w = auditHtml(bad);
  assert.ok(w.some((x) => /external script/.test(x)));
  assert.ok(w.some((x) => /calls the network/.test(x)));
  assert.ok(w.some((x) => /librea\.ready/.test(x)));
});

// ------------------------------------------------------- store-backed tests

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'librea-vibe-'));
let store, sqlProj;

test.before(async () => {
  sqlProj = new SqlProjection(dataDir).open();
  store = await new Store(dataDir).attach(sqlProj).open();
  store.upsertEntity({ id: 'SCH-BIG', type: 'school', name: 'Big Elementary' });
  store.upsertEntity({ id: 'SCH-TINY', type: 'school', name: 'Tiny Elementary' });
  for (let i = 1; i <= 8; i++) {
    store.upsertEntity({ id: 'STU-' + i, type: 'student', firstName: 'Kid' + i, lastName: 'Test', grade: 5, schoolId: 'SCH-BIG', metrics: { gpa: 3, attendancePct: 80 + i } });
  }
  for (let i = 9; i <= 11; i++) {
    store.upsertEntity({ id: 'STU-' + i, type: 'student', firstName: 'Kid' + i, lastName: 'Test', grade: 6, schoolId: 'SCH-TINY', metrics: { gpa: 2, attendancePct: 70 } });
  }
  const rows = [];
  for (let i = 1; i <= 11; i++) for (let d = 1; d <= 4; d++) rows.push({ id: `A-${i}-${d}`, studentSourcedId: 'STU-' + i, date: `2025-01-0${d}`, code: d === 1 && i % 2 ? 'absent' : 'present' });
  store.ledger.append('fact.upsert', { table: 'attendance', rows }, 'test');
  sqlProj.applyMany([...store.ledger.replay()].filter((e) => e.type === 'fact.upsert'));
  sqlProj.rebuild(store);
});

test.after(() => { try { sqlProj.close(); } catch { /* already closed */ } });

const ctxFor = (user, appScope) => ({ user, scope: appScope ? narrowScope(scopeFor(user), appScope) : scopeFor(user), app: appScope ? { slug: 'test-app', title: 'Test' } : null });
const STAFF = { username: 'teach', role: 'staff', entityId: 'STF-0', displayName: 'Teacher' };
const STUDENT = { username: 'stu-1', role: 'student', entityId: 'STU-1', displayName: 'Kid1' };

test('broker: an aggregates-only app suppresses small groups', async () => {
  const ctx = ctxFor(STUDENT, { aggregatesOnly: true, pii: false, entityIds: ['STU-1'] });
  const agg = await runQuery({ op: 'aggregate', args: { groupBy: 'schoolId', metric: 'count' } }, ctx, store);
  assert.equal(agg.kAnonymity, K_ANON);
  assert.deepEqual(agg.groups.map((g) => g.key), ['SCH-BIG']);
  assert.equal(agg.groups[0].value, 8);
  assert.equal(agg.suppressed, 3, 'the three-student school must not be reportable');

  const staffAgg = await runQuery({ op: 'aggregate', args: { groupBy: 'schoolId', metric: 'count' } }, ctxFor(STAFF), store);
  assert.equal(staffAgg.groups.length, 2, 'staff outside an aggregates-only app see every group');
  assert.equal(staffAgg.suppressed, 0);

  const mean = await runQuery({ op: 'aggregate', args: { groupBy: 'grade', metric: 'attendance' } }, ctx, store);
  assert.ok(mean.groups[0].value > 0 && mean.groups[0].value <= 1);
  await assert.rejects(runQuery({ op: 'aggregate', args: { groupBy: 'nope' } }, ctx, store), /groupBy must be one of/);
  await assert.rejects(runQuery({ op: 'aggregate', args: { metric: 'secret' } }, ctx, store), /metric must be/);
});

test('broker: a student cannot read another student, in or out of an app', async () => {
  const plain = ctxFor(STUDENT);
  assert.equal((await runQuery({ op: 'person', args: { id: 'STU-1' } }, plain, store)).person.id, 'STU-1');
  await assert.rejects(runQuery({ op: 'person', args: { id: 'STU-2' } }, plain, store), /no such person/);
  assert.equal((await runQuery({ op: 'people', args: {} }, plain, store)).total, 1);

  const app = ctxFor(STUDENT, { aggregatesOnly: true, pii: false, entityIds: ['STU-1'] });
  assert.equal((await runQuery({ op: 'people', args: {} }, app, store)).total, 1);
  await assert.rejects(runQuery({ op: 'person', args: { id: 'STU-3' } }, app, store), /no such person/);
  await assert.rejects(runQuery({ op: 'similar', args: { id: 'STU-3' } }, app, store), /no such person/);
  assert.deepEqual((await runQuery({ op: 'similar', args: { id: 'STU-1' } }, app, store)).similar, []);
  assert.equal((await runQuery({ op: 'me', args: {} }, app, store)).scope.aggregatesOnly, true);
});

test('broker: an admin inside an aggregates-only app loses individual reads too', async () => {
  const admin = { username: 'admin', role: 'admin' };
  const ctx = ctxFor(admin, { aggregatesOnly: true, pii: false });
  assert.equal((await runQuery({ op: 'people', args: {} }, ctx, store)).total, 0);
  await assert.rejects(runQuery({ op: 'person', args: { id: 'STU-1' } }, ctx, store), /no such person/);
  assert.equal((await runQuery({ op: 'aggregate', args: {} }, ctx, store)).groups.length, 1);
});

test('broker: PII is stripped when the app declares pii:false', async () => {
  const withNames = await runQuery({ op: 'people', args: { type: 'student' } }, ctxFor(STAFF), store);
  assert.equal(withNames.people[0].firstName, 'Kid1');
  const noNames = await runQuery({ op: 'people', args: { type: 'student' } }, ctxFor(STAFF, { pii: false }), store);
  assert.equal(noNames.people.length, 11);
  for (const p of noNames.people) {
    assert.equal(p.firstName, undefined);
    assert.equal(p.lastName, undefined);
    assert.ok(p.id && p.outcome);
  }
  const one = await runQuery({ op: 'person', args: { id: 'STU-2' } }, ctxFor(STAFF, { pii: false }), store);
  assert.equal(one.person.firstName, undefined);
});

test('broker: bad input is rejected at the boundary', async () => {
  const ctx = ctxFor(STAFF);
  await assert.rejects(runQuery({ op: 'drop_everything' }, ctx, store), /unknown op/);
  await assert.rejects(runQuery({ op: 'people', args: [] }, ctx, store), /args must be an object/);
  await assert.rejects(runQuery({ op: 'person', args: {} }, ctx, store), /id required/);
  await assert.rejects(runQuery({ op: 'people', args: { type: 'wizard' } }, ctx, store), /type must be one of/);
  await assert.rejects(runQuery({ op: 'search', args: { q: '' } }, ctx, store), /q required/);
  await assert.rejects(runQuery({ op: 'addFragment', args: { entityId: 'STU-3', text: 'x' } }, ctxFor(STUDENT), store), /only write to your own record/);
  assert.equal((await runQuery({ op: 'people', args: { limit: 99999 } }, ctx, store)).limit, 500);
});

test('broker: an app may write one fragment to the viewer’s own record', async () => {
  const ctx = ctxFor(STUDENT, { aggregatesOnly: true, pii: false, entityIds: ['STU-1'] });
  const r = await runQuery({ op: 'addFragment', args: { entityId: 'STU-1', kind: 'self', text: 'I built a robot arm out of cardboard.', visibility: 'school' } }, ctx, store);
  assert.equal(r.fragment.entityId, 'STU-1');
  assert.equal(r.fragment.source, 'app:test-app');
  const back = await runQuery({ op: 'fragments', args: { id: 'STU-1' } }, ctx, store);
  assert.equal(back.fragments.length, 1);
  await assert.rejects(runQuery({ op: 'addFragment', args: { entityId: 'STU-1', kind: 'observation', text: 'x' } }, ctx, store), /students add self/);
});

test('broker: sql runs under the viewer\u2019s scope', async () => {
  const staff = ctxFor(STAFF);
  const r = await runQuery({ op: 'sql', args: { sql: 'SELECT schoolSourcedId AS school, COUNT(*) AS n FROM students GROUP BY schoolSourcedId ORDER BY n DESC' } }, staff, store, { sql: sqlProj });
  assert.deepEqual(r.columns, ['school', 'n']);
  assert.equal(r.rows[0].n, 8);
  assert.equal(r.truncated, false);
  assert.ok(typeof r.ms === 'number');

  // the absence-rate query the dashboard template runs
  const rate = await runQuery({ op: 'sql', args: { sql: "SELECT o.name AS school, ROUND(100.0 * SUM(CASE WHEN a.code IN ('absent','excused') THEN 1 ELSE 0 END) / COUNT(*), 1) AS absenceRate, COUNT(DISTINCT a.studentSourcedId) AS students FROM attendance a JOIN students s ON s.sourcedId = a.studentSourcedId JOIN orgs o ON o.sourcedId = s.schoolSourcedId GROUP BY o.sourcedId ORDER BY absenceRate DESC" } }, staff, store, { sql: sqlProj });
  assert.ok(rate.rowCount >= 1, 'the attendance join must return rows');
  assert.ok(rate.rows.every((x) => x.absenceRate >= 0 && x.absenceRate <= 100));
});

test('broker: sql cannot reach other students, names, or anything but SELECT', async () => {
  const app = ctxFor(STUDENT, { aggregatesOnly: true, pii: false, entityIds: ['STU-1'] });
  const run = (sql) => runQuery({ op: 'sql', args: { sql } }, app, store, { sql: sqlProj });

  const mine = await run('SELECT sourcedId FROM students');
  assert.deepEqual(mine.rows.map((r) => r.sourcedId), ['STU-1'], 'a student sees only their own row');
  assert.equal((await run('SELECT COUNT(*) AS n FROM students')).rows[0].n, 1);
  assert.equal((await run("SELECT COUNT(*) AS n FROM attendance WHERE studentSourcedId = 'STU-7'")).rows[0].n, 0);
  await assert.rejects(run('SELECT givenName FROM students'), /SQL error/, 'name columns do not exist in this scope');

  for (const bad of [
    'DROP TABLE students',
    'DELETE FROM students',
    "UPDATE students SET grade = 1",
    'SELECT 1; DROP TABLE students',
    'PRAGMA table_info(students)',
    "SELECT * FROM sqlite_master",
    "SELECT * FROM main.students",
  ]) await assert.rejects(run(bad), /only SELECT|one statement only|forbidden object|SQL error/, bad);

  await assert.rejects(run(''), /sql required/);
  await assert.rejects(runQuery({ op: 'sql', args: { sql: 'SELECT 1' } }, app, store, {}), /not available/);
});

test('broker: sqlSchema hides what the scope hides', async () => {
  const staff = await runQuery({ op: 'sqlSchema' }, ctxFor(STAFF), store, { sql: sqlProj });
  assert.equal(staff.dialect, 'sqlite');
  const students = staff.tables.find((t) => t.name === 'students');
  assert.ok(students.columns.includes('givenName'));
  assert.ok(staff.tables.some((t) => t.name === 'contacts'));

  const kid = await runQuery({ op: 'sqlSchema' }, ctxFor(STUDENT, { aggregatesOnly: true, pii: false, entityIds: ['STU-1'] }), store, { sql: sqlProj });
  assert.ok(!kid.tables.find((t) => t.name === 'students').columns.includes('givenName'));
  assert.ok(!kid.tables.some((t) => t.name === 'contacts'), 'contacts are hidden without names');
  assert.ok(kid.notes.some((n) => /1 record/.test(n)));
  assert.ok(kid.notes.some((n) => /2000 rows/.test(n)));
});

test('the people op reports truncation', async () => {
  const r = await runQuery({ op: 'people', args: { type: 'student', limit: 5 } }, ctxFor(STAFF), store);
  assert.equal(r.people.length, 5);
  assert.equal(r.total, 11);
  assert.equal(r.truncated, true);
  assert.equal((await runQuery({ op: 'people', args: { type: 'student' } }, ctxFor(STAFF), store)).truncated, false);
});

// ------------------------------------------------------- app persistence

test('apps round-trip through the ledger and the disk', async () => {
  const apps = new AppStore(store, dataDir);
  const user = { username: 'teach', role: 'staff', displayName: 'Teacher' };
  const scope = defaultScopeFor(user, scopeFor(user), { includePii: false });
  assert.equal(scope.pii, false);
  assert.equal(scope.aggregatesOnly, undefined);
  assert.match(scopeBadge(scope), /no names/);
  assert.deepEqual(normalizeScope({ visibility: ['school', 'nope'], pii: true, junk: 1 }), { visibility: ['school'] });

  const studentScope = defaultScopeFor(STUDENT, scopeFor(STUDENT));
  assert.equal(studentScope.aggregatesOnly, true);
  assert.deepEqual(studentScope.entityIds, ['STU-1']);

  const v1 = apps.save({ slug: 'roster-test', title: 'Roster', prompt: 'a roster', html: renderTemplate('a roster', 'Roster').html, provider: 'template', model: 'librea-templates', scope, user, templateGenerated: true });
  assert.equal(v1.version, 1);
  const v2 = apps.save({ slug: 'roster-test', title: 'Roster', prompt: 'add grades', html: '<!doctype html><html><body>v2</body></html>', provider: 'template', model: 'librea-templates', scope, user });
  assert.equal(v2.version, 2);
  assert.deepEqual(apps.versions('roster-test'), [1, 2]);
  assert.equal(apps.history?.length, undefined);
  assert.equal(v2.history.length, 2);
  assert.match(apps.readHtml('roster-test', 1), /librea\.ready/);
  assert.match(apps.readHtml('roster-test', 2), /v2/);
  assert.ok(fs.existsSync(path.join(dataDir, 'apps', 'roster-test', 'v2.html')));

  assert.equal(apps.canEdit(v2, user), true);
  assert.equal(apps.canEdit(v2, STUDENT), false);
  assert.equal(apps.canView(v2, STUDENT), false, 'a draft is invisible to everyone but its author');
  apps.update('roster-test', { published: true }, user);
  assert.equal(apps.canView(apps.get('roster-test'), STUDENT), true);
  assert.throws(() => apps.update('roster-test', { title: 'Mine now' }, STUDENT), /not your app/);

  // the manifest survives a reopen, because it lives in the hash-chained ledger
  store.snapshot();
  const reopened = await new Store(dataDir).open();
  assert.equal(reopened.apps.get('roster-test').version, 2);
  assert.equal(reopened.apps.get('roster-test').published, true);
  assert.ok(reopened.ledger.verify().ok !== false);

  assert.equal(apps.remove('roster-test', user), true);
  assert.equal(apps.get('roster-test'), null);
  assert.ok(!fs.existsSync(path.join(dataDir, 'apps', 'roster-test')));
});

// ------------------------------------------------------ end to end over HTTP

test('generate, publish, open and query an app over HTTP', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'librea-vibe-http-'));
  process.env.LIBREA_MODEL_PROVIDER = 'template';
  const app = await createApp({ dataDir: dir, warm: false });
  const server = await app.router.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => { app.close(); server.close(); });

  app.store.upsertEntity({ id: 'SCH-A', type: 'school', name: 'A Elementary' });
  for (let i = 1; i <= 7; i++) app.store.upsertEntity({ id: 'S-' + i, type: 'student', firstName: 'Kid' + i, lastName: 'T', grade: 3, schoolId: 'SCH-A', metrics: { gpa: 3, attendancePct: 90 } });

  const jar = {};
  const call = async (who, method, url, body, extra = {}) => {
    const headers = { 'content-type': 'application/json', ...extra };
    if (jar[who]) headers.cookie = jar[who];
    const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.get('set-cookie');
    if (sc) jar[who] = sc.split(';')[0];
    return res;
  };

  await call('admin', 'POST', '/api/auth/bootstrap', { username: 'admin', password: 'librea-admin' });
  await call('admin', 'POST', '/api/auth/login', { username: 'admin', password: 'librea-admin' });
  await call('admin', 'POST', '/api/users', { username: 'kid', password: 'librea-student', role: 'student', entityId: 'S-1' });
  await call('kid', 'POST', '/api/auth/login', { username: 'kid', password: 'librea-student' });

  const prov = await (await call('admin', 'GET', '/api/vibe/provider')).json();
  assert.equal(prov.provider.name, 'template');
  assert.equal(prov.provider.offline, true);
  assert.equal(prov.whatLeaves.leaves, 'nothing');

  assert.equal((await call('anon', 'POST', '/api/vibe/generate', { prompt: 'x' })).status, 401);

  // SSE: stream the app in
  const res = await call('admin', 'POST', '/api/vibe/generate', { prompt: 'a dashboard of chronic absenteeism by school' });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const body = await res.text();
  const events = body.split('\n\n').filter((b) => b.startsWith('event:')).map((b) => ({
    event: /^event: (\S+)/.exec(b)[1],
    data: JSON.parse(/\ndata: (.*)$/s.exec(b)[1]),
  }));
  assert.equal(events.filter((e) => e.event === 'error').length, 0, JSON.stringify(events.slice(-1)));
  assert.ok(events.filter((e) => e.event === 'chunk').length > 1, 'the document should arrive in chunks');
  const done = events.at(-1);
  assert.equal(done.event, 'done');
  assert.equal(done.data.version, 1);
  assert.deepEqual(done.data.warnings, []);
  const slug = done.data.slug;
  assert.ok(isValidSlug(slug));
  assert.equal(events.map((e) => e.data.text).filter(Boolean).join('').length > 1000, true);

  // draft: visible to its author, invisible and unservable to anyone else
  assert.equal((await call('admin', 'GET', `/a/${slug}`)).status, 200);
  assert.equal((await call('kid', 'GET', `/a/${slug}`)).status, 404);
  assert.equal((await call('anon', 'GET', `/a/${slug}/app.html`)).status, 404);
  assert.equal((await (await call('kid', 'GET', '/api/apps')).json()).apps.length, 0);

  await call('admin', 'POST', `/api/apps/${slug}/publish`, { published: true });
  assert.equal((await (await call('kid', 'GET', '/api/apps')).json()).apps.length, 1);

  // the shell page frames the app and carries the scope badge
  const shell = await (await call('kid', 'GET', `/a/${slug}`)).text();
  assert.match(shell, new RegExp(`src="/a/${slug}/app\\.html\\?v=1"`));
  assert.match(shell, /sandbox="allow-scripts"/);
  assert.match(shell, /sees:/);
  assert.match(shell, /X-Librea-App/);
  assert.match((await (await call('anon', 'GET', `/a/${slug}`)).text()), /Sign in/);

  // the document itself: no cookie needed, runtime injected, network locked down
  const docRes = await call('anon', 'GET', `/a/${slug}/app.html`);
  assert.equal(docRes.status, 200);
  const csp = docRes.headers.get('content-security-policy');
  assert.match(csp, /connect-src 'none'/);
  assert.match(csp, /default-src 'none'/);
  assert.equal(docRes.headers.get('x-frame-options'), 'SAMEORIGIN');
  const doc = await docRes.text();
  assert.match(doc, /window\.librea/);
  assert.ok(doc.indexOf('window.librea') < doc.indexOf('librea.ready'));

  // the broker, called the way the shell calls it
  const q = async (who, op, args, appSlug) => {
    const r = await call(who, 'POST', '/api/query', { op, args }, appSlug ? { 'X-Librea-App': appSlug } : {});
    return { status: r.status, json: await r.json() };
  };
  assert.equal((await q('admin', 'stats', {}, slug)).json.students, 7);
  const kidAgg = await q('kid', 'aggregate', { groupBy: 'schoolId' }, slug);
  assert.equal(kidAgg.status, 200);
  const kidPeople = (await q('kid', 'people', {}, slug)).json;
  assert.equal(kidPeople.total, 1, 'an aggregates-only app shows the student only their own record');
  assert.equal(kidPeople.people[0].firstName, 'Kid1', 'you always keep your own name');
  const adminPeople = (await q('admin', 'people', { type: 'student' }, slug)).json;
  assert.equal(adminPeople.people[0].firstName, undefined, 'the app declares pii:false, so other people arrive without names');
  assert.equal((await q('kid', 'person', { id: 'S-2' }, slug)).status, 404);
  assert.equal((await q('anon', 'stats', {})).status, 401);
  assert.equal((await call('admin', 'POST', '/api/query', { op: 'stats' }, { 'X-Librea-App': 'no-such-app' })).status, 404);

  // remix: a new version at the same address; a stranger cannot remix
  const remix = await (await call('admin', 'POST', '/api/vibe/generate', { prompt: 'make it a roster instead', slug })).text();
  assert.match(remix, /event: done/);
  const manifest = await (await call('admin', 'GET', `/api/apps/${slug}`)).json();
  assert.equal(manifest.app.version, 2);
  assert.deepEqual(manifest.versions, [1, 2]);
  assert.equal(manifest.history.length, 2);
  assert.equal((await call('kid', 'POST', '/api/vibe/generate', { prompt: 'take it over', slug })).status, 403);
  assert.equal((await call('kid', 'DELETE', `/api/apps/${slug}`)).status, 403);
  assert.match(await (await call('kid', 'GET', `/a/${slug}?v=1`)).text(), new RegExp(`v=1"`));
  assert.equal((await call('kid', 'GET', `/a/${slug}?v=99`)).status, 404);

  // a student-authored app is aggregates-only by construction
  const kidGen = await (await call('kid', 'POST', '/api/vibe/generate', { prompt: 'a page where I submit my science fair reflection' })).text();
  const kidSlug = JSON.parse(/event: done\ndata: (.*)/.exec(kidGen)[1]).slug;
  const kidApp = await (await call('kid', 'GET', `/api/apps/${kidSlug}`)).json();
  assert.equal(kidApp.app.scope.aggregatesOnly, true);
  assert.deepEqual(kidApp.app.scope.entityIds, ['S-1']);
  assert.equal(kidApp.app.scope.pii, false);
  assert.match(kidApp.app.scopeBadge, /aggregates only/);

  // sql through the broker, and the mistakes an app makes land in the ledger
  const sqlRes = await q('admin', 'sql', { sql: 'SELECT grade, COUNT(*) AS n FROM students GROUP BY grade' }, slug);
  assert.equal(sqlRes.status, 200);
  assert.equal(sqlRes.json.rows[0].n, 7);
  assert.equal((await q('admin', 'sqlSchema', {}, slug)).json.dialect, 'sqlite');
  assert.equal((await q('kid', 'sql', { sql: 'SELECT sourcedId FROM students' }, slug)).json.rows.length, 1, 'a student reaches only their own row');
  assert.equal((await q('admin', 'sql', { sql: 'DROP TABLE students' }, slug)).status, 400);

  const before = app.store.ledger.seq;
  assert.equal((await q('admin', 'sql', { sql: 'SELECT * FROM nope' }, slug)).status, 400);
  assert.equal((await q('admin', 'bogusOp', { secretValue: 'Ada Lovelace' }, slug)).status, 400);
  const logged = [...app.store.ledger.replay()].filter((e) => e.seq > before && e.type === 'app.error');
  assert.equal(logged.length, 2);
  assert.equal(logged[0].data.slug, slug);
  assert.equal(logged[1].data.op, 'bogusOp');
  assert.deepEqual(logged[1].data.args, ['secretValue'], 'argument names only');
  assert.ok(!JSON.stringify(logged).includes('Ada Lovelace'), 'no argument values are ever logged');

  assert.equal((await call('admin', 'DELETE', `/api/apps/${slug}`)).status, 200);
  assert.equal((await call('admin', 'GET', `/api/apps/${slug}`)).status, 404);
});
