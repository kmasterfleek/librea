// Design → Data: the package contract, a prompt that never mentions the
// schema, offline layouts, the resolver, row shaping, the bindings op, the
// publish gate, and the whole flow over HTTP.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/core/store.js';
import { SqlProjection } from '../src/sql/projection.js';
import { parseDesign, auditDesign, publicManifest, unboundSlots, SLOT_KIND_NAMES, DESIGN_VERSION } from '../src/vibe/design.js';
import { buildDesignSystemPrompt, buildDesignMessages, whatLeavesDesign } from '../src/vibe/design-prompt.js';
import { renderDesignTemplate, chooseDesignTemplate, DESIGN_TEMPLATE_NAMES } from '../src/vibe/design-templates.js';
import { shapeRows, proposeBinding, normalizeBinding, runBindings } from '../src/vibe/bind.js';
import { runQuery } from '../src/vibe/query.js';
import { injectRuntime } from '../src/vibe/routes.js';
import { describeSchema } from '../src/sql/schema.js';
import { narrowScope, scopeFor } from '../src/core/auth.js';
import { createApp } from '../src/server.js';

const manifest = (slots) => `<script id="librea-design" type="application/json">${JSON.stringify({ librea: DESIGN_VERSION, title: 'T', slots })}</script>`;
const doc = (slots, body) => `<!doctype html><html><head><style>body{margin:0}</style>${manifest(slots)}</head><body>${body}</body></html>`;

// ----------------------------------------------------------------- contract

test('parseDesign accepts the vocabulary and rejects everything else', () => {
  const d = parseDesign(doc([
    { id: 'total', kind: 'stat', label: 'Students', hint: 'how many', sample: [{ value: 12, label: 'Students' }] },
    { id: 'by-school', kind: 'bar', sample: [{ label: 'School A', value: 3 }, { label: 'B', value: '4' }, { junk: 1 }] },
    { id: 'rows', kind: 'table', columns: ['grade', { key: 'school', label: 'School' }], sample: [{ grade: 5, school: 'A', extra: 'dropped' }] },
  ], '<div data-slot="total"></div><div data-slot="by-school"></div><div data-slot="rows"></div>'));
  assert.equal(d.slots.length, 3);
  assert.equal(d.slots[1].label, 'by-school', 'label defaults to the id');
  assert.equal(d.slots[1].sample.length, 2, 'a sample row with no known field is dropped');
  assert.deepEqual(d.slots[2].columns, [{ key: 'grade', label: 'grade' }, { key: 'school', label: 'School' }]);
  assert.deepEqual(d.slots[2].sample, [{ grade: 5, school: 'A' }], 'sample keys outside the declared columns are dropped');
  assert.deepEqual(SLOT_KIND_NAMES, ['stat', 'bar', 'line', 'table', 'list', 'text']);

  assert.throws(() => parseDesign('<html></html>'), /no <script id="librea-design"/);
  assert.throws(() => parseDesign(doc([{ id: 'xx', kind: 'pie' }], '')), /unknown kind "pie"/);
  assert.throws(() => parseDesign(doc([{ id: 'Bad Id', kind: 'stat' }], '')), /slot id/);
  assert.throws(() => parseDesign(doc([{ id: 'x', kind: 'stat' }], '')), /slot id/);
  assert.throws(() => parseDesign(doc([{ id: 'aa', kind: 'stat' }, { id: 'aa', kind: 'stat' }], '')), /duplicate/);
  assert.throws(() => parseDesign(doc([{ id: 'tt', kind: 'table' }], '')), /declares no columns/);
  assert.throws(() => parseDesign(doc([], '')), /declares no slots/);
  assert.throws(() => parseDesign(`<html>${manifest([{ id: 'aa', kind: 'stat' }]).replace(`"librea":${DESIGN_VERSION}`, '"librea":9')}</html>`), /must declare "librea"/);
});

test('auditDesign: every slot has a region, and the document is inert', () => {
  const slots = [{ id: 'aa', kind: 'stat' }, { id: 'bb', kind: 'bar' }];
  assert.deepEqual(auditDesign(doc(slots, '<div data-slot="aa"></div><div data-slot="bb"></div>'), parseDesign(doc(slots, ''))), []);
  const bad = doc(slots, '<div data-slot="aa"></div><div data-slot="zzz"></div><script>alert(1)</script><button onclick="x()">x</button><link rel="stylesheet" href="https://fonts.example/x.css">');
  const problems = auditDesign(bad, parseDesign(bad));
  assert.ok(problems.some((p) => /script other than its manifest/.test(p)));
  assert.ok(problems.some((p) => /inline event handler/.test(p)));
  assert.ok(problems.some((p) => /external stylesheet/.test(p)));
  assert.ok(problems.some((p) => /Slot "bb" is declared/.test(p)));
  assert.ok(problems.some((p) => /data-slot="zzz"/.test(p)));

  const m = parseDesign(doc([{ id: 'aa', kind: 'stat', sample: [{ value: 1 }] }], ''));
  assert.equal(publicManifest(m).slots[0].sample, undefined, 'readers never receive samples');
  assert.deepEqual(unboundSlots(m, {}), ['aa']);
  assert.deepEqual(unboundSlots(m, { aa: { sql: 'SELECT 1' } }), []);
});

test('the design prompt carries the vocabulary and nothing about the data', () => {
  const sys = buildDesignSystemPrompt({ appTitle: 'Board report' });
  assert.match(sys, /Board report/);
  assert.match(sys, /data-slot/);
  for (const k of SLOT_KIND_NAMES) assert.match(sys, new RegExp(`\\b${k}\\b`));
  // Nothing that describes the district's data may appear: no distinctive table name, no column, no synthetic row.
  for (const t of ['line_items', 'academic_sessions', 'discipline_incidents', 'enrollments', 'snapshots', 'fragments', 'orgs', 'attendance a']) assert.ok(!sys.includes(t), `prompt names table ${t}`);
  const cols = describeSchema().flatMap((t) => t.columns).filter((c) => /[A-Z_]/.test(c) && c.length > 4);
  for (const col of [...cols, 'STU-EXAMPLE', 'Avery', 'librea.sql', 'window.librea', 'SELECT']) assert.ok(!sys.includes(col), `prompt leaks ${col}`);
  const msgs = buildDesignMessages('make it two columns', '<html>prior</html>');
  assert.match(msgs[0].content, /prior/);
  assert.match(msgs[0].content, /Keep slot ids the same/);
  assert.equal(whatLeavesDesign(true).leaves, 'nothing');
  assert.match(whatLeavesDesign(false).statement, /Not the names of your tables/);
  assert.ok(whatLeavesDesign(false).neverSends.includes('table or field names'));
});

test('offline design layouts are valid, inert packages', () => {
  const seen = new Set();
  for (const p of ['a board attendance report by school', 'a page showing my progress this year', 'a district overview']) {
    const { html, template } = renderDesignTemplate(p, 'Test');
    seen.add(template);
    const m = parseDesign(html);
    assert.deepEqual(auditDesign(html, m), [], template);
    assert.ok(m.slots.length >= 4);
    assert.ok(m.slots.every((s) => s.sample.length >= 1), 'every slot previews');
    assert.ok(!/<script(?![^>]*librea-design)/i.test(html), 'no script but the manifest');
    assert.ok(html.includes('.lb-table') && html.includes('.lb-stat-value'), 'styles the binder markup');
  }
  assert.deepEqual([...seen].sort(), ['attendance', 'overview', 'personal']);
  assert.equal(chooseDesignTemplate('what is my gpa'), 'personal');
  assert.deepEqual(DESIGN_TEMPLATE_NAMES.sort(), ['attendance', 'overview', 'personal']);
});

// ------------------------------------------------------------------ shaping

test('shapeRows fits query results to each slot kind and names what is missing', () => {
  const bar = shapeRows({ kind: 'bar' }, ['school', 'n'], [{ school: 'A', n: 3 }, { school: 'B', n: '5' }]);
  assert.deepEqual(bar.rows, [{ label: 'A', value: 3 }, { label: 'B', value: 5 }]);
  assert.deepEqual(bar.problems, []);
  assert.ok(shapeRows({ kind: 'line' }, ['a', 'b'], [{ a: 'x', b: 'y' }]).problems.some((p) => /numeric value/.test(p)));

  const stat = shapeRows({ kind: 'stat', label: 'Students' }, ['value'], [{ value: 42 }]);
  assert.deepEqual(stat.rows, [{ value: 42, label: 'Students' }]);
  assert.ok(shapeRows({ kind: 'stat', label: 'S' }, ['value'], [{ value: 1 }, { value: 2 }]).problems.some((p) => /one row/.test(p)));

  const tbl = shapeRows({ kind: 'table', columns: [{ key: 'grade' }, { key: 'School' }, { key: 'missing' }] }, ['grade', 'school'], [{ grade: 5, school: 'A' }]);
  assert.deepEqual(tbl.rows, [{ grade: 5, School: 'A' }], 'column keys match case-insensitively');
  assert.match(tbl.problems[0], /missing column missing/);

  const list = shapeRows({ kind: 'list' }, ['name', 'level', 'n'], [{ name: 'A', level: 'elem', n: 4 }]);
  assert.deepEqual(list.rows, [{ title: 'A', subtitle: 'elem', meta: 4 }]);
  const text = shapeRows({ kind: 'text' }, ['text'], [{ text: 'hi' }]);
  assert.deepEqual(text.rows, [{ text: 'hi' }]);
  const big = shapeRows({ kind: 'bar' }, ['label', 'value'], Array.from({ length: 80 }, (_, i) => ({ label: 'x' + i, value: i })));
  assert.equal(big.rows.length, 50);
  assert.equal(big.truncated, true);
});

test('normalizeBinding accepts sql, aggregate, or text and nothing else', () => {
  assert.deepEqual(normalizeBinding({ sql: ' SELECT 1 ; ' }), { sql: 'SELECT 1' });
  assert.deepEqual(normalizeBinding({ aggregate: { groupBy: 'grade' } }), { aggregate: { groupBy: 'grade', metric: 'count' } });
  assert.deepEqual(normalizeBinding({ text: 'hello' }, { kind: 'text', id: 't' }), { text: 'hello' });
  assert.throws(() => normalizeBinding({ text: 'hello' }, { kind: 'bar', id: 'b' }), /only fits a text slot/);
  assert.throws(() => normalizeBinding({ sql: 'DROP TABLE students' }), /only SELECT/);
  assert.throws(() => normalizeBinding({ aggregate: { groupBy: 'name' } }), /groupBy/);
  assert.throws(() => normalizeBinding({}), /sql, aggregate, or text/);
});

test('the resolver proposes from the catalog and respects the scope', () => {
  const staff = { pii: true, entityIds: null };
  const kid = { pii: false, aggregatesOnly: true, entityIds: ['STU-1'] };
  const p1 = proposeBinding({ id: 'absence-by-school', kind: 'bar', label: 'Absence rate by school', hint: 'percent of days absent, one bar per school' }, staff);
  assert.match(p1.binding.sql, /FROM attendance a JOIN students/);
  const p2 = proposeBinding({ id: 'absence-by-school', kind: 'bar', label: 'Absence rate by school', hint: '' }, kid);
  assert.deepEqual(p2.binding, { aggregate: { groupBy: 'schoolId', metric: 'attendance' } }, 'an aggregates-only app gets the k-anonymous op');
  const watch = proposeBinding({ id: 'watch-list', kind: 'table', label: 'Worth a conversation', hint: 'students whose attendance is slipping', columns: [{ key: 'grade' }, { key: 'absences' }] }, staff);
  assert.match(watch.binding.sql, /givenName, familyName/, 'names come along when the scope allows them');
  assert.match(watch.binding.sql, /AS absences/);
  const noNames = proposeBinding({ id: 'watch-list', kind: 'table', label: 'Worth a conversation', hint: 'slipping', columns: [{ key: 'grade' }] }, { pii: false, entityIds: null });
  assert.ok(!/givenName/.test(noNames.binding.sql), 'no names when the scope hides them');
  assert.equal(proposeBinding({ id: 'watch-list', kind: 'table', label: 'Slipping', hint: '', columns: [{ key: 'grade' }] }, { ...kid, entityIds: [] }), null, 'no individual table for an aggregates-only viewer with no records');
  assert.match(proposeBinding({ id: 'students-total', kind: 'stat', label: 'Students', hint: 'how many students' }, staff).binding.sql, /COUNT\(\*\) AS value FROM students/);
  assert.equal(proposeBinding({ id: 'weather', kind: 'stat', label: 'Weather', hint: 'the forecast' }, staff), null);
});

// ---------------------------------------------------------- store-backed

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'librea-design-'));
let store, sqlProj;

test.before(async () => {
  sqlProj = new SqlProjection(dataDir).open();
  store = await new Store(dataDir).attach(sqlProj).open();
  store.upsertEntity({ id: 'SCH-BIG', type: 'school', name: 'Big Elementary' });
  store.upsertEntity({ id: 'SCH-TINY', type: 'school', name: 'Tiny Elementary' });
  for (let i = 1; i <= 8; i++) store.upsertEntity({ id: 'STU-' + i, type: 'student', firstName: 'Kid' + i, lastName: 'Test', grade: 5, schoolId: 'SCH-BIG', metrics: { gpa: 3, attendancePct: 80 + i } });
  for (let i = 9; i <= 11; i++) store.upsertEntity({ id: 'STU-' + i, type: 'student', firstName: 'Kid' + i, lastName: 'Test', grade: 6, schoolId: 'SCH-TINY', metrics: { gpa: 2, attendancePct: 70 } });
  const rows = [];
  for (let i = 1; i <= 11; i++) for (let d = 1; d <= 4; d++) rows.push({ id: `A-${i}-${d}`, studentSourcedId: 'STU-' + i, date: `2025-0${d}-01`, code: d === 1 && i % 2 ? 'absent' : 'present' });
  store.ledger.append('fact.upsert', { table: 'attendance', rows }, 'test');
  sqlProj.applyMany([...store.ledger.replay()].filter((e) => e.type === 'fact.upsert'));
  sqlProj.rebuild(store);
});
test.after(() => { try { sqlProj.close(); } catch { /* closed */ } });

const STAFF = { username: 'teach', role: 'staff', entityId: 'STF-0', displayName: 'Teacher' };
const STUDENT = { username: 'stu-1', role: 'student', entityId: 'STU-1', displayName: 'Kid1' };
const design = parseDesign(renderDesignTemplate('attendance', 'T').html);
const ctxFor = (user, app) => ({ user, scope: narrowScope(scopeFor(user), app.scope), app });

test('the bindings op runs every slot under the viewer, previews samples only for the editor', async () => {
  const app = { slug: 'att', title: 'T', author: { username: 'teach' }, published: false, mode: 'design', design, scope: { pii: false }, bindings: {
    'students-total': { sql: 'SELECT COUNT(*) AS value FROM students' },
    'absence-by-school': { sql: proposeBinding(design.slots.find((s) => s.id === 'absence-by-school'), { pii: false, entityIds: null }).binding.sql },
    'watch-list': { sql: 'SELECT grade, schoolSourcedId AS school, 3 AS absences FROM students WHERE attendancePct < 85' },
    'chronic-absent': { sql: 'SELECT * FROM nope' },
  } };
  const asStaff = await runQuery({ op: 'bindings', args: {} }, ctxFor(STAFF, app), store, { sql: sqlProj });
  assert.equal(asStaff.preview, true, 'the author of a draft sees samples for unbound slots');
  assert.deepEqual(asStaff.slots['students-total'].rows, [{ value: 11, label: 'Students' }]);
  assert.equal(asStaff.slots['absence-by-school'].rows.length, 2);
  assert.ok(asStaff.slots['absence-by-school'].rows.every((r) => typeof r.label === 'string' && typeof r.value === 'number'));
  assert.equal(asStaff.slots['watch-list'].rows.length, 7);
  assert.deepEqual(Object.keys(asStaff.slots['watch-list'].rows[0]), ['grade', 'school', 'absences']);
  assert.match(asStaff.slots['chronic-absent'].error, /SQL error/);
  assert.deepEqual(asStaff.slots['absence-rate'], { unbound: true });

  const asKid = await runQuery({ op: 'bindings', args: {} }, ctxFor(STUDENT, { ...app, published: true }), store, { sql: sqlProj });
  assert.equal(asKid.preview, false, 'a reader never previews');
  assert.deepEqual(asKid.slots['students-total'].rows, [{ value: 1, label: 'Students' }], 'the same query, under the student, counts only the student');
  assert.equal(asKid.slots['watch-list'].rows.length, 1);
  assert.equal(JSON.stringify(asKid).includes('School A'), false, 'no sample reaches a reader');

  const agg = { ...app, scope: { aggregatesOnly: true, pii: false }, bindings: { 'absence-by-school': { aggregate: { groupBy: 'schoolId', metric: 'count' } } } };
  const kidAgg = await runQuery({ op: 'bindings', args: {} }, ctxFor(STUDENT, agg), store, { sql: sqlProj });
  assert.deepEqual(kidAgg.slots['absence-by-school'].rows, [{ label: 'Big Elementary', value: 8 }]);
  assert.match(kidAgg.slots['absence-by-school'].note, /3 students not shown/);
  await assert.rejects(runQuery({ op: 'bindings', args: {} }, { ...ctxFor(STAFF, app), app: { slug: 'x', scope: {} } }, store, {}), /no design manifest/);
});

test('the binder is injected only for design apps, after the runtime', () => {
  const html = '<!doctype html><html><head><title>x</title></head><body></body></html>';
  const plain = injectRuntime(html);
  assert.equal(plain.includes('librea-design'), false);
  const withBinder = injectRuntime(html, { binder: true });
  assert.ok(withBinder.indexOf('window.librea = api') < withBinder.indexOf("getElementById('librea-design')"));
  assert.ok(withBinder.includes('lb-sample-tag'));
});

// ----------------------------------------------------------------- HTTP

test('design, bind, preview, publish gate, reuse, and read over HTTP', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'librea-design-http-'));
  process.env.LIBREA_MODEL_PROVIDER = 'template';
  const app = await createApp({ dataDir: dir, warm: false });
  const server = await app.router.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => { app.close(); server.close(); });
  app.store.upsertEntity({ id: 'SCH-A', type: 'school', name: 'A Elementary' });
  for (let i = 1; i <= 7; i++) app.store.upsertEntity({ id: 'S-' + i, type: 'student', firstName: 'Kid' + i, lastName: 'T', grade: 3, schoolId: 'SCH-A', metrics: { gpa: 3, attendancePct: 85 + i } });

  const jar = {};
  const call = async (who, method, url, body, extra = {}) => {
    const headers = { 'content-type': 'application/json', ...extra };
    if (jar[who]) headers.cookie = jar[who];
    const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.get('set-cookie');
    if (sc) jar[who] = sc.split(';')[0];
    return res;
  };
  const json = async (who, method, url, body, extra) => { const r = await call(who, method, url, body, extra); return { status: r.status, json: await r.json() }; };
  await call('admin', 'POST', '/api/auth/bootstrap', { username: 'admin', password: 'librea-admin' });
  await call('admin', 'POST', '/api/auth/login', { username: 'admin', password: 'librea-admin' });
  await call('admin', 'POST', '/api/users', { username: 'kid', password: 'librea-student', role: 'student', entityId: 'S-1' });
  await call('kid', 'POST', '/api/auth/login', { username: 'kid', password: 'librea-student' });

  const prov = (await json('admin', 'GET', '/api/vibe/design/provider')).json;
  assert.equal(prov.whatLeaves.leaves, 'nothing');
  assert.equal((await call('anon', 'POST', '/api/vibe/design', { prompt: 'x' })).status, 401);

  // step one
  const body = await (await call('admin', 'POST', '/api/vibe/design', { prompt: 'a board attendance report by school', title: 'Board attendance' })).text();
  const done = JSON.parse(/event: done\ndata: (.*)/.exec(body)[1]);
  assert.ok(!body.includes('event: error'), body.slice(-300));
  assert.equal(done.version, 1);
  assert.equal(done.published, false);
  assert.equal(done.slots.length, 6);
  assert.equal(done.unbound.length, 6);
  const slug = done.slug;
  const listed = (await json('admin', 'GET', '/api/apps')).json.apps.find((a) => a.slug === slug);
  assert.equal(listed.mode, 'design');
  assert.equal(listed.design.slots[0].sample, undefined, 'the listing carries no samples');
  assert.equal(listed.unbound.length, 6);

  // the served document carries the binder and no other script but the manifest
  const docHtml = await (await call('admin', 'GET', `/a/${slug}/app.html`)).text();
  assert.ok(docHtml.includes('librea-design'));
  assert.ok(docHtml.includes("getElementById('librea-design')"), 'binder injected');
  assert.equal((docHtml.match(/<script\b/g) || []).length, 3, 'runtime, binder, manifest');

  // a reader (or the author before binding) gets unbound slots; only the author gets preview
  const q = (who, op, args) => json(who, 'POST', '/api/query', { op, args }, { 'X-Librea-App': slug });
  const first = (await q('admin', 'bindings', {})).json;
  assert.equal(first.preview, true);
  assert.ok(Object.values(first.slots).every((s) => s.unbound));

  // publishing is refused while anything is unbound
  const refused = await json('admin', 'POST', `/api/apps/${slug}/publish`, { published: true });
  assert.equal(refused.status, 400);
  assert.match(refused.json.error, /bind every section/);

  // step two: proposals, preview, save
  const bind = (await json('admin', 'GET', `/api/apps/${slug}/bindings`)).json;
  assert.equal(bind.slots.length, 6);
  assert.ok(bind.proposals['students-total'], 'the catalog proposes for the obvious slots');
  assert.ok(bind.schema.tables.some((tb) => tb.name === 'attendance'));
  assert.equal((await call('kid', 'GET', `/api/apps/${slug}/bindings`)).status, 404, 'not your app');

  const prev = (await json('admin', 'POST', `/api/apps/${slug}/bindings/preview`, { slotId: 'students-total', binding: bind.proposals['students-total'].binding })).json;
  assert.deepEqual(prev.rows, [{ value: 7, label: 'Students' }]);
  assert.deepEqual(prev.problems, []);
  const badPrev = (await json('admin', 'POST', `/api/apps/${slug}/bindings/preview`, { slotId: 'watch-list', binding: { sql: 'SELECT grade FROM students' } })).json;
  assert.match(badPrev.problems[0], /missing columns school, absences/);
  const badSql = (await json('admin', 'POST', `/api/apps/${slug}/bindings/preview`, { slotId: 'students-total', binding: { sql: 'DELETE FROM students' } })).json;
  assert.match(badSql.error, /only SELECT/);

  const bindings = {};
  for (const s of bind.slots) bindings[s.id] = bind.proposals[s.id]?.binding || { sql: `SELECT 'x' AS label, 1 AS value` };
  bindings['watch-list'] = { sql: 'SELECT grade, schoolSourcedId AS school, 2 AS absences FROM students WHERE attendancePct < 90' };
  const rejected = await json('admin', 'PUT', `/api/apps/${slug}/bindings`, { bindings: { ...bindings, 'absence-over-time': { sql: "SELECT 'x' AS onlytext" } } });
  assert.equal(rejected.status, 400);
  assert.ok(rejected.json.problems['absence-over-time'], 'the slot that does not fit is named');
  const saved = (await json('admin', 'PUT', `/api/apps/${slug}/bindings`, { bindings })).json;
  assert.deepEqual(saved.unbound, []);
  assert.ok(saved.bindings['students-total'].sql);

  // bindings are in the ledger, not in the document
  const ev = [...app.store.ledger.replay()].filter((e) => e.type === 'app.upsert' && e.data.slug === slug).at(-1);
  assert.ok(ev.data.bindings['watch-list'].sql.includes('attendancePct'));
  assert.ok(!(await (await call('admin', 'GET', `/a/${slug}/app.html`)).text()).includes('attendancePct'), 'the query never enters the page');

  // publish, then read as a student: the same bindings, the student's scope, no samples
  assert.equal((await json('admin', 'POST', `/api/apps/${slug}/publish`, { published: true })).status, 200);
  const kidView = (await q('kid', 'bindings', {})).json;
  assert.equal(kidView.preview, false);
  assert.deepEqual(kidView.slots['students-total'].rows, [{ value: 1, label: 'Students' }]);
  assert.equal(kidView.slots['watch-list'].rows.length, 1);
  assert.equal(kidView.slots['watch-list'].rows[0].grade, 3);

  // a revision keeps bindings whose slot survives; classic remix of a design is refused
  const rev = await (await call('admin', 'POST', '/api/vibe/design', { prompt: 'tighten the spacing on the attendance report', slug })).text();
  assert.match(rev, /event: done/);
  const revDone = JSON.parse(/event: done\ndata: (.*)/.exec(rev)[1]);
  assert.equal(revDone.version, 2);
  assert.deepEqual(revDone.unbound, []);
  assert.equal((await call('admin', 'POST', '/api/vibe/generate', { prompt: 'x', slug })).status, 400);

  // the gallery: reuse a design with zero external calls, then bind it as the student
  const gallery = (await json('kid', 'GET', '/api/designs')).json.designs;
  assert.equal(gallery.length, 1);
  assert.equal(gallery[0].bound, 6);
  const reused = (await json('kid', 'POST', '/api/vibe/design/reuse', { from: slug, title: 'My attendance' })).json;
  assert.equal(reused.app.provider, 'gallery');
  assert.equal(reused.app.scope.aggregatesOnly, true);
  const kidBind = (await json('kid', 'GET', `/api/apps/${reused.app.slug}/bindings`)).json;
  assert.equal(kidBind.unbound.length, 6);
  assert.deepEqual(kidBind.proposals['absence-by-school'].binding, { aggregate: { groupBy: 'schoolId', metric: 'attendance' } });
  const kidPrev = (await json('kid', 'POST', `/api/apps/${reused.app.slug}/bindings/preview`, { slotId: 'absence-by-school', binding: kidBind.proposals['absence-by-school'].binding })).json;
  assert.equal(kidPrev.rows.length, 1, 'seven students in one school clears k-anonymity');
  assert.equal((await call('admin', 'DELETE', `/api/apps/${slug}`)).status, 200);
});
