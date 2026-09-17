import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Ledger } from '../src/core/ledger.js';
import { validateEntity, validateFragment, gradeFromString, redact } from '../src/core/schema.js';
import { dimsFromMetrics, signalVector, flags, outcomeLabel, cosine } from '../src/core/signal.js';
import { Auth, scopeFor, narrowScope } from '../src/core/auth.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'librea-core-'));

test('ledger chains hashes and detects tampering', () => {
  const dir = tmp();
  const l = new Ledger(path.join(dir, 'ledger.jsonl'));
  l.append('a', { x: 1 });
  l.append('b', { y: 2 }, 'kunal');
  assert.equal(l.verify().ok, true);
  assert.equal(l.verify().events, 2);
  const file = path.join(dir, 'ledger.jsonl');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('"y":2', '"y":3'));
  const v = l.verify();
  assert.equal(v.ok, false);
  assert.equal(v.brokenAt, 2);
  const l2 = new Ledger(file);
  assert.equal([...l2.replay()].length, 2);
  assert.equal(l2.seq, 2);
});

test('schema validates and normalizes students', () => {
  const e = validateEntity({ id: 'STU-1', type: 'student', grade: '04', firstName: '  Ana ', metrics: { gpa: '3.2', attendancePct: 91, ellLevel: 'Newcomer', bogus: 1 } });
  assert.equal(e.grade, 4);
  assert.equal(e.firstName, 'Ana');
  assert.deepEqual(e.metrics, { gpa: 3.2, attendancePct: 91, ellLevel: 'Newcomer' });
  assert.equal(gradeFromString('K'), 0);
  assert.equal(gradeFromString('PK'), -1);
  assert.equal(gradeFromString('12'), 12);
  assert.throws(() => validateEntity({ id: 'bad id!', type: 'student' }));
  assert.throws(() => validateEntity({ id: 'x', type: 'alien' }));
  assert.throws(() => validateFragment({ entityId: 'x', kind: 'self', text: '   ' }));
  assert.equal(validateFragment({ entityId: 'x', kind: 'self', text: 'hi' }).visibility, 'school');
  assert.equal(redact(e).firstName, undefined);
  assert.equal(redact(e).grade, 4);
});

test('signal vector, flags, and outcomes', () => {
  const d = dimsFromMetrics({ gpa: 3.6, attendancePct: 97, ses: 0.2, homeStability: 0.3, selScore: 0.7, peerConnected: 0.8, trajectory: 0.2 });
  assert.equal(d.gpa, 0.9);
  assert.equal(d.testScore, null);
  assert.equal(signalVector(d).length, 15);
  assert.equal(signalVector(d)[2], 0.5);
  assert.deepEqual(flags(d).map((f) => f.key), ['resilient']);
  assert.equal(outcomeLabel(d), 'resilient');
  const risky = dimsFromMetrics({ gpa: 2.0, attendancePct: 80, disciplineIncidents: 6, trajectory: -0.5 });
  assert.equal(outcomeLabel(risky), 'high-risk');
  assert.equal(outcomeLabel(dimsFromMetrics({ gpa: 3, attendancePct: 95 })), 'on-track');
  assert.ok(Math.abs(cosine([1, 0], [1, 0]) - 1) < 1e-9);
});

test('auth: scrypt accounts, sessions, and role scopes', () => {
  const a = new Auth(tmp());
  assert.equal(a.bootstrapped, false);
  a.createUser({ username: 'Admin', password: 'librea-admin', role: 'admin' });
  assert.equal(a.bootstrapped, true);
  assert.throws(() => a.createUser({ username: 'x', password: 'short', role: 'staff' }));
  assert.equal(a.login('admin', 'wrong'), null);
  const { token, user } = a.login('admin', 'librea-admin');
  assert.equal(a.resolve(token).username, 'admin');
  a.logout(token);
  assert.equal(a.resolve(token), null);
  const stu = a.createUser({ username: 'stu-1', password: 'librea-student', role: 'student', entityId: 'STU-1' });
  const s = scopeFor(stu);
  assert.deepEqual(s.entityIds, ['STU-1']);
  assert.equal(s.pii, false);
  assert.ok(s.visibility.includes('private'));
  assert.equal(scopeFor(user).entityIds, null);
  const narrowed = narrowScope(scopeFor(user), { visibility: ['school'], pii: false, aggregatesOnly: true });
  assert.deepEqual(narrowed.visibility, ['school']);
  assert.equal(narrowed.pii, false);
  assert.equal(narrowed.aggregatesOnly, true);
  const widened = narrowScope(s, { visibility: ['staff'], entityIds: null });
  assert.deepEqual(widened.visibility, []);
  assert.deepEqual(widened.entityIds, ['STU-1']);
});
