// Integration tests over the real HTTP surface with a throwaway data dir.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'librea-api-'));
let app, server, base;
const jars = {};

async function api(who, method, url, body, raw = false) {
  const headers = { 'content-type': 'application/json' };
  if (jars[who]) headers.cookie = jars[who];
  const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get('set-cookie');
  if (sc) jars[who] = sc.split(';')[0];
  return raw ? res : { status: res.status, json: await res.json().catch(() => null) };
}

test.before(async () => {
  app = await createApp({ dataDir, warm: false });
  server = await app.router.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  app.store.upsertEntity({ id: 'SCH-A', type: 'school', name: 'A Elementary', level: 'elementary' });
  for (let i = 1; i <= 6; i++) app.store.upsertEntity({ id: 'STU-' + i, type: 'student', firstName: 'Kid' + i, lastName: 'Test', grade: 4, schoolId: 'SCH-A', metrics: { gpa: 2 + i / 4, attendancePct: 85 + i * 2 } });
  await app.store.addFragments([
    { entityId: 'STU-1', kind: 'observation', visibility: 'staff', text: 'Internal staff note about STU-1 and a counselor referral.' },
    { entityId: 'STU-1', kind: 'observation', visibility: 'school', text: 'Loves the school garden and worm composting.' },
    { entityId: 'STU-2', kind: 'self', visibility: 'private', text: 'My private journal: I get nervous before math tests.' },
  ]);
});
test.after(() => { app.close(); server.close(); });

test('bootstrap, login, and role-based visibility', async () => {
  assert.equal((await api('anon', 'GET', '/api/auth/status')).json.bootstrapped, false);
  assert.equal((await api('anon', 'GET', '/api/stats')).status, 401);
  assert.equal((await api('admin', 'POST', '/api/auth/bootstrap', { username: 'admin', password: 'librea-admin' })).status, 200);
  assert.equal((await api('x', 'POST', '/api/auth/bootstrap', { username: 'evil', password: 'librea-admin' })).status, 409);
  assert.equal((await api('admin', 'POST', '/api/auth/login', { username: 'admin', password: 'librea-admin' })).status, 200);
  for (const u of [
    { username: 'teach', password: 'librea-staff', role: 'staff' },
    { username: 'stu-1', password: 'librea-student', role: 'student', entityId: 'STU-1' },
    { username: 'stu-2', password: 'librea-student', role: 'student', entityId: 'STU-2' },
    { username: 'fam-1', password: 'librea-family', role: 'family', entityIds: ['STU-1'] },
  ]) assert.equal((await api('admin', 'POST', '/api/users', u)).status, 200);
  for (const [who, pw] of [['teach', 'librea-staff'], ['stu-1', 'librea-student'], ['stu-2', 'librea-student'], ['fam-1', 'librea-family']])
    assert.equal((await api(who, 'POST', '/api/auth/login', { username: who, password: pw })).status, 200);

  // staff sees everyone with names and staff-only notes
  const staffView = (await api('teach', 'GET', '/api/people/STU-1')).json;
  assert.equal(staffView.person.firstName, 'Kid1');
  assert.equal(staffView.fragments.length, 2);
  // family sees own kid, not the staff-only note, and not other kids
  const famView = (await api('fam-1', 'GET', '/api/people/STU-1')).json;
  assert.equal(famView.fragments.length, 1);
  assert.equal(famView.fragments[0].visibility, 'school');
  assert.equal((await api('fam-1', 'GET', '/api/people/STU-2')).status, 404);
  assert.equal((await api('fam-1', 'GET', '/api/people')).json.total, 1);
  // student sees own record; another student's private journal is invisible to staff
  assert.equal((await api('stu-1', 'GET', '/api/people/STU-1')).json.person.id, 'STU-1');
  assert.equal((await api('stu-1', 'GET', '/api/people/STU-2')).status, 404);
  assert.equal((await api('teach', 'GET', '/api/people/STU-2')).json.fragments.length, 0);
  assert.equal((await api('stu-2', 'GET', '/api/people/STU-2')).json.fragments.length, 1);
});

test('fragments: who may write what, and search respects scope', async () => {
  assert.equal((await api('stu-1', 'POST', '/api/people/STU-1/fragments', { text: 'I want to build a weather station.' })).json.fragment.kind, 'self');
  assert.equal((await api('stu-1', 'POST', '/api/people/STU-1/fragments', { kind: 'observation', text: 'nope' })).status, 403);
  assert.equal((await api('stu-1', 'POST', '/api/people/STU-2/fragments', { text: 'nope' })).status, 404);
  assert.equal((await api('fam-1', 'POST', '/api/people/STU-1/fragments', { text: 'We garden together on Sundays.', visibility: 'staff' })).status, 403);
  const fam = (await api('fam-1', 'POST', '/api/people/STU-1/fragments', { text: 'We garden together on Sundays.' })).json.fragment;
  assert.equal(fam.kind, 'family');
  // staff can't delete a family voice; family can delete its own
  assert.equal((await api('teach', 'DELETE', '/api/fragments/' + fam.id)).status, 403);
  assert.equal((await api('fam-1', 'DELETE', '/api/fragments/' + fam.id)).json.removed, true);

  const staffSearch = (await api('teach', 'GET', '/api/search?q=counselor%20referral&k=3')).json.results;
  assert.ok(staffSearch.some((r) => r.person.id === 'STU-1' && r.fragments.some((f) => f.visibility === 'staff')));
  const famSearch = (await api('fam-1', 'GET', '/api/search?q=counselor%20referral&k=3')).json.results;
  assert.ok(!famSearch.some((r) => r.fragments.some((f) => f.visibility === 'staff')));
  const stuSearch = (await api('stu-2', 'GET', '/api/search?q=garden&k=3')).json.results;
  assert.ok(stuSearch.every((r) => r.person.id === 'STU-2'));
});

test('photo upload, timeline, similar, export, ledger', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const up = (await api('fam-1', 'POST', '/api/people/STU-1/photo', { caption: 'Science fair volcano', mime: 'image/png', data: png.toString('base64') })).json;
  assert.equal(up.fragment.kind, 'photo');
  const img = await api('fam-1', 'GET', up.fragment.media.path, null, true);
  assert.equal(img.status, 200);
  assert.equal((await api('stu-2', 'GET', up.fragment.media.path, null, true)).status, 404);

  assert.equal((await api('teach', 'POST', '/api/people/STU-3/timeline', { at: '2025-09', dims: { gpa: 0.8, attendance: 0.9 } })).status, 200);
  for (const [at, g] of [['2025-10', 0.6], ['2025-11', 0.5], ['2025-12', 0.7], ['2026-01', 0.85]]) await api('teach', 'POST', '/api/people/STU-3/timeline', { at, dims: { gpa: g, attendance: 0.9 } });
  const tl = (await api('teach', 'GET', '/api/people/STU-3/timeline')).json;
  assert.equal(tl.timeline.length, 5);
  assert.equal(tl.arc, 'turnaround');
  assert.equal((await api('teach', 'GET', '/api/people/STU-3')).json.person.outcome, 'intervention-success');

  const sim = (await api('teach', 'GET', '/api/people/STU-1/similar?space=signal&k=2')).json.similar;
  assert.equal(sim.length, 2);
  assert.ok(sim[0].score > 0.9);

  assert.equal((await api('teach', 'GET', '/api/export/students.csv', null, true)).status, 403);
  const csv = await (await api('admin', 'GET', '/api/export/students.csv', null, true)).text();
  assert.ok(csv.startsWith('id,firstName,lastName,grade'));
  assert.equal(csv.trim().split('\n').length, 7);
  const bundle = (await api('admin', 'GET', '/api/export/bundle.json')).json;
  assert.equal(bundle.entities.length, 7);
  assert.equal(bundle.ledger.ok, true);
  assert.equal((await api('admin', 'GET', '/api/ledger/verify')).json.ok, true);
});

test('admin can edit, reset, and deactivate accounts; search accepts structured filters', async () => {
  assert.equal((await api('teach', 'PUT', '/api/users/stu-2', { displayName: 'x' })).status, 403);
  const upd = (await api('admin', 'PUT', '/api/users/fam-1', { entityIds: ['STU-1', 'STU-2'], displayName: 'Test family', password: 'librea-family-2' })).json.user;
  assert.deepEqual(upd.entityIds, ['STU-1', 'STU-2']);
  assert.equal((await api('fam-1', 'GET', '/api/people/STU-2')).status, 401);
  assert.equal((await api('fam-1', 'POST', '/api/auth/login', { username: 'fam-1', password: 'librea-family-2' })).status, 200);
  assert.equal((await api('fam-1', 'GET', '/api/people/STU-2')).status, 200);
  assert.equal((await api('admin', 'PUT', '/api/users/fam-1', { active: false })).json.user.active, false);
  assert.equal((await api('fam-1', 'POST', '/api/auth/login', { username: 'fam-1', password: 'librea-family-2' })).status, 401);
  assert.equal((await api('admin', 'PUT', '/api/users/admin', { active: false })).status, 400);
  const filtered = (await api('teach', 'GET', '/api/search?q=garden&k=5&grade=4&outcome=intervention-success')).json.results;
  assert.ok(filtered.every((r) => r.person.outcome === 'intervention-success'));
  const none = (await api('teach', 'GET', '/api/search?q=garden&k=5&grade=11')).json.results;
  assert.equal(none.length, 0);
});
