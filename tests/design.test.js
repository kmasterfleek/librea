import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/core/store.js';
import { SqlProjection } from '../src/sql/projection.js';
import { scopeFor } from '../src/core/auth.js';
import { runScoped } from '../src/sql/query.js';
import { RECIPES, menuFor, recipeSql } from '../src/vibe/recipes.js';
import { parseSlots, bindSlots, designSystemPrompt } from '../src/vibe/design.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'librea-design-'));

test('every recipe runs under staff and student scopes', async () => {
  const dir = tmp();
  const sql = new SqlProjection(dir).open();
  const store = await new Store(dir).attach(sql).open();
  store.upsertEntity({ id: 'SCH-A', type: 'school', name: 'A' });
  for (let i = 1; i <= 4; i++) store.upsertEntity({ id: 'STU-' + i, type: 'student', firstName: 'K' + i, grade: 9 + (i % 2), schoolId: 'SCH-A', metrics: { attendancePct: 80 + i, gpa: 2 + i / 4 } });
  store.upsertFacts('attendance', [{ id: 'a1', studentSourcedId: 'STU-1', date: '2025-09-02', code: 'present' }, { id: 'a2', studentSourcedId: 'STU-2', date: '2025-09-02', code: 'absent' }]);
  store.upsertFacts('enrollment_events', [{ id: 'e1', studentSourcedId: 'STU-3', event: 'transferred', date: '2025-10-01', nextSchool: 'Elsewhere USD', reason: 'moved' }]);
  await store.addFragments([{ entityId: 'STU-1', kind: 'artifact', visibility: 'school', text: 'Civic AI Lab [Parks]: K1 built a map.' }]);
  const staff = scopeFor({ role: 'staff' });
  const stu = scopeFor({ role: 'student', entityId: 'STU-1' });
  for (const id of Object.keys(RECIPES)) {
    const { sql: q } = recipeSql(id, { school: 'SCH-A', grade: 9, flag: 'chronicAbsent', type: 'IEP', kind: 'artifact', limit: 5 });
    assert.doesNotThrow(() => runScoped(sql.db, q, staff), id + ' (staff)');
    assert.doesNotThrow(() => runScoped(sql.db, q, stu), id + ' (student)');
  }
  assert.equal(runScoped(sql.db, recipeSql('enrollment.transfers_out').sql, staff).rows[0].destination, 'Elsewhere USD');
  assert.equal(runScoped(sql.db, recipeSql('projects.by_department').sql, staff).rows[0].department, 'Parks');
  assert.equal(runScoped(sql.db, recipeSql('me.metrics').sql, stu).rowCount, 1);
  // the menu for a scoped viewer only offers own-record recipes
  assert.ok(menuFor(stu).every((m) => m.id.startsWith('me.') || ['students.count', 'fragments.recent'].includes(m.id)));
  assert.ok(menuFor(staff).length > menuFor(stu).length);
  // a param cannot inject SQL
  assert.throws(() => runScoped(sql.db, recipeSql('students.flagged', { flag: "x' OR 1=1; DROP TABLE students; --" }).sql, staff, {}), /one statement|forbidden|SQL error/);

  // bind a design
  const html = `<!doctype html><html><head><title>t</title></head><body><h1>Attendance</h1>
    <div data-slot="a" data-recipe="attendance.absence_rate_by_school" data-label="Absence rate"></div>
    <div data-slot="b" data-recipe="students.count" data-params='{"school":"SCH-A"}'></div>
    <div data-slot="c" data-recipe="does.not.exist"></div>
    <script>alert('should be stripped')</script></body></html>`;
  const bound = bindSlots(html, { db: sql.db, scope: staff });
  assert.equal(bound.bindings.length, 2);
  assert.equal(bound.bindings[0].kind, 'bar');
  assert.ok(bound.warnings.some((w) => w.includes('does.not.exist')));
  assert.ok(bound.html.includes('id="librea-bindings"'));
  assert.ok(bound.html.includes('bindAll'));
  assert.ok(!bound.html.includes("alert('should be stripped')"));
  assert.equal(parseSlots(bound.html).length, 3);
  sql.close();
});

test('the design prompt carries the menu and the look, never the schema', () => {
  const p = designSystemPrompt({ edition: { name: 'Duarte Unified AI Environment', theme: { accent: '#0f2f6b', logoText: 'DUARTE' } }, scope: scopeFor({ role: 'admin' }) });
  assert.ok(p.includes('attendance.rate_by_school'));
  assert.ok(p.includes('#0f2f6b'));
  assert.ok(!/sourcedId|schoolSourcedId|CREATE TABLE|studentSourcedId/.test(p));
  assert.ok(!p.includes('Avery Example'));
});
