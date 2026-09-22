import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';
import { loadEdition, t, BASE_EDITION } from '../src/core/edition.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'librea-onboard-'));

test('edition loader falls back to base and substitutes vocabulary with case preserved', () => {
  const e = loadEdition('does-not-exist');
  assert.equal(e.name, BASE_EDITION.name);
  const micro = { ...BASE_EDITION, vocabulary: { ...BASE_EDITION.vocabulary, student: 'learner', district: 'community' } };
  assert.equal(t('Students in the district', micro), 'Learners in the community');
  assert.equal(t('student-facing', micro), 'learner-facing');
  assert.equal(t('Districts', micro), 'Communities'.replace('Communities', 'Communitys'));
});

test('from scratch: create org, people, families, invites, join, caseload scope', async () => {
  const dataDir = tmp();
  const app = await createApp({ dataDir, warm: false });
  const server = await app.router.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const jars = {};
  const j = async (who, method, url, body) => {
    const headers = { 'content-type': 'application/json' };
    if (jars[who]) headers.cookie = jars[who];
    const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.get('set-cookie'); if (sc) jars[who] = sc.split(';')[0];
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  await j('admin', 'POST', '/api/auth/bootstrap', { username: 'admin', password: 'librea-admin' });
  await j('admin', 'POST', '/api/auth/login', { username: 'admin', password: 'librea-admin' });
  assert.equal((await j('admin', 'GET', '/api/edition')).json.id, 'district');

  const org = (await j('admin', 'POST', '/api/people', { type: 'school', name: 'Willow Pod', level: 'mixed' })).json.person;
  assert.match(org.id, /^SCH-/);
  const s1 = (await j('admin', 'POST', '/api/people', { type: 'student', firstName: 'Ida', lastName: 'Ng', grade: 'K', schoolId: org.id })).json.person;
  const s2 = (await j('admin', 'POST', '/api/people', { type: 'student', firstName: 'Ola', lastName: 'Ng', grade: 3, schoolId: org.id })).json.person;
  const s3 = (await j('admin', 'POST', '/api/people', { type: 'student', firstName: 'Zed', lastName: 'Q', grade: 5, schoolId: org.id })).json.person;
  assert.equal(s1.grade, 0);
  assert.equal((await j('admin', 'POST', '/api/people', { type: 'student', id: s1.id })).status, 409);
  const guide = (await j('admin', 'POST', '/api/people', { type: 'staff', firstName: 'Guide', lastName: 'One', role: 'guide' })).json.person;
  const fam = (await j('admin', 'POST', '/api/people', { type: 'family', name: 'Ng family', students: [s1.id], members: [{ name: 'Mai Ng', relation: 'mother', email: 'mai@example.org' }] })).json.person;
  assert.match(fam.id, /^FAM-/);
  assert.deepEqual((await j('admin', 'POST', `/api/families/${fam.id}/students`, { studentId: s2.id })).json.family.students, [s1.id, s2.id]);
  assert.deepEqual((await j('admin', 'GET', `/api/people/${s2.id}`)).json.person.guardians, [{ familyId: fam.id }]);

  // invite a family: both kids linked; public lookup; redeem; the new account sees exactly its kids
  const inv = (await j('admin', 'POST', '/api/invites', { role: 'family', entityIds: [s1.id, s2.id], displayName: 'Ng family' })).json.invite;
  assert.equal(inv.code.length, 8);
  assert.equal((await j('anon', 'GET', `/api/invites/${inv.code.toLowerCase()}`)).json.invite.role, 'family');
  assert.equal((await j('anon', 'GET', '/api/invites/NOPE1234')).status, 404);
  assert.equal((await j('anon', 'POST', '/api/invites/redeem', { code: inv.code, username: 'mai', password: 'short' })).status, 400);
  assert.equal((await j('mai', 'POST', '/api/invites/redeem', { code: inv.code, username: 'mai', password: 'librea-family' })).json.user.role, 'family');
  assert.equal((await j('x', 'POST', '/api/invites/redeem', { code: inv.code, username: 'again', password: 'librea-family' })).status, 400);
  await j('mai', 'POST', '/api/auth/login', { username: 'mai', password: 'librea-family' });
  assert.equal((await j('mai', 'GET', '/api/people')).json.total, 2);
  assert.equal((await j('mai', 'GET', `/api/families/${fam.id}`)).json.students.length, 2);
  assert.equal((await j('mai', 'GET', `/api/people/${s3.id}`)).status, 404);
  assert.equal((await j('admin', 'GET', '/api/invites')).json.invites[0].usedBy, 'mai');

  // caseload: a staff account flagged caseload sees only students in its sections
  await j('admin', 'POST', '/api/users', { username: 'guide1', password: 'librea-staff', role: 'staff', entityId: guide.id });
  await j('admin', 'PUT', '/api/users/guide1', { caseload: true });
  await j('admin', 'POST', '/api/facts/classes', { rows: [{ sourcedId: 'cls-1', title: 'Makers', schoolSourcedId: org.id }], derive: false });
  await j('admin', 'POST', '/api/facts/enrollments', { rows: [
    { sourcedId: 'e1', classSourcedId: 'cls-1', userSourcedId: guide.id, role: 'teacher' },
    { sourcedId: 'e2', classSourcedId: 'cls-1', userSourcedId: s1.id, role: 'student' },
    { sourcedId: 'e3', classSourcedId: 'cls-1', userSourcedId: s3.id, role: 'student', endDate: '2020-01-01' },
  ], derive: false });
  await j('guide1', 'POST', '/api/auth/login', { username: 'guide1', password: 'librea-staff' });
  const mine = (await j('guide1', 'GET', '/api/people?type=student')).json;
  assert.deepEqual(mine.people.map((p) => p.id), [s1.id]);
  assert.equal((await j('guide1', 'GET', `/api/people/${s2.id}`)).status, 404);
  assert.equal((await j('guide1', 'POST', '/api/sql/query', { sql: 'SELECT count(*) n FROM students' })).json.rows[0].n, 1);
  await j('admin', 'PUT', '/api/users/guide1', { caseload: false });
  assert.equal((await j('guide1', 'GET', '/api/people?type=student')).json.total, 3);
  app.close(); server.close();
});
