import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';
import { SqlProjection } from '../src/sql/projection.js';
import { Store } from '../src/core/store.js';
import { checkSql, runScoped } from '../src/sql/query.js';
import { scopeFor } from '../src/core/auth.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'librea-sql-'));

test('projection mirrors entities, fragments, snapshots, and facts; survives reopen and rebuild', async () => {
  const dir = tmp();
  let sql = new SqlProjection(dir).open();
  let store = await new Store(dir).attach(sql).open();
  store.upsertEntity({ id: 'SCH-A', type: 'school', name: 'A Elementary', level: 'elementary' });
  store.upsertEntity({ id: 'STU-1', type: 'student', firstName: 'Ana', lastName: 'Lopez', grade: 4, schoolId: 'SCH-A', metrics: { gpa: 3.1 } });
  store.upsertEntity({ id: 'STF-1', type: 'staff', firstName: 'T', lastName: 'One', role: 'teacher', schoolId: 'SCH-A' });
  await store.addFragments([{ entityId: 'STU-1', kind: 'self', visibility: 'school', text: 'I like maps.' }]);
  store.addSnapshot('STU-1', '2025-09', { gpa: 0.7, attendance: 0.9 });
  store.upsertFacts('attendance', [{ id: 'a1', studentSourcedId: 'STU-1', date: '2025-09-02', code: 'present' }, { id: 'a2', studentSourcedId: 'STU-1', date: '2025-09-03', code: 'absent' }]);
  assert.throws(() => store.upsertFacts('nope', [{ id: 'x' }]));
  assert.throws(() => store.upsertFacts('attendance', [{ id: 123, studentSourcedId: 'STU-1' }]));
  assert.equal(store.upsertFacts('attendance', [{ studentSourcedId: 'STU-1', date: '2025-09-04', code: 'present' }]).rows, 1); // key minted
  const c = sql.counts();
  assert.equal(c.students, 1); assert.equal(c.staff, 1); assert.equal(c.orgs, 1); assert.equal(c.fragments, 1); assert.equal(c.snapshots, 1); assert.equal(c.attendance, 3);
  assert.equal(sql.db.prepare('SELECT givenName, grade, gpa, dim_gpa FROM students').get().gpa, 3.1);
  store.deleteFacts('attendance', ['a2']);
  assert.equal(sql.counts().attendance, 2);
  sql.close(); store.snapshot();

  // reopen: projection seq matches ledger, nothing replays twice
  sql = new SqlProjection(dir).open();
  store = await new Store(dir).attach(sql).open();
  assert.equal(sql.seq, store.ledger.seq);
  assert.equal(sql.counts().attendance, 2);
  // delete the sqlite file: projection rebuilds from the ledger on open
  sql.close();
  for (const f of ['librea.sqlite', 'librea.sqlite-wal', 'librea.sqlite-shm']) fs.rmSync(path.join(dir, f), { force: true });
  sql = new SqlProjection(dir).open();
  store = await new Store(dir).attach(sql).open();
  assert.equal(sql.counts().attendance, 2);
  assert.equal(sql.counts().students, 1);
  assert.equal(sql.rebuild(store), store.ledger.seq);
  assert.equal(sql.counts().fragments, 1);
  sql.close();
});

test('checkSql rejects anything but one read-only SELECT', () => {
  assert.equal(checkSql('SELECT 1; '), 'SELECT 1');
  assert.throws(() => checkSql('DELETE FROM students'), /only SELECT/);
  assert.throws(() => checkSql('SELECT 1; SELECT 2'), /one statement/);
  assert.throws(() => checkSql('SELECT * FROM main.students'), /forbidden/);
  assert.throws(() => checkSql('SELECT * FROM sqlite_master'), /forbidden/);
  assert.throws(() => checkSql('PRAGMA table_info(students)'), /only SELECT/);
  assert.equal(checkSql('-- hi\nWITH x AS (SELECT 1) SELECT * FROM x /* c */'), 'WITH x AS (SELECT 1) SELECT * FROM x');
});

test('scoped SQL: rows and columns follow the caller', async () => {
  const dir = tmp();
  const sql = new SqlProjection(dir).open();
  const store = await new Store(dir).attach(sql).open();
  store.upsertEntity({ id: 'SCH-A', type: 'school', name: 'A' });
  for (let i = 1; i <= 3; i++) store.upsertEntity({ id: 'STU-' + i, type: 'student', firstName: 'Kid' + i, lastName: 'L', grade: 4, schoolId: 'SCH-A', metrics: { attendancePct: 80 + i * 5 } });
  await store.addFragments([{ entityId: 'STU-1', kind: 'observation', visibility: 'staff', text: 'staff only' }, { entityId: 'STU-1', kind: 'self', visibility: 'school', text: 'shared' }]);
  store.upsertFacts('contacts', [{ id: 'c1', studentSourcedId: 'STU-1', name: 'Mom', phone: '555' }]);
  const staff = scopeFor({ role: 'staff' });
  const r = runScoped(sql.db, 'SELECT sourcedId, givenName, attendancePct FROM students ORDER BY attendancePct', staff);
  assert.equal(r.rowCount, 3); assert.equal(r.rows[0].givenName, 'Kid1');
  assert.equal(runScoped(sql.db, 'SELECT count(*) n FROM fragments', staff).rows[0].n, 2);
  assert.equal(runScoped(sql.db, 'SELECT count(*) n FROM contacts', staff).rows[0].n, 1);
  const fam = scopeFor({ role: 'family', entityIds: ['STU-2'] });
  const f = runScoped(sql.db, 'SELECT * FROM students', fam);
  assert.equal(f.rowCount, 1); assert.equal(f.rows[0].sourcedId, 'STU-2'); assert.equal('givenName' in f.rows[0], false);
  assert.equal(runScoped(sql.db, 'SELECT count(*) n FROM contacts', fam).rows[0].n, 0);
  const stu = scopeFor({ role: 'student', entityId: 'STU-1' });
  assert.equal(runScoped(sql.db, 'SELECT count(*) n FROM fragments', stu).rows[0].n, 1);
  assert.equal(runScoped(sql.db, 'SELECT count(*) n FROM users', stu).rows[0].n, 1);
  // aggregates over the scoped view stay scoped; writes are refused; row cap works
  assert.equal(runScoped(sql.db, 'SELECT avg(attendancePct) a FROM students', fam).rows[0].a, 90);
  assert.throws(() => runScoped(sql.db, "SELECT * FROM students WHERE sourcedId = 'x' UNION SELECT * FROM main.students", fam), /forbidden/);
  const capped = runScoped(sql.db, 'SELECT * FROM students', staff, { limit: 2 });
  assert.equal(capped.rowCount, 2); assert.equal(capped.truncated, true);
  // temp views are gone after the call
  assert.equal(sql.db.prepare("SELECT count(*) c FROM sqlite_temp_master WHERE type = 'view'").get().c, 0);
  sql.close();
});

test('HTTP: schema, query, facts, and derived metrics', async () => {
  const dataDir = tmp();
  const app = await createApp({ dataDir, warm: false });
  const server = await app.router.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const j = async (method, url, body, token) => { const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, json: await res.json().catch(() => null) }; };
  await j('POST', '/api/auth/bootstrap', { username: 'admin', password: 'librea-admin' });
  const tok = (await j('POST', '/api/auth/login', { username: 'admin', password: 'librea-admin' })).json.token;
  app.store.upsertEntity({ id: 'SCH-A', type: 'school', name: 'A' });
  app.store.upsertEntity({ id: 'STU-1', type: 'student', firstName: 'Ana', grade: 4, schoolId: 'SCH-A' });
  assert.ok((await j('GET', '/api/sql/schema', null, tok)).json.tables.some((t) => t.name === 'attendance'));
  assert.equal((await j('POST', '/api/sql/query', { sql: 'SELECT count(*) n FROM students' }, tok)).json.rows[0].n, 1);
  assert.equal((await j('POST', '/api/sql/query', { sql: 'DROP TABLE students' }, tok)).status, 400);
  const rows = [];
  for (let d = 1; d <= 20; d++) rows.push({ id: 'a' + d, studentSourcedId: 'STU-1', date: '2025-09-' + String(d).padStart(2, '0'), code: d % 5 === 0 ? 'absent' : 'present' });
  const fr = (await j('POST', '/api/facts/attendance', { rows }, tok)).json;
  assert.equal(fr.rows, 20); assert.equal(fr.derived.updated, 1);
  await j('POST', '/api/facts/line_items', { rows: [{ sourcedId: 'li1', title: 'Quiz', classSourcedId: 'c1', resultValueMax: 10 }], derive: false }, tok);
  await j('POST', '/api/facts/results', { rows: [{ sourcedId: 'r1', lineItemSourcedId: 'li1', studentSourcedId: 'STU-1', score: 9, scoreStatus: 'fully graded' }, { sourcedId: 'r2', lineItemSourcedId: 'li1', studentSourcedId: 'STU-1', score: null, scoreStatus: 'not submitted' }] }, tok);
  await j('POST', '/api/facts/services', { rows: [{ id: 's1', studentSourcedId: 'STU-1', type: 'ELL', level: 'Newcomer' }, { id: 's2', studentSourcedId: 'STU-1', type: '504' }] }, tok);
  const p = (await j('GET', '/api/people/STU-1', null, tok)).json.person;
  assert.equal(p.metrics.attendancePct, 80);
  assert.equal(p.metrics.gpa, 4);
  assert.equal(p.metrics.assignCompletionPct, 50);
  assert.equal(p.metrics.ellLevel, 'Newcomer');
  assert.equal(p.metrics.specialEd, '504');
  assert.equal(p.metricsSource, 'derived');
  assert.equal(p.dims.attendance, 0.8);
  const st = (await j('GET', '/api/sql/status', null, tok)).json;
  assert.equal(st.seq, st.ledgerSeq);
  assert.equal((await j('POST', '/api/sql/query', { sql: 'SELECT attendancePct, dim_attendance FROM students' }, tok)).json.rows[0].dim_attendance, 0.8);
  app.close(); server.close();
});
