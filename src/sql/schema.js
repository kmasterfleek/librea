// Relational schema for the SQLite projection. OneRoster 1.1 tables (orgs,
// users, academic_sessions, courses, classes, enrollments, line_items,
// results) plus what a district needs that OneRoster leaves out: attendance,
// discipline_incidents, services, contacts. Column names follow OneRoster's
// camelCase so importers and models can match the standard's docs.
//
// Two kinds of table:
//   projection tables  - rebuilt from entity/fragment/snapshot events (students, staff, orgs, fragments, snapshots)
//   fact tables        - written through `fact.upsert` events (everything else)

export const SCHEMA_VERSION = 3;

export const DIM_COLS = ['gpa', 'attendance', 'testScore', 'courseRigor', 'assignCompletion', 'discipline', 'extracurricular', 'selScore', 'counselorVisits', 'trajectory', 'socioeconomic', 'homeStability', 'ellStatus', 'specialEd', 'peerConnected'];
export const METRIC_COLS = ['gpa', 'attendancePct', 'testPercentile', 'courseRigor', 'assignCompletionPct', 'disciplineIncidents', 'extracurricularCount', 'selScore', 'counselorVisits', 'trajectory', 'ses', 'homeStability', 'ellLevel', 'specialEd', 'peerConnected'];

/** Fact tables: name -> { key, columns, doc }. Only these may be written through fact events. */
export const FACT_TABLES = {
  academic_sessions: { key: 'sourcedId', doc: 'Terms, semesters, grading periods, school years.', columns: { sourcedId: 'TEXT', title: 'TEXT', type: "TEXT /* term|semester|gradingPeriod|schoolYear */", startDate: 'TEXT', endDate: 'TEXT', schoolYear: 'TEXT', parentSourcedId: 'TEXT' } },
  courses: { key: 'sourcedId', doc: 'Course catalog entries (a course is taught as one or more classes).', columns: { sourcedId: 'TEXT', title: 'TEXT', courseCode: 'TEXT', orgSourcedId: 'TEXT', subjects: 'TEXT', grades: 'TEXT' } },
  classes: { key: 'sourcedId', doc: 'A section of a course at a school in a term.', columns: { sourcedId: 'TEXT', title: 'TEXT', classCode: 'TEXT', classType: "TEXT /* homeroom|scheduled|extracurricular */", courseSourcedId: 'TEXT', schoolSourcedId: 'TEXT', termSourcedIds: 'TEXT', periods: 'TEXT', subjects: 'TEXT', grades: 'TEXT' } },
  enrollments: { key: 'sourcedId', doc: 'Who is in which class, as student or teacher.', columns: { sourcedId: 'TEXT', classSourcedId: 'TEXT', userSourcedId: 'TEXT', role: "TEXT /* student|teacher|aide */", isPrimary: 'INTEGER', beginDate: 'TEXT', endDate: 'TEXT', schoolSourcedId: 'TEXT' } },
  line_items: { key: 'sourcedId', doc: 'Assignments and other gradable items in a class.', columns: { sourcedId: 'TEXT', title: 'TEXT', classSourcedId: 'TEXT', category: 'TEXT', assignDate: 'TEXT', dueDate: 'TEXT', resultValueMin: 'REAL', resultValueMax: 'REAL', gradingPeriodSourcedId: 'TEXT' } },
  results: { key: 'sourcedId', doc: 'A student score on a line item.', columns: { sourcedId: 'TEXT', lineItemSourcedId: 'TEXT', studentSourcedId: 'TEXT', score: 'REAL', scoreStatus: "TEXT /* fully graded|partially graded|not submitted|exempt */", scoreDate: 'TEXT', comment: 'TEXT' } },
  attendance: { key: 'id', doc: 'One row per student per day (period optional).', columns: { id: 'TEXT', studentSourcedId: 'TEXT', date: 'TEXT', period: 'TEXT', classSourcedId: 'TEXT', code: "TEXT /* present|absent|tardy|excused|remote */", minutes: 'REAL', note: 'TEXT' } },
  discipline_incidents: { key: 'id', doc: 'Behavior incidents and the action taken.', columns: { id: 'TEXT', studentSourcedId: 'TEXT', date: 'TEXT', type: 'TEXT', description: 'TEXT', action: 'TEXT', reportedBy: 'TEXT', schoolSourcedId: 'TEXT' } },
  services: { key: 'id', doc: 'Programs and services: IEP, 504, ELL, FRL, gifted, counseling.', columns: { id: 'TEXT', studentSourcedId: 'TEXT', type: "TEXT /* IEP|504|ELL|FRL|gifted|counseling|other */", level: 'TEXT', startDate: 'TEXT', endDate: 'TEXT', provider: 'TEXT', note: 'TEXT' } },
  contacts: { key: 'id', doc: 'Guardians and emergency contacts. PII: hidden from scopes without names.', columns: { id: 'TEXT', studentSourcedId: 'TEXT', name: 'TEXT', relation: 'TEXT', email: 'TEXT', phone: 'TEXT', language: 'TEXT', isPrimary: 'INTEGER' } },
};

export const FACT_TABLE_NAMES = Object.keys(FACT_TABLES);

const colDefs = (cols) => Object.entries(cols).map(([c, t]) => `${c} ${t}`).join(', ');

export const DDL = `
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS orgs (sourcedId TEXT PRIMARY KEY, name TEXT, type TEXT, level TEXT, identifier TEXT, parentSourcedId TEXT);
CREATE TABLE IF NOT EXISTS students (
  sourcedId TEXT PRIMARY KEY, givenName TEXT, familyName TEXT, preferredName TEXT, grade INTEGER, schoolSourcedId TEXT,
  dob TEXT, gender TEXT, email TEXT, enrollStatus TEXT, externalIds TEXT,
  ${METRIC_COLS.map((c) => `${c} ${['ellLevel', 'specialEd'].includes(c) ? 'TEXT' : 'REAL'}`).join(', ')},
  ${DIM_COLS.map((c) => `dim_${c} REAL`).join(', ')},
  outcome TEXT, risk REAL, arc TEXT, coverage REAL, flags TEXT, updatedAt TEXT
);
CREATE TABLE IF NOT EXISTS staff (sourcedId TEXT PRIMARY KEY, givenName TEXT, familyName TEXT, email TEXT, role TEXT, schoolSourcedId TEXT, updatedAt TEXT);
CREATE TABLE IF NOT EXISTS fragments (id TEXT PRIMARY KEY, entityId TEXT, kind TEXT, visibility TEXT, authorId TEXT, authorRole TEXT, source TEXT, createdAt TEXT, mediaPath TEXT, text TEXT);
CREATE TABLE IF NOT EXISTS snapshots (entityId TEXT, at TEXT, ${DIM_COLS.map((c) => `${c} REAL`).join(', ')}, PRIMARY KEY (entityId, at));
${FACT_TABLE_NAMES.map((t) => `CREATE TABLE IF NOT EXISTS ${t} (${colDefs(FACT_TABLES[t].columns).replace(new RegExp(`^${FACT_TABLES[t].key} TEXT`), `${FACT_TABLES[t].key} TEXT PRIMARY KEY`)});`).join('\n')}
CREATE INDEX IF NOT EXISTS idx_students_school ON students(schoolSourcedId);
CREATE INDEX IF NOT EXISTS idx_students_grade ON students(grade);
CREATE INDEX IF NOT EXISTS idx_fragments_entity ON fragments(entityId);
CREATE INDEX IF NOT EXISTS idx_snapshots_entity ON snapshots(entityId);
CREATE INDEX IF NOT EXISTS idx_enrollments_user ON enrollments(userSourcedId);
CREATE INDEX IF NOT EXISTS idx_enrollments_class ON enrollments(classSourcedId);
CREATE INDEX IF NOT EXISTS idx_results_student ON results(studentSourcedId);
CREATE INDEX IF NOT EXISTS idx_results_item ON results(lineItemSourcedId);
CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance(studentSourcedId, date);
CREATE INDEX IF NOT EXISTS idx_incidents_student ON discipline_incidents(studentSourcedId);
CREATE INDEX IF NOT EXISTS idx_services_student ON services(studentSourcedId);
CREATE INDEX IF NOT EXISTS idx_contacts_student ON contacts(studentSourcedId);
CREATE VIEW IF NOT EXISTS users AS
  SELECT sourcedId, 'student' AS role, givenName, familyName, email, grade, schoolSourcedId AS orgSourcedId FROM students
  UNION ALL SELECT sourcedId, 'teacher', givenName, familyName, email, NULL, schoolSourcedId FROM staff;
`;

/** Tables whose rows belong to a student and are scoped by entity id. Column naming the student. */
export const STUDENT_SCOPED = { students: 'sourcedId', fragments: 'entityId', snapshots: 'entityId', enrollments: 'userSourcedId', results: 'studentSourcedId', attendance: 'studentSourcedId', discipline_incidents: 'studentSourcedId', services: 'studentSourcedId', contacts: 'studentSourcedId' };
export const PII_COLS = { students: ['givenName', 'familyName', 'preferredName', 'dob', 'email', 'externalIds'], staff: ['email'] };
export const PII_ONLY_TABLES = ['contacts'];

/** Human/model-readable description of every table for prompts and the schema browser. */
export function describeSchema() {
  const t = (name, doc, cols) => ({ name, doc, columns: cols });
  return [
    t('students', 'One row per student: identity (when your scope allows names), the raw metrics, the 15 normalized dims (dim_*), outcome, risk, arc.', ['sourcedId', 'givenName', 'familyName', 'preferredName', 'grade', 'schoolSourcedId', 'enrollStatus', ...METRIC_COLS, ...DIM_COLS.map((c) => 'dim_' + c), 'outcome', 'risk', 'arc', 'coverage', 'flags']),
    t('staff', 'Teachers, counselors, principals.', ['sourcedId', 'givenName', 'familyName', 'email', 'role', 'schoolSourcedId']),
    t('orgs', 'Schools and the district.', ['sourcedId', 'name', 'type', 'level']),
    t('users', 'OneRoster-style view over students and staff.', ['sourcedId', 'role', 'givenName', 'familyName', 'email', 'grade', 'orgSourcedId']),
    t('fragments', 'The co-authored record: what students, families, and staff wrote. Filtered by your visibility.', ['id', 'entityId', 'kind', 'visibility', 'authorId', 'authorRole', 'source', 'createdAt', 'text']),
    t('snapshots', 'Monthly signal-dimension snapshots per student (values 0..1).', ['entityId', 'at', ...DIM_COLS]),
    ...FACT_TABLE_NAMES.map((n) => t(n, FACT_TABLES[n].doc, Object.keys(FACT_TABLES[n].columns))),
  ];
}
