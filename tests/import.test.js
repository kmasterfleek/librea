// Importer tests. The store tests run against a throwaway data dir under
// os.tmpdir(); embedding is stubbed everywhere except one job-runner case,
// because a real embedding pass costs ~350ms per fragment.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCsv, parseTable, detectDelimiter, normalizeHeaders } from '../src/import/csv.js';
import { detectPreset, detectKind, buildMapping, listPresets, CANONICAL_FIELDS } from '../src/import/presets.js';
import { toEllLevel, toSpecialEd, toGpa, toDate, toPercent, toFrl, toPresence, safeId, slug } from '../src/import/values.js';
import { previewImport, applyImport, mapRow } from '../src/import/mapper.js';
import { describeStudent } from '../src/import/describe.js';
import { ImportJobs } from '../src/import/jobs.js';
import { factTablesFor, isAttendanceSummary, isAssignmentGradebook } from '../src/import/facts.js';
import { Store } from '../src/core/store.js';
import { SqlProjection } from '../src/sql/projection.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLES = path.join(ROOT, 'data/seed/samples');
const sample = (name) => fs.readFileSync(path.join(SAMPLES, name), 'utf8');

const tmpDirs = [];
const openSql = [];
function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'librea-import-test-'));
  tmpDirs.push(dir);
  return dir;
}
async function tmpStore() {
  return new Store(tmpDir()).open();
}
/** A store with the SQLite projection attached, so fact writes land somewhere. */
async function tmpSqlStore() {
  const dir = tmpDir();
  const sql = new SqlProjection(dir).open();
  openSql.push(sql);
  const store = await new Store(dir).attach(sql).open();
  return { store, sql };
}
process.on('exit', () => {
  for (const s of openSql) { try { s.close(); } catch { /* already closed */ } }
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

/** Import the PowerSchool roster so fact files have students to attach to. */
function seedRoster(store, sql) {
  return applyImport(store, sample('powerschool-students.csv'), { actor: 'admin', sql });
}

// ------------------------------------------------------------------- csv --

test('csv: quoted fields, embedded commas, newlines and doubled quotes', () => {
  const { headers, rows } = parseCsv('a,b,c\n1,"x, y","he said ""hi""\nsecond line",\n');
  assert.deepEqual(headers, ['a', 'b', 'c']);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].b, 'x, y');
  assert.equal(rows[0].c, 'he said "hi"\nsecond line');
});

test('csv: BOM and CRLF are stripped', () => {
  const { headers, rows } = parseCsv('﻿id,name\r\n1,Ada\r\n2,Grace\r\n');
  assert.deepEqual(headers, ['id', 'name']);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].name, 'Grace');
});

test('csv: tab-delimited files are auto-detected', () => {
  const { headers, rows, delimiter } = parseCsv('id\tname\tgrade\n7\tKay\t9\n');
  assert.equal(delimiter, '\t');
  assert.deepEqual(headers, ['id', 'name', 'grade']);
  assert.equal(rows[0].grade, '9');
});

test('csv: semicolon files, ragged rows and blank lines survive', () => {
  const { headers, rows } = parseCsv('id;name;grade\n\n1;Ada\n2;Grace;11\n');
  assert.equal(headers.length, 3);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].grade, '');
  assert.equal(rows[1].grade, '11');
});

test('csv: a delimiter inside quotes does not change detection', () => {
  assert.equal(detectDelimiter('id,name\n1,"a;b;c;d;e;f"\n'), ',');
});

test('csv: duplicate and blank headers are made unique', () => {
  assert.deepEqual(normalizeHeaders(['id', 'name', 'name', '']), ['id', 'name', 'name_2', 'column_4']);
});

test('csv: an empty file yields no headers and no rows', () => {
  const r = parseCsv('');
  assert.deepEqual(r.headers, []);
  assert.deepEqual(r.rows, []);
});

test('csv: a trailing quoted empty field is kept', () => {
  assert.deepEqual(parseTable('a,b\n1,""\n', ','), [['a', 'b'], ['1', '']]);
});

// --------------------------------------------------------------- values --

test('values: ELL flags from every vendor land on the five canonical levels', () => {
  assert.equal(toEllLevel('LEP'), 'Intermediate');
  assert.equal(toEllLevel('EO'), 'None');
  assert.equal(toEllLevel('RFEP'), 'None');
  assert.equal(toEllLevel('E'), 'None');          // Aeries language fluency
  assert.equal(toEllLevel('L'), 'Intermediate');
  assert.equal(toEllLevel('Newcomer'), 'Newcomer');
  assert.equal(toEllLevel('Early Advanced'), 'Advanced');
  assert.equal(toEllLevel(''), undefined);
});

test('values: SPED flags land on the four canonical levels', () => {
  assert.equal(toSpecialEd('504 Plan'), '504');
  assert.equal(toSpecialEd('IEP'), 'IEP-partial');
  assert.equal(toSpecialEd('RSP'), 'IEP-partial');   // Aeries resource
  assert.equal(toSpecialEd('SDC'), 'IEP-full');      // Aeries special day class
  assert.equal(toSpecialEd('N'), 'None');
  assert.equal(toSpecialEd(''), undefined);
});

test('values: grades, percents, dates and lunch status coerce', () => {
  assert.equal(toGpa('B+'), 3.3);
  assert.equal(toGpa('3.75'), 3.75);
  assert.equal(toGpa('87'), 2.96);
  assert.equal(toPercent('93.5%'), 93.5);
  assert.equal(toPercent('0.93'), 93);
  assert.equal(toDate('3/7/2015'), '2015-03-07');
  assert.equal(toDate('2015-03-07'), '2015-03-07');
  assert.equal(toFrl('Free'), 'free');
  assert.equal(toFrl('P'), 'paid');
  assert.equal(toPresence('A'), false);
  assert.equal(toPresence('Tardy'), true);
});

test('values: entity ids are always schema-legal', () => {
  assert.match(safeId('STU-', '100 245/A'), /^[A-Za-z0-9_.:-]{1,64}$/);
  assert.equal(slug('Riverside Elementary'), 'RIVERSIDE-ELEMENTARY');
});

// -------------------------------------------------------------- presets --

const EXPECTED = {
  'powerschool-students.csv': ['powerschool', 'students'],
  'aeries-students.csv': ['aeries', 'students'],
  'oneroster-users.csv': ['oneroster', 'students'],
  'attendance.csv': ['generic', 'attendance'],
  'grades.csv': ['generic', 'grades'],
};

for (const [file, [preset, kind]] of Object.entries(EXPECTED)) {
  test(`presets: ${file} is detected as ${preset}/${kind}`, () => {
    const p = previewImport(sample(file));
    assert.equal(p.preset, preset, `preset for ${file}`);
    assert.equal(p.kind, kind, `kind for ${file}`);
    assert.ok(p.rowCount >= 10, 'sample should have at least 10 rows');
    assert.ok(p.sampleRows.length > 0);
  });
}

test('presets: a generic spreadsheet still maps the obvious columns', () => {
  const csv = 'Student ID,First Name,Last Name,Grade Level,School,GPA,Attendance %\n9,Rosa,Ibarra,6,Bayside Middle,3.2,91\n';
  const p = previewImport(csv);
  assert.equal(p.preset, 'generic');
  assert.equal(p.kind, 'students');
  assert.equal(p.mapping.firstName, 'First Name');
  assert.equal(p.mapping.grade, 'Grade Level');
  assert.equal(p.mapping.gpa, 'GPA');
  assert.equal(p.mapping.attendancePct, 'Attendance %');
});

test('presets: PowerSchool guardian columns do not steal the student email', () => {
  const { mapping } = buildMapping(['Student_Number', 'Guardian_Email', 'Student_Email', 'Home_Phone'], 'powerschool', 'students');
  assert.equal(mapping.email, 'Student_Email');
  assert.equal(mapping.guardianEmail, 'Guardian_Email');
  assert.equal(mapping.guardianPhone, 'Home_Phone');
});

test('presets: OneRoster staff rows are detected as a staff file', () => {
  const csv = 'sourcedId,orgSourcedIds,role,givenName,familyName,email\nu-1,org-a,teacher,Rosalie,Halloran,r@example.org\nu-2,org-a,administrator,Imani,Castellanos,i@example.org\n';
  const p = previewImport(csv);
  assert.equal(p.preset, 'oneroster');
  assert.equal(p.kind, 'staff');
});

test('presets: every preset advertises its fields and every kind has a field list', () => {
  const ids = listPresets().map((p) => p.id);
  for (const id of ['powerschool', 'aeries', 'infinitecampus', 'oneroster', 'generic']) assert.ok(ids.includes(id), id);
  for (const k of Object.keys(CANONICAL_FIELDS)) assert.ok(CANONICAL_FIELDS[k].length > 0, k);
  assert.ok(CANONICAL_FIELDS.students.includes('gpa'));
  assert.ok(CANONICAL_FIELDS.students.includes('peerConnected'));
});

test('presets: kind detection recognises a discipline export', () => {
  const headers = ['Student ID', 'Incident Date', 'Infraction', 'Consequence'];
  assert.equal(detectKind(headers, detectPreset(headers).preset), 'discipline');
});

// --------------------------------------------------------------- mapping --

test('mapping: an explicit mapping overrides detection and ignores bogus headers', () => {
  const csv = 'col_a,col_b\n5150,Fenwick\n';
  const p = previewImport(csv, { kind: 'students', mapping: { id: 'col_a', lastName: 'col_b', firstName: 'does_not_exist' } });
  assert.equal(p.mapping.id, 'col_a');
  assert.equal(p.mapping.lastName, 'col_b');
  assert.equal(p.mapping.firstName, null);
  assert.deepEqual(mapRow({ col_a: '5150', col_b: 'Fenwick' }, p.mapping), { id: '5150', lastName: 'Fenwick' });
});

test('mapping: preview warns about unmapped columns and a missing id', () => {
  const p = previewImport('nickname,favourite_colour\nBee,teal\n', { kind: 'students' });
  assert.ok(p.warnings.some((w) => w.includes('required field "id"')));
});

// ----------------------------------------------------------------- apply --

test('apply: a PowerSchool roster creates students, schools and metrics', async () => {
  const store = await tmpStore();
  const r = applyImport(store, sample('powerschool-students.csv'), { actor: 'admin' });
  assert.equal(r.preset, 'powerschool');
  assert.equal(r.kind, 'students');
  assert.equal(r.created, 12);
  assert.equal(r.updated, 0);
  assert.equal(r.skipped, 0);
  assert.deepEqual(r.errors, []);

  const s = store.getEntity('STU-700001');
  assert.equal(s.firstName, 'Amara');
  assert.equal(s.lastName, 'Okonkwo');
  assert.equal(s.grade, 4);
  assert.equal(s.dob, '2015-03-07');
  assert.equal(s.externalIds.powerschool, '700001');
  assert.equal(s.metrics.ellLevel, 'Newcomer');
  assert.equal(s.metrics.gpa, 2.2);
  assert.equal(s.metrics.attendancePct, 93.4);
  assert.equal(s.frl, 'free');
  assert.equal(s.guardians[0].name, 'Okonkwo, Ngozi');
  assert.equal(s.guardians[0].email, 'ngozi.okonkwo@example.org');

  const school = store.getEntity(s.schoolId);
  assert.equal(school.type, 'school');
  assert.equal(school.name, 'Riverside Elementary');
  assert.equal(store.listEntities({ type: 'school' }).length, 3);
});

test('apply: Aeries column codes map onto the same canonical shape', async () => {
  const store = await tmpStore();
  const r = applyImport(store, sample('aeries-students.csv'), { actor: 'admin' });
  assert.equal(r.preset, 'aeries');
  assert.equal(r.created, 12);
  const k = store.getEntity('STU-800001');
  assert.equal(k.grade, 0, 'K maps to grade 0');
  assert.equal(k.metrics.ellLevel, 'None');
  assert.equal(store.getEntity('STU-800004').metrics.specialEd, 'IEP-full');  // SP = S
  assert.equal(store.getEntity('STU-800002').metrics.specialEd, 'IEP-partial'); // SP = R
  assert.equal(store.getEntity('STU-800003').metrics.ellLevel, 'Intermediate'); // LF = L
});

test('apply: OneRoster staff rows are skipped from a student import, with a reason', async () => {
  const store = await tmpStore();
  const r = applyImport(store, sample('oneroster-users.csv'), { actor: 'admin' });
  assert.equal(r.created, 12);
  assert.equal(r.skipped, 3);
  assert.ok(r.errors.every((e) => /not a student/.test(e.message)));
  const s = store.getEntity('STU-onr-7001');
  assert.equal(s.firstName, 'Delphine');
  assert.equal(s.grade, 3);
  assert.deepEqual(s.guardianIds, ['grd-7001']);
});

test('apply: dryRun reports the same counts but writes nothing', async () => {
  const store = await tmpStore();
  const r = applyImport(store, sample('powerschool-students.csv'), { actor: 'admin', dryRun: true });
  assert.equal(r.created, 12);
  assert.equal(r.dryRun, true);
  assert.equal(store.listEntities({ type: 'student' }).length, 0);
});

test('apply: bad rows are skipped and the rest of the batch still lands', async () => {
  const store = await tmpStore();
  const csv = [
    'Student_Number,First_Name,Last_Name,Grade_Level,School_Name',
    '900,Ines,Halvorsen,5,Lakeview Elementary',
    ',Nobody,Nameless,5,Lakeview Elementary',
    '902,Osric,Pemberton,banana,Lakeview Elementary',
    '903,Wren,Castellane,7,Lakeview Elementary',
  ].join('\n');
  const r = applyImport(store, csv, { actor: 'admin', preset: 'powerschool', kind: 'students' });
  assert.equal(r.created, 3);
  assert.equal(r.skipped, 1);
  assert.equal(r.errors[0].message, 'missing student id');
  assert.equal(r.errors[0].row, 3);
  assert.equal(store.getEntity('STU-902').grade, undefined, 'unreadable grade is left unset');
  assert.ok(r.warnings.some((w) => w.includes('unreadable grade')));
});

test('apply: a second import merges and never erases fields the CSV omits', async () => {
  const store = await tmpStore();
  applyImport(store, sample('powerschool-students.csv'), { actor: 'admin' });
  const before = store.getEntity('STU-700001');
  const csv = 'Student_Number,GPA\n700001,3.6\n';
  const r = applyImport(store, csv, { actor: 'admin', preset: 'powerschool', kind: 'students' });
  assert.equal(r.created, 0);
  assert.equal(r.updated, 1);
  const after = store.getEntity('STU-700001');
  assert.equal(after.metrics.gpa, 3.6, 'the new value wins');
  assert.equal(after.firstName, before.firstName, 'name survives');
  assert.equal(after.lastName, before.lastName);
  assert.equal(after.metrics.attendancePct, before.metrics.attendancePct, 'untouched metric survives');
  assert.equal(after.metrics.ellLevel, 'Newcomer');
  assert.equal(after.schoolId, before.schoolId);
});

test('apply: a re-import matches on externalIds instead of creating duplicates', async () => {
  const store = await tmpStore();
  store.upsertEntity({ id: 'STU-LEGACY-7', type: 'student', firstName: 'Odalys', lastName: 'Brightwater', externalIds: { powerschool: '700001' } }, 'test');
  const r = applyImport(store, sample('powerschool-students.csv'), { actor: 'admin' });
  assert.equal(r.created, 11);
  assert.equal(r.updated, 1);
  assert.equal(store.getEntity('STU-LEGACY-7').firstName, 'Amara');
  assert.equal(store.getEntity('STU-700001'), null);
});

test('apply: an attendance export aggregates into attendancePct', async () => {
  const store = await tmpStore();
  applyImport(store, sample('powerschool-students.csv'), { actor: 'admin' });
  const r = applyImport(store, sample('attendance.csv'), { actor: 'admin' });
  assert.equal(r.kind, 'attendance');
  assert.equal(r.updated, 12);
  assert.equal(store.getEntity('STU-700001').metrics.attendancePct, 93.2); // 82/88
  assert.equal(store.getEntity('STU-700004').metrics.attendancePct, 80.7); // 71/88
});

test('apply: a per-day attendance file falls back to attendance codes', async () => {
  const store = await tmpStore();
  store.upsertEntity({ id: 'STU-5', type: 'student', externalIds: { generic: '5' } }, 'test');
  const csv = ['Student ID,Date,Attendance Code', '5,2026-09-01,P', '5,2026-09-02,P', '5,2026-09-03,A', '5,2026-09-04,P'].join('\n');
  const r = applyImport(store, csv, { actor: 'admin', kind: 'attendance' });
  assert.equal(r.updated, 1);
  assert.equal(store.getEntity('STU-5').metrics.attendancePct, 75);
});

test('apply: attendance rows for unknown students are skipped, not invented', async () => {
  const store = await tmpStore();
  const r = applyImport(store, sample('attendance.csv'), { actor: 'admin' });
  assert.equal(r.updated, 0);
  assert.equal(r.created, 0);
  assert.equal(r.skipped, 12);
  assert.ok(/unknown student/.test(r.errors[0].message));
  assert.equal(store.listEntities({ type: 'student' }).length, 0);
});

test('apply: a grades export aggregates into gpa, rigor and trajectory', async () => {
  const store = await tmpStore();
  applyImport(store, sample('powerschool-students.csv'), { actor: 'admin' });
  const r = applyImport(store, sample('grades.csv'), { actor: 'admin' });
  assert.equal(r.kind, 'grades');
  assert.equal(r.updated, 3);
  const falling = store.getEntity('STU-700010').metrics;
  assert.equal(falling.gpa, 1.93);              // C, B-, D+, C-
  assert.equal(falling.courseRigor, 0.5);       // half the courses are AP
  assert.ok(falling.trajectory < 0, 'S1 -> S2 slide shows as a negative trend');
  const rising = store.getEntity('STU-700011').metrics;
  assert.ok(rising.trajectory > 0, 'improving student trends up');
});

test('apply: a discipline export counts incidents per student', async () => {
  const store = await tmpStore();
  applyImport(store, sample('powerschool-students.csv'), { actor: 'admin' });
  const csv = ['Student ID,Incident Date,Infraction,Consequence',
    '700008,2026-09-04,Disruption,Lunch detention',
    '700008,2026-10-11,Disruption,Parent contact',
    '700008,2026-11-02,Defiance,In-school suspension',
    '700010,2026-09-19,Tardy policy,Warning'].join('\n');
  const r = applyImport(store, csv, { actor: 'admin' });
  assert.equal(r.kind, 'discipline');
  assert.equal(store.getEntity('STU-700008').metrics.disciplineIncidents, 3);
  assert.equal(store.getEntity('STU-700010').metrics.disciplineIncidents, 1);
});

test('apply: an OneRoster orgs file creates school entities', async () => {
  const store = await tmpStore();
  const csv = ['sourcedId,name,type,identifier,parentSourcedId',
    'org-eastlake,Eastlake Elementary,school,EL01,org-district',
    'org-brightwater,Brightwater Middle,school,BW01,org-district'].join('\n');
  const r = applyImport(store, csv, { actor: 'admin' });
  assert.equal(r.kind, 'orgs');
  assert.equal(r.created, 2);
  assert.equal(store.getEntity('SCH-EASTLAKE-ELEMENTARY').name, 'Eastlake Elementary');
});

test('apply: an empty or headers-only file is a no-op with a warning', async () => {
  const store = await tmpStore();
  const r = applyImport(store, 'Student_Number,First_Name\n', { actor: 'admin' });
  assert.equal(r.created, 0);
  assert.ok(r.warnings.some((w) => /no data rows/.test(w)));
});

test('apply: a school name wins over the vendor school id, and moves the student', async () => {
  const store = await tmpStore();
  store.upsertEntity({ id: 'SCH-RIVERSIDE', type: 'school', name: 'Riverside Elementary' }, 'test');
  store.upsertEntity({ id: 'STU-2', type: 'student', schoolId: 'SCH-RIVERSIDE', externalIds: { powerschool: '2' } }, 'test');
  const r = applyImport(store, 'Student_Number,First_Name,SchoolID,School_Name\n2,Bo,202,Northgate Middle\n',
    { actor: 'admin', preset: 'powerschool', kind: 'students' });
  assert.equal(r.updated, 1);
  assert.equal(store.getEntity('STU-2').schoolId, 'SCH-NORTHGATE-MIDDLE', 'the student follows the school name');
  const school = store.getEntity('SCH-NORTHGATE-MIDDLE');
  assert.equal(school.name, 'Northgate Middle');
  assert.equal(school.externalIds.powerschool, '202', 'the vendor school id is recorded on the school');
});

test('apply: a school name matches an existing school rather than making a second one', async () => {
  const store = await tmpStore();
  store.upsertEntity({ id: 'SCH-RIVERSIDE', type: 'school', name: 'Riverside Elementary' }, 'test');
  applyImport(store, 'Student_Number,First_Name,SchoolID,School_Name\n8,Ines,201,Riverside Elementary\n',
    { actor: 'admin', preset: 'powerschool', kind: 'students' });
  assert.equal(store.getEntity('STU-8').schoolId, 'SCH-RIVERSIDE');
  assert.equal(store.listEntities({ type: 'school' }).length, 1, 'no duplicate school was created');
});

test('apply: a bare vendor school id only resolves to a school that already exists', async () => {
  const store = await tmpStore();
  store.upsertEntity({ id: 'SCH-NORTHGATE-MIDDLE', type: 'school', name: 'Northgate Middle', externalIds: { powerschool: '202' } }, 'test');

  const known = applyImport(store, 'Student_Number,First_Name,SchoolID\n4,Di,202\n',
    { actor: 'admin', preset: 'powerschool', kind: 'students' });
  assert.equal(store.getEntity('STU-4').schoolId, 'SCH-NORTHGATE-MIDDLE');
  assert.equal(known.warnings.length, 0);

  const unknown = applyImport(store, 'Student_Number,First_Name,SchoolID\n3,Cy,207\n5,Eli,207\n',
    { actor: 'admin', preset: 'powerschool', kind: 'students' });
  assert.equal(store.getEntity('STU-3').schoolId, undefined, 'no school rather than an invented one');
  assert.equal(store.getEntity('SCH-207'), null, 'a numeric id never becomes a school entity');
  assert.equal(store.listEntities({ type: 'school' }).length, 1);
  assert.equal(unknown.warnings.length, 1, 'one warning, not one per row');
  assert.ok(/matches no known school/.test(unknown.warnings[0]));
});

test('samples: no sample identifier collides with the seeded district', () => {
  // scripts/seed.js hands every seeded student externalIds.powerschool = 100000 + n,
  // so a sample in that range silently overwrites a seeded student on import.
  const seeded = (v) => /^\d+$/.test(v) && Number(v) >= 100000 && Number(v) < 200000;
  for (const file of fs.readdirSync(SAMPLES)) {
    for (const row of parseCsv(sample(file)).rows) {
      for (const v of Object.values(row)) {
        assert.ok(!seeded(String(v)), `${file} carries ${v}, which collides with the seeded district`);
      }
    }
  }
});

test('samples: importing OneRoster orgs first gives users.csv real schools', async () => {
  const store = await tmpStore();
  const orgs = applyImport(store, sample('oneroster-orgs.csv'), { actor: 'admin' });
  assert.equal(orgs.preset, 'oneroster');
  assert.equal(orgs.kind, 'orgs');
  assert.equal(orgs.created, 3);
  assert.equal(store.getEntity('SCH-EASTLAKE-ELEMENTARY').externalIds.oneroster, 'org-eastlake');

  const users = applyImport(store, sample('oneroster-users.csv'), { actor: 'admin' });
  assert.equal(users.created, 12);
  assert.deepEqual(users.warnings, [], 'the bare org id now resolves');
  assert.equal(store.getEntity('STU-onr-7001').schoolId, 'SCH-EASTLAKE-ELEMENTARY');
});

test('samples: OneRoster users.csv on its own leaves schools unassigned, with one warning', async () => {
  const store = await tmpStore();
  const r = applyImport(store, sample('oneroster-users.csv'), { actor: 'admin' });
  assert.equal(r.created, 12);
  assert.equal(store.getEntity('STU-onr-7001').schoolId, undefined);
  assert.ok(r.warnings.some((w) => /matches no known school/.test(w)));
  assert.equal(store.listEntities({ type: 'school' }).length, 0);
});

// ----------------------------------------------------------------- facts --

test('facts: the file shape decides whether rows or a summary are written', () => {
  assert.equal(isAttendanceSummary({ daysPresent: 'Days Present', daysEnrolled: 'Days Enrolled' }), true);
  assert.equal(isAttendanceSummary({ date: 'Date', status: 'Code' }), false);
  assert.equal(isAttendanceSummary({ date: 'Date', daysPresent: 'Days Present' }), true, 'a dated summary is still a summary');
  assert.equal(isAssignmentGradebook({ assignment: 'Assignment', score: 'Score' }), true);
  assert.equal(isAssignmentGradebook({ letterGrade: 'Grade', term: 'Term' }), false);
  assert.deepEqual(factTablesFor('discipline', {}), ['discipline_incidents']);
  assert.deepEqual(factTablesFor('results', {}), ['results']);
  assert.deepEqual(factTablesFor('grades', { letterGrade: 'Grade' }), []);
});

test('facts: preview advertises the fact tables an import will write', () => {
  assert.deepEqual(previewImport(sample('attendance-daily.csv')).factTables, ['attendance']);
  assert.deepEqual(previewImport(sample('attendance.csv')).factTables, []);
  assert.deepEqual(previewImport(sample('grades-assignments.csv')).factTables, ['line_items', 'results']);
  assert.deepEqual(previewImport(sample('grades.csv')).factTables, []);
  assert.deepEqual(previewImport(sample('powerschool-students.csv')).factTables, ['contacts', 'services']);
  assert.deepEqual(previewImport(sample('oneroster-enrollments.csv')).factTables, ['enrollments']);
});

test('facts: a per-day attendance log becomes attendance rows, then metrics', async () => {
  const { store, sql } = await tmpSqlStore();
  seedRoster(store, sql);
  const r = applyImport(store, sample('attendance-daily.csv'), { actor: 'admin', sql });
  assert.equal(r.kind, 'attendance');
  assert.deepEqual(r.facts, { attendance: 12 });
  assert.deepEqual(r.derived, { updated: 3, skipped: 0 });

  const rows = sql.db.prepare('SELECT id, date, period, code, minutes FROM attendance WHERE studentSourcedId = ? ORDER BY date').all('STU-700001');
  assert.equal(rows.length, 4);
  assert.equal(rows[0].id, 'STU-700001-2026-09-01-P1', 'id is student, date, period');
  assert.deepEqual(rows.map((x) => x.code), ['present', 'absent', 'tardy', 'present']);
  assert.equal(rows[0].minutes, 55);

  // present + tardy count as present; an excused absence still counts as absent
  assert.equal(store.getEntity('STU-700001').metrics.attendancePct, 75);
  assert.equal(store.getEntity('STU-700002').metrics.attendancePct, 75);
  assert.equal(sql.db.prepare("SELECT code FROM attendance WHERE studentSourcedId='STU-700003' AND date='2026-09-03'").get().code, 'remote');
});

test('facts: a summary attendance file still writes only a metric', async () => {
  const { store, sql } = await tmpSqlStore();
  seedRoster(store, sql);
  const r = applyImport(store, sample('attendance.csv'), { actor: 'admin', sql });
  assert.deepEqual(r.facts, {});
  assert.equal(r.derived, null);
  assert.equal(sql.counts().attendance, 0);
  assert.equal(store.getEntity('STU-700001').metrics.attendancePct, 93.2);
});

test('facts: a gradebook becomes line items and results shared across students', async () => {
  const { store, sql } = await tmpSqlStore();
  seedRoster(store, sql);
  const r = applyImport(store, sample('grades-assignments.csv'), { actor: 'admin', sql });
  assert.equal(r.kind, 'grades');
  assert.deepEqual(r.facts, { line_items: 4, results: 12 }, 'four assignments, twelve scores');
  assert.deepEqual(r.derived, { updated: 3, skipped: 0 });

  const item = sql.db.prepare("SELECT * FROM line_items WHERE title = 'Unit 1 Test'").get();
  assert.equal(item.classSourcedId, 'Math 4');
  assert.equal(item.resultValueMax, 100);
  assert.equal(item.category, 'Test');
  assert.equal(item.dueDate, '2026-09-20');

  const missing = sql.db.prepare("SELECT * FROM results WHERE studentSourcedId='STU-700001' AND lineItemSourcedId LIKE '%Homework-3'").get();
  assert.equal(missing.score, null);
  assert.equal(missing.scoreStatus, 'not submitted');

  const m = store.getEntity('STU-700001').metrics;
  assert.equal(m.gpa, 3, '90%, 72%, 88% graded -> 4, 2, 3');
  assert.equal(m.assignCompletionPct, 75, 'three of four turned in');
  assert.equal(store.getEntity('STU-700002').metrics.gpa, 4);
});

test('facts: a transcript-style grades file keeps writing metrics only', async () => {
  const { store, sql } = await tmpSqlStore();
  seedRoster(store, sql);
  const r = applyImport(store, sample('grades.csv'), { actor: 'admin', sql });
  assert.deepEqual(r.facts, {});
  assert.equal(sql.counts().results, 0);
  assert.equal(store.getEntity('STU-700010').metrics.gpa, 1.93);
  assert.ok(store.getEntity('STU-700010').metrics.trajectory < 0);
});

test('facts: discipline rows are kept, and the count is derived from them', async () => {
  const { store, sql } = await tmpSqlStore();
  seedRoster(store, sql);
  const csv = ['Student ID,Incident Date,Infraction,Description,Consequence,Reported By',
    '700008,2026-09-04,Disruption,Talking during instruction,Lunch detention,Teacher 2',
    '700008,2026-10-11,Disruption,Left class without permission,Parent contact,Teacher 2',
    '700008,2026-11-02,Defiance,Refused redirection,In-school suspension,Dean',
    '700010,2026-09-19,Tardy policy,Fourth tardy,Warning,Teacher 5'].join('\n');
  const r = applyImport(store, csv, { actor: 'admin', sql });
  assert.deepEqual(r.facts, { discipline_incidents: 4 });
  assert.deepEqual(r.derived, { updated: 2, skipped: 0 });
  const rows = sql.db.prepare('SELECT * FROM discipline_incidents WHERE studentSourcedId = ? ORDER BY date').all('STU-700008');
  assert.equal(rows.length, 3);
  assert.equal(rows[0].type, 'Disruption');
  assert.equal(rows[0].action, 'Lunch detention');
  assert.equal(rows[0].reportedBy, 'Teacher 2');
  assert.equal(rows[0].description, 'Talking during instruction');
  assert.equal(store.getEntity('STU-700008').metrics.disciplineIncidents, 3);
  assert.equal(store.getEntity('STU-700010').metrics.disciplineIncidents, 1);
});

test('facts: re-importing the same file overwrites rows instead of doubling them', async () => {
  const { store, sql } = await tmpSqlStore();
  seedRoster(store, sql);
  applyImport(store, sample('attendance-daily.csv'), { actor: 'admin', sql });
  applyImport(store, sample('attendance-daily.csv'), { actor: 'admin', sql });
  assert.equal(sql.counts().attendance, 12, 'ids are stable, so the second pass replaces the first');
  assert.equal(store.getEntity('STU-700001').metrics.attendancePct, 75);
});

test('facts: a roster writes guardians as contacts and flags as services', async () => {
  const { store, sql } = await tmpSqlStore();
  const r = seedRoster(store, sql);
  assert.equal(r.facts.contacts, 12);
  assert.ok(r.facts.services > 0);
  assert.equal(r.derived, null, 'a roster states its own metrics; it does not derive them');

  const c = sql.db.prepare('SELECT * FROM contacts WHERE studentSourcedId = ?').get('STU-700001');
  assert.equal(c.id, 'STU-700001-1');
  assert.equal(c.name, 'Okonkwo, Ngozi');
  assert.equal(c.relation, 'mother', 'the column name is the relationship');
  assert.equal(c.email, 'ngozi.okonkwo@example.org');
  assert.equal(c.phone, '555-0142');
  assert.equal(c.isPrimary, 1);

  const svc = (id) => sql.db.prepare('SELECT type, level FROM services WHERE studentSourcedId = ? ORDER BY type').all(id);
  assert.deepEqual(svc('STU-700001'), [{ type: 'ELL', level: 'Newcomer' }, { type: 'FRL', level: 'free' }]);
  assert.deepEqual(svc('STU-700002'), [{ type: '504', level: '504' }, { type: 'ELL', level: 'None' }, { type: 'FRL', level: 'reduced' }]);
  assert.deepEqual(svc('STU-700010'), [{ type: 'ELL', level: 'Beginner' }, { type: 'FRL', level: 'free' }, { type: 'IEP', level: 'IEP-partial' }]);
  assert.equal(sql.db.prepare("SELECT count(*) c FROM services WHERE studentSourcedId='STU-700003' AND type='FRL'").get().c, 0, 'paid lunch is not a service');
});

test('facts: an Aeries roster maps its codes into the same service rows', async () => {
  const { store, sql } = await tmpSqlStore();
  applyImport(store, sample('aeries-students.csv'), { actor: 'admin', sql });
  const svc = (id) => sql.db.prepare('SELECT type, level FROM services WHERE studentSourcedId = ? ORDER BY type').all(id);
  assert.deepEqual(svc('STU-800004'), [{ type: 'ELL', level: 'None' }, { type: 'FRL', level: 'free' }, { type: 'IEP', level: 'IEP-full' }]);
  assert.equal(sql.db.prepare("SELECT relation FROM contacts WHERE studentSourcedId='STU-800001'").get().relation, 'guardian');
});

// ------------------------------------------------- OneRoster relational --

async function oneRosterBundle(files) {
  const { store, sql } = await tmpSqlStore();
  const results = {};
  for (const f of files) results[f] = applyImport(store, sample(`oneroster-${f}.csv`), { actor: 'admin', sql });
  return { store, sql, results };
}

test('oneroster: each relational file is detected and lands in its fact table', async () => {
  const { sql, results } = await oneRosterBundle(['orgs', 'users', 'academic-sessions', 'courses', 'classes', 'enrollments', 'lineitems', 'results']);
  assert.equal(results['academic-sessions'].kind, 'academicSessions');
  assert.equal(results.courses.kind, 'courses');
  assert.equal(results.classes.kind, 'classes');
  assert.equal(results.enrollments.kind, 'enrollments');
  assert.equal(results.lineitems.kind, 'lineItems');
  assert.equal(results.results.kind, 'results');
  const c = sql.counts();
  assert.equal(c.academic_sessions, 3);
  assert.equal(c.courses, 5);
  assert.equal(c.classes, 5);
  assert.equal(c.enrollments, 13);
  assert.equal(c.line_items, 4);
  assert.equal(c.results, 12);

  const term = sql.db.prepare("SELECT * FROM academic_sessions WHERE sourcedId='term-f2026'").get();
  assert.equal(term.type, 'term');
  assert.equal(term.parentSourcedId, 'ay-2026');
  const cls = sql.db.prepare("SELECT * FROM classes WHERE sourcedId='cls-math4a'").get();
  assert.equal(cls.courseSourcedId, 'crs-math4');
  assert.equal(cls.termSourcedIds, 'term-f2026');
  assert.equal(cls.schoolSourcedId, 'SCH-EASTLAKE-ELEMENTARY', 'the org id is remapped to the school entity');
});

test('oneroster: enrollments and results join to the students the roster created', async () => {
  const { store, sql, results } = await oneRosterBundle(['orgs', 'users', 'courses', 'classes', 'enrollments', 'lineitems', 'results']);
  assert.equal(results.enrollments.facts.enrollments, 13);
  assert.equal(results.results.facts.results, 12);

  // the vendor said onr-7001; the row must point at the entity we made for them
  assert.equal(sql.db.prepare("SELECT userSourcedId FROM enrollments WHERE sourcedId='enr-0001'").get().userSourcedId, 'STU-onr-7001');
  assert.equal(sql.db.prepare("SELECT studentSourcedId FROM results WHERE sourcedId='res-0001'").get().studentSourcedId, 'STU-onr-7001');
  // a teacher reference is kept as-is rather than dropped
  assert.equal(sql.db.prepare("SELECT userSourcedId, role FROM enrollments WHERE sourcedId='enr-0006'").get().role, 'teacher');

  const m = store.getEntity('STU-onr-7001').metrics;
  assert.equal(m.gpa, 3);
  assert.equal(m.assignCompletionPct, 75);
  assert.equal(store.getEntity('STU-onr-7002').metrics.gpa, 4);
  assert.equal(store.getEntity('STU-onr-7007').metrics.extracurricularCount, 2, 'band and robotics');
});

test('oneroster: a result for a student this district has never seen is skipped', async () => {
  const { store, sql } = await tmpSqlStore();
  applyImport(store, sample('oneroster-lineitems.csv'), { actor: 'admin', sql });
  const csv = ['sourcedId,lineItemSourcedId,studentSourcedId,score,scoreStatus',
    'res-x1,li-m4-q1,who-is-this,15,fully graded'].join('\n');
  const r = applyImport(store, csv, { actor: 'admin', sql });
  assert.equal(r.kind, 'results');
  assert.equal(r.skipped, 1);
  assert.ok(/does not have/.test(r.errors[0].message));
  assert.equal(sql.counts().results, 0);
});

test('facts: dryRun reports the rows it would write, and writes none', async () => {
  const { store, sql } = await tmpSqlStore();
  seedRoster(store, sql);
  const r = applyImport(store, sample('attendance-daily.csv'), { actor: 'admin', sql, dryRun: true });
  assert.deepEqual(r.facts, { attendance: 12 }, 'counts are a preview, like created/updated');
  assert.equal(r.derived, null);
  assert.equal(sql.counts().attendance, 0, 'nothing reached the projection');
  assert.equal(store.getEntity('STU-700001').metrics.attendancePct, 93.4, 'the roster value is untouched');
});

test('facts: without a projection the rows are still recorded, and apply says so', async () => {
  const store = await tmpStore();
  seedRoster(store, null);
  const r = applyImport(store, sample('attendance-daily.csv'), { actor: 'admin' });
  assert.deepEqual(r.facts, { attendance: 12 });
  assert.equal(r.derived, null);
  assert.ok(r.warnings.some((w) => /not derived/.test(w)));
  // the ledger still carries them, so a later rebuild picks them up
  const events = [...store.ledger.replay()].filter((e) => e.type === 'fact.upsert');
  assert.ok(events.length > 0);
  // and the fallback metric still lands
  assert.equal(store.getEntity('STU-700001').metrics.attendancePct, 75);
});

// -------------------------------------------------------------- describe --

test('describe: a record reads as plain English and never names the student', () => {
  const text = describeStudent({
    type: 'student', firstName: 'Amara', lastName: 'Okonkwo', grade: 4, frl: 'free',
    metrics: { attendancePct: 93, gpa: 2.2, trajectory: 0, extracurricularCount: 2, ellLevel: 'Newcomer', specialEd: '504' },
  }, { schoolName: 'Riverside Elementary' });
  assert.ok(!/Amara|Okonkwo/.test(text), 'no name in the description');
  assert.ok(text.includes('4th grader at Riverside Elementary.'));
  assert.ok(text.includes('Attendance 93%.'));
  assert.ok(text.includes('GPA 2.2, trending flat.'));
  assert.ok(text.includes('Two extracurriculars.'));
  assert.ok(text.includes('English proficiency: newcomer.'));
  assert.ok(text.includes('Receives 504 accommodations.'));
});

test('describe: kindergarten and empty records still produce something sayable', () => {
  assert.ok(describeStudent({ type: 'student', grade: 0, metrics: {} }).startsWith('Kindergartner.'));
  assert.ok(describeStudent({ type: 'student', metrics: {} }).length > 0);
  assert.equal(describeStudent({ type: 'staff' }), '');
  assert.equal(describeStudent(null), '');
});

// ------------------------------------------------------------------ jobs --

/** A store stub: real entity handling, fake (instant) embedding. */
function stubEmbedding(store) {
  const added = [];
  store.addFragments = async (inputs, actor) => {
    for (const f of inputs) {
      const frag = { ...f, id: `f-${added.length + 1}`, createdAt: new Date().toISOString() };
      store.fragments.set(frag.id, frag);
      if (!store.byEntity.has(frag.entityId)) store.byEntity.set(frag.entityId, new Set());
      store.byEntity.get(frag.entityId).add(frag.id);
      added.push(frag);
    }
    return inputs;
  };
  store.addFragment = async (input, actor) => (await store.addFragments([input], actor))[0];
  store.removeFragment = async (id) => {
    const f = store.fragments.get(id);
    if (!f) return false;
    store.fragments.delete(id);
    store.byEntity.get(f.entityId)?.delete(id);
    return true;
  };
  return added;
}

test('jobs: one record fragment per student, and a re-import replaces it', async () => {
  const store = await tmpStore();
  stubEmbedding(store);
  applyImport(store, sample('powerschool-students.csv'), { actor: 'admin' });
  const jobs = new ImportJobs(store);

  const job = jobs.enqueue({ entityIds: ['STU-700001', 'STU-700004'], preset: 'powerschool', actor: 'admin' });
  assert.equal(job.total, 2);
  assert.equal(job.status, 'running');
  await jobs.idle();
  assert.equal(job.status, 'done');
  assert.equal(job.done, 2);
  assert.deepEqual(job.errors, []);
  assert.ok(job.finishedAt);

  const frags = store.getFragments('STU-700001');
  assert.equal(frags.length, 1);
  assert.equal(frags[0].kind, 'record');
  assert.equal(frags[0].visibility, 'school');
  assert.equal(frags[0].source, 'import:powerschool');
  assert.deepEqual(frags[0].author, { id: 'admin', role: 'system' });
  assert.ok(frags[0].text.includes('Riverside Elementary'));

  // Re-import: the old record is removed, not stacked.
  applyImport(store, 'Student_Number,GPA\n700001,3.9\n', { actor: 'admin', preset: 'powerschool', kind: 'students' });
  await jobs.enqueue({ entityIds: ['STU-700001'], preset: 'powerschool', actor: 'admin' }) && await jobs.idle();
  const after = store.getFragments('STU-700001');
  assert.equal(after.length, 1, 'still exactly one record fragment');
  assert.ok(after[0].text.includes('GPA 3.9'));
});

test('jobs: hand-written fragments are left alone', async () => {
  const store = await tmpStore();
  stubEmbedding(store);
  applyImport(store, sample('powerschool-students.csv'), { actor: 'admin' });
  await store.addFragment({ entityId: 'STU-700002', kind: 'observation', visibility: 'school', text: 'Leads confidently in small groups.', source: 'teacher' }, 'teacher.0');
  const jobs = new ImportJobs(store);
  jobs.enqueue({ entityIds: ['STU-700002'], preset: 'powerschool', actor: 'admin' });
  await jobs.idle();
  const kinds = store.getFragments('STU-700002').map((f) => f.kind).sort();
  assert.deepEqual(kinds, ['observation', 'record']);
});

test('jobs: a failing student is recorded without stopping the queue', async () => {
  const store = await tmpStore();
  stubEmbedding(store);
  applyImport(store, sample('powerschool-students.csv'), { actor: 'admin' });
  const jobs = new ImportJobs(store);
  const job = jobs.enqueue({ entityIds: ['STU-700001', 'STU-DOES-NOT-EXIST'], preset: 'powerschool', actor: 'admin' });
  assert.equal(job.total, 1, 'unknown ids are filtered before the queue');
  await jobs.idle();
  assert.equal(job.status, 'done');
  assert.equal(store.getFragments('STU-700001').length, 1);
  assert.deepEqual(jobs.list().map((j) => j.id), [job.id]);
  assert.equal(jobs.get(job.id), job);
  assert.equal(jobs.get('nope'), null);
});

test('jobs: the real embedding path writes one fragment end to end', async () => {
  const store = await tmpStore();
  applyImport(store, 'Student_Number,First_Name,Last_Name,Grade_Level,School_Name,GPA\n7,Solveig,Amundsen,6,Harbor Middle,3.4\n',
    { actor: 'admin', preset: 'powerschool', kind: 'students' });
  const jobs = new ImportJobs(store);
  jobs.enqueue({ entityIds: ['STU-7'], preset: 'powerschool', actor: 'admin' });
  await jobs.idle();
  const frags = store.getFragments('STU-7');
  assert.equal(frags.length, 1);
  assert.equal(frags[0].kind, 'record');
  assert.ok(frags[0].text.includes('6th grader at Harbor Middle.'));
});
