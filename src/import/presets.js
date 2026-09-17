// Column alias dictionaries for the SIS exports districts actually hand us.
// A preset maps canonical Librea field -> the column names that vendor uses.
// Nothing here is authoritative about a vendor's schema; it is a generous
// guess list, and the UI always lets a human correct the mapping.
import { STUDENT_METRICS } from '../core/schema.js';

export const METRIC_KEYS = Object.keys(STUDENT_METRICS);

/** Canonical fields per file kind. Order is the order the UI renders them. */
export const CANONICAL_FIELDS = {
  students: ['id', 'externalId', 'firstName', 'lastName', 'preferredName', 'grade', 'schoolId', 'schoolName',
    'dob', 'gender', 'email', 'frl', 'enrollStatus', 'guardianName', 'guardianEmail', 'guardianPhone', 'guardianIds', 'role', ...METRIC_KEYS],
  staff: ['id', 'firstName', 'lastName', 'email', 'role', 'schoolId', 'schoolName'],
  attendance: ['studentId', 'date', 'period', 'classId', 'daysPresent', 'daysAbsent', 'daysEnrolled', 'attendancePct', 'status', 'minutes', 'note'],
  grades: ['studentId', 'course', 'classId', 'assignment', 'category', 'pointsPossible', 'pointsMin', 'score', 'scoreStatus',
    'scoreDate', 'dueDate', 'letterGrade', 'numericGrade', 'credits', 'term'],
  discipline: ['studentId', 'date', 'incidentType', 'description', 'action', 'reportedBy', 'schoolId'],
  orgs: ['id', 'name', 'orgType', 'parentId', 'identifier'],
  academicSessions: ['id', 'title', 'sessionType', 'startDate', 'endDate', 'schoolYear', 'parentId'],
  courses: ['id', 'title', 'courseCode', 'orgId', 'subjects', 'grades'],
  classes: ['id', 'title', 'classCode', 'classType', 'courseId', 'schoolId', 'termIds', 'periods', 'subjects', 'grades'],
  enrollments: ['id', 'classId', 'userId', 'role', 'isPrimary', 'beginDate', 'endDate', 'schoolId'],
  lineItems: ['id', 'title', 'classId', 'category', 'assignDate', 'dueDate', 'pointsMin', 'pointsPossible', 'gradingPeriodId'],
  results: ['id', 'lineItemId', 'studentId', 'score', 'scoreStatus', 'scoreDate', 'comment'],
};
export const KINDS = [...Object.keys(CANONICAL_FIELDS), 'unknown'];

/** lower-case, strip everything that is not a letter or digit. */
export const normalizeHeader = (h) => String(h ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

// ---------------------------------------------------------------- presets --

const POWERSCHOOL = {
  id: ['Student_Number', 'StudentNumber', 'Student Number', 'DCID', 'ID'],
  externalId: ['State_StudentNumber', 'StateStudentNumber', 'State_ID', 'SSID'],
  firstName: ['First_Name', 'FirstName', 'Student_First_Name'],
  lastName: ['Last_Name', 'LastName', 'Student_Last_Name'],
  preferredName: ['Nickname', 'Preferred_Name', 'Middle_Name'],
  grade: ['Grade_Level', 'GradeLevel', 'Grade'],
  schoolId: ['SchoolID', 'School_ID', 'Schoolid'],
  schoolName: ['School_Name', 'SchoolName', 'Sched_Schoolname'],
  dob: ['DOB', 'Birth_Date', 'BirthDate', 'Date_Of_Birth'],
  gender: ['Gender', 'Sex'],
  email: ['Student_Email', 'EMail_Addr', 'Email_Addr', 'Student_Web_Email'],
  enrollStatus: ['Enroll_Status', 'EnrollmentStatus', 'Enroll_Status_Description', 'EntryCode'],
  guardianName: ['Guardian', 'Mother', 'Father', 'Mother_First', 'Father_First', 'Guardianship', 'Emerg_Contact_1'],
  guardianEmail: ['Guardian_Email', 'GuardianEmail', 'Mother_Email', 'Father_Email', 'Emerg_Email'],
  guardianPhone: ['Home_Phone', 'Guardian_Phone', 'Mother_Home_Phone', 'Father_Home_Phone', 'Mother_Daytime_Phone', 'Emerg_Phone_1'],
  frl: ['LunchStatus', 'Lunch_Status', 'FreeReducedStatus', 'Meal_Status', 'LunchID'],
  ellLevel: ['ELL_Status', 'LEP_Status', 'EL_Status', 'LEP', 'ELL', 'Language_Proficiency', 'ELL_Level'],
  specialEd: ['SpecialEd', 'Special_Ed', 'SPED', 'IEP', 'Special_Education', 'Section_504', 'Program504'],
  gpa: ['GPA', 'Cumulative_GPA', 'GPA_Cumulative', 'SimpleGPA'],
  attendancePct: ['ADA', 'Attendance_Rate', 'Attendance_Percent', 'AttendancePercent'],
  disciplineIncidents: ['Discipline_Incidents', 'Referrals', 'Log_Entries'],
  testPercentile: ['Test_Percentile', 'StateTest_Percentile'],
};
const POWERSCHOOL_SIG = ['Student_Number', 'Grade_Level', 'SchoolID', 'Last_Name', 'First_Name', 'Enroll_Status', 'LunchStatus'];

// Aeries exports the raw STU table column codes; they are short but distinctive.
const AERIES = {
  id: ['ID', 'StudentID', 'STU.ID', 'PermID', 'SN', 'STU.SN', 'Student_ID'],
  externalId: ['SSID', 'STU.CID', 'StateID', 'SN', 'STU.SN'],
  firstName: ['FN', 'STU.FN', 'First_Name', 'FirstName'],
  lastName: ['LN', 'STU.LN', 'Last_Name', 'LastName'],
  preferredName: ['NN', 'STU.NN', 'Nickname'],
  grade: ['GR', 'STU.GR', 'Grade'],
  schoolId: ['SC', 'STU.SC', 'School'],
  schoolName: ['School_Name', 'SchoolName', 'SiteName'],
  dob: ['BD', 'STU.BD', 'BirthDate'],
  gender: ['SX', 'STU.SX', 'Gender'],
  email: ['SEM', 'STU.SEM', 'Student_Email', 'StudentEmail'],
  enrollStatus: ['TG', 'STU.TG', 'Status', 'EnrollStatus', 'DelTag'],
  guardianName: ['NP', 'STU.NP', 'MN', 'FA', 'Parent_Name', 'ParentName', 'Guardian'],
  guardianEmail: ['PEM', 'STU.PEM', 'Parent_Email', 'ParentEmail'],
  guardianPhone: ['TL', 'STU.TL', 'PH', 'Parent_Phone', 'Telephone'],
  frl: ['NSLP', 'MealStatus', 'FRL', 'LunchStatus'],
  ellLevel: ['LF', 'STU.LF', 'LangFluency', 'Language_Fluency', 'ELPAC'],
  specialEd: ['SP', 'STU.SP', 'SE', 'SpecialEd', 'SpecialProgram'],
  gpa: ['GPA', 'CumGPA', 'GPA_Cum'],
  attendancePct: ['ADA', 'AttendancePct', 'Attendance'],
};
const AERIES_SIG = ['SC', 'GR', 'FN', 'LN', 'BD', 'SX', 'LF', 'NP', 'PEM'];

const INFINITE_CAMPUS = {
  id: ['studentNumber', 'student_number', 'localStudentNumber', 'personID', 'personId'],
  externalId: ['stateID', 'stateId', 'state_id'],
  firstName: ['firstName', 'first_name', 'legalFirstName'],
  lastName: ['lastName', 'last_name', 'legalLastName'],
  preferredName: ['nickname', 'alias', 'preferredName'],
  grade: ['grade', 'gradeLevel', 'grade_level'],
  schoolId: ['schoolNumber', 'schoolID', 'schoolId'],
  schoolName: ['schoolName', 'school', 'calendarName'],
  dob: ['birthdate', 'birthDate', 'dob'],
  gender: ['gender', 'legalGender'],
  email: ['email', 'studentEmail', 'homePrimaryEmail'],
  enrollStatus: ['enrollmentStatus', 'endStatus', 'serviceType', 'activeStatus'],
  guardianName: ['guardianName', 'contactName', 'primaryContact'],
  guardianEmail: ['guardianEmail', 'contactEmail'],
  guardianPhone: ['guardianPhone', 'homePhone', 'cellPhone', 'contactPhone'],
  frl: ['framStatus', 'freeReducedStatus', 'mealStatus', 'eligibility'],
  ellLevel: ['ellLevel', 'elLevel', 'englishProficiency', 'limitedEnglishProficiency', 'lep', 'ell', 'homePrimaryLanguage'],
  specialEd: ['specialEdStatus', 'specialEdSetting', 'iepStatus', 'section504', 'disability'],
  gpa: ['gpa', 'cumulativeGPA'],
  attendancePct: ['attendancePercent', 'attendanceRate', 'ada'],
};
const INFINITE_CAMPUS_SIG = ['studentNumber', 'personID', 'birthdate', 'homePrimaryLanguage', 'calendarName', 'framStatus', 'stateID'];

// OneRoster 1.1 CSV: users.csv / orgs.csv / enrollments.csv
const ONEROSTER = {
  id: ['sourcedId', 'sourcedid'],
  externalId: ['identifier', 'userIds', 'userId'],
  firstName: ['givenName'],
  lastName: ['familyName'],
  preferredName: ['middleName', 'preferredFirstName'],
  grade: ['grades', 'grade'],
  schoolId: ['orgSourcedIds', 'schoolSourcedId', 'orgSourcedId'],
  email: ['email'],
  role: ['role'],
  enrollStatus: ['status', 'enabledUser'],
  guardianIds: ['agentSourcedIds'],
  guardianPhone: ['phone', 'sms'],
  studentId: ['studentSourcedId', 'userSourcedId'],
  userId: ['userSourcedId'],
  name: ['name'],
  orgType: ['type'],
  parentId: ['parentSourcedId'],
  identifier: ['identifier'],
  orgId: ['orgSourcedId', 'schoolSourcedId'],
  courseId: ['courseSourcedId'],
  courseCode: ['courseCode'],
  classId: ['classSourcedId'],
  classCode: ['classCode'],
  classType: ['classType'],
  termIds: ['termSourcedIds', 'termSourcedId'],
  periods: ['periods', 'period'],
  subjects: ['subjects'],
  sessionType: ['type'],
  startDate: ['startDate'],
  endDate: ['endDate'],
  schoolYear: ['schoolYear'],
  beginDate: ['beginDate'],
  isPrimary: ['primary', 'isPrimary'],
  lineItemId: ['lineItemSourcedId'],
  gradingPeriodId: ['gradingPeriodSourcedId'],
  assignDate: ['assignDate'],
  dueDate: ['dueDate'],
  pointsMin: ['resultValueMin'],
  pointsPossible: ['resultValueMax'],
  score: ['score'],
  scoreStatus: ['scoreStatus'],
  scoreDate: ['scoreDate'],
  comment: ['comment'],
  category: ['category', 'categorySourcedId'],
  term: ['schoolYear'],
};
const ONEROSTER_SIG = ['sourcedId', 'givenName', 'familyName', 'orgSourcedIds', 'agentSourcedIds', 'enabledUser', 'dateLastModified'];

/** The catch-all. Synonyms people actually type into a spreadsheet header. */
const GENERIC = {
  id: ['id', 'student id', 'studentid', 'student_id', 'sid', 'student number', 'local id', 'local_id', 'student', 'student no', 'pupil id'],
  externalId: ['external id', 'state id', 'state_id', 'ssid', 'stateidnumber', 'district id', 'unique id'],
  firstName: ['first', 'first name', 'fname', 'given name', 'givenname', 'forename'],
  lastName: ['last', 'last name', 'lname', 'surname', 'family name', 'familyname'],
  preferredName: ['preferred name', 'nickname', 'goes by', 'preferred'],
  grade: ['grade', 'grade level', 'gradelevel', 'gr', 'year', 'yr', 'class year'],
  schoolId: ['school id', 'schoolid', 'school code', 'site id', 'site code', 'campus id'],
  schoolName: ['school', 'school name', 'schoolname', 'site', 'site name', 'campus', 'campus name'],
  dob: ['dob', 'birthdate', 'birth date', 'date of birth', 'birthday'],
  gender: ['gender', 'sex'],
  email: ['email', 'email address', 'e-mail', 'student email', 'mail'],
  frl: ['frl', 'free reduced lunch', 'free/reduced', 'lunch', 'lunch status', 'meal status', 'economically disadvantaged', 'low income'],
  enrollStatus: ['status', 'enroll status', 'enrollment status', 'active', 'enrolled'],
  guardianName: ['guardian', 'guardian name', 'parent', 'parent name', 'mother', 'father', 'contact name', 'emergency contact'],
  guardianEmail: ['guardian email', 'parent email', 'contact email', 'family email'],
  guardianPhone: ['guardian phone', 'parent phone', 'home phone', 'phone', 'telephone', 'cell', 'mobile', 'contact phone'],
  guardianIds: ['guardian ids', 'agent sourced ids', 'guardian id'],
  role: ['role', 'position', 'job title', 'title', 'staff type'],
  gpa: ['gpa', 'grade point average', 'cumulative gpa', 'cum gpa', 'weighted gpa', 'unweighted gpa'],
  attendancePct: ['attendance', 'attendance pct', 'attendance percent', 'attendance rate', 'att%', 'attendance %', 'ada', 'present percent'],
  testPercentile: ['test percentile', 'test score', 'percentile', 'assessment percentile', 'state test', 'nwea percentile', 'map percentile'],
  courseRigor: ['course rigor', 'rigor', 'ap courses', 'honors', 'advanced courses', 'rigor index'],
  assignCompletionPct: ['assignment completion', 'assignments completed', 'completion', 'work completion', 'missing work pct'],
  disciplineIncidents: ['discipline', 'discipline incidents', 'incidents', 'referrals', 'office referrals', 'suspensions', 'infractions'],
  extracurricularCount: ['extracurricular', 'extracurriculars', 'activities', 'clubs', 'sports', 'activity count'],
  selScore: ['sel', 'sel score', 'social emotional', 'panorama', 'wellbeing', 'well-being'],
  counselorVisits: ['counselor visits', 'counselor', 'counseling visits', 'support visits'],
  trajectory: ['trajectory', 'trend', 'gpa trend', 'growth', 'direction'],
  ses: ['ses', 'socioeconomic', 'income', 'poverty', 'economic'],
  homeStability: ['home stability', 'stability', 'residential stability', 'moves', 'address changes', 'housing'],
  ellLevel: ['ell', 'ell level', 'el', 'esl', 'lep', 'english learner', 'english proficiency', 'language proficiency', 'language fluency', 'elpac'],
  specialEd: ['special ed', 'special education', 'sped', 'iep', '504', 'section 504', 'disability', 'services'],
  peerConnected: ['peer connections', 'peer connected', 'friends', 'social connection', 'belonging'],
  studentId: ['student id', 'studentid', 'student_id', 'student number', 'sid', 'id', 'student'],
  date: ['date', 'attendance date', 'incident date', 'event date', 'day', 'occurred'],
  status: ['status', 'attendance code', 'code', 'attendance status', 'absence type', 'att code', 'daily status'],
  daysPresent: ['days present', 'present days', 'daysattended', 'days attended', 'present'],
  daysAbsent: ['days absent', 'absent days', 'absences', 'absent'],
  daysEnrolled: ['days enrolled', 'membership', 'days membership', 'enrolled days', 'apportionment', 'possible days'],
  course: ['course', 'course name', 'class', 'class name', 'subject', 'section', 'course title'],
  classId: ['class sourced id', 'classsourcedid', 'class id', 'section id', 'class code'],
  assignment: ['assignment', 'assignment name', 'assignment title', 'task', 'item', 'line item', 'lineitem', 'title'],
  category: ['category', 'assignment category', 'assignment type', 'grade category', 'type'],
  pointsPossible: ['points possible', 'pointspossible', 'max points', 'possible', 'total points', 'point value', 'out of', 'max score'],
  pointsMin: ['points min', 'min points', 'minimum score', 'result value min'],
  score: ['score', 'points earned', 'earned', 'raw score', 'points scored', 'student score'],
  scoreStatus: ['score status', 'submission status', 'submitted', 'turned in', 'status'],
  scoreDate: ['score date', 'graded date', 'date graded', 'submitted date'],
  dueDate: ['due date', 'duedate', 'due'],
  assignDate: ['assign date', 'assigned date', 'date assigned'],
  period: ['period', 'class period', 'block', 'hour'],
  minutes: ['minutes', 'minutes absent', 'minutes present', 'duration'],
  note: ['note', 'notes', 'comment', 'remarks'],
  description: ['description', 'details', 'narrative', 'summary'],
  reportedBy: ['reported by', 'reporter', 'referred by', 'staff', 'teacher'],
  userId: ['user id', 'user sourced id', 'usersourcedid', 'person id'],
  lineItemId: ['line item id', 'lineitemsourcedid', 'line item sourced id', 'assignment id'],
  title: ['title', 'name'],
  sessionType: ['session type', 'term type'],
  startDate: ['start date', 'startdate', 'begin date'],
  endDate: ['end date', 'enddate'],
  schoolYear: ['school year', 'schoolyear', 'year'],
  beginDate: ['begin date', 'begindate', 'start date'],
  isPrimary: ['primary', 'is primary'],
  role: ['role', 'position', 'job title', 'title', 'staff type'],
  classType: ['class type', 'classtype'],
  classCode: ['class code', 'classcode', 'section code'],
  courseId: ['course id', 'course sourced id', 'coursesourcedid'],
  courseCode: ['course code', 'coursecode'],
  orgId: ['org id', 'org sourced id', 'orgsourcedid', 'school sourced id'],
  termIds: ['term ids', 'term sourced ids', 'termsourcedids', 'term'],
  gradingPeriodId: ['grading period id', 'gradingperiodsourcedid', 'grading period'],
  subjects: ['subjects', 'subject area'],
  comment: ['comment', 'comments', 'feedback'],
  letterGrade: ['letter grade', 'grade mark', 'mark', 'final grade', 'letter', 'grade earned'],
  numericGrade: ['numeric grade', 'percent', 'percent grade', 'score', 'points', 'grade points', 'gpa points', 'final percent'],
  credits: ['credits', 'credit hours', 'credit', 'units'],
  term: ['term', 'semester', 'quarter', 'marking period', 'grading period', 'trimester'],
  incidentType: ['incident', 'incident type', 'infraction', 'offense', 'violation', 'behavior', 'reason'],
  action: ['action', 'consequence', 'resolution', 'disposition', 'discipline action'],
  name: ['name', 'school name', 'org name', 'title'],
  orgType: ['type', 'org type', 'level', 'school type'],
  parentId: ['parent id', 'parent sourced id', 'district id', 'parent'],
  identifier: ['identifier', 'code', 'abbreviation'],
};

function build(id, label, aliases, signature, weight = 1) {
  const aliasSet = new Set();
  for (const list of Object.values(aliases)) for (const a of list) aliasSet.add(normalizeHeader(a));
  return { id, label, aliases, signature, weight, aliasSet };
}

export const PRESETS = {
  powerschool: build('powerschool', 'PowerSchool', POWERSCHOOL, POWERSCHOOL_SIG),
  aeries: build('aeries', 'Aeries', AERIES, AERIES_SIG),
  infinitecampus: build('infinitecampus', 'Infinite Campus', INFINITE_CAMPUS, INFINITE_CAMPUS_SIG),
  oneroster: build('oneroster', 'OneRoster 1.1 CSV', ONEROSTER, ONEROSTER_SIG),
  generic: build('generic', 'Generic / spreadsheet', GENERIC, [], 0.55),
};
export const PRESET_IDS = Object.keys(PRESETS);
const GENERIC_PRESET = PRESETS.generic;

export function listPresets() {
  return PRESET_IDS.map((id) => ({
    id, label: PRESETS[id].label,
    fields: Object.fromEntries(Object.entries(PRESETS[id].aliases).map(([k, v]) => [k, v.slice(0, 8)])),
  }));
}

// ---------------------------------------------------------------- scoring --

export function scorePreset(headers, presetId) {
  const p = PRESETS[presetId];
  if (!p) throw new Error(`unknown preset: ${presetId}`);
  const norm = headers.map(normalizeHeader);
  const set = new Set(norm);
  const hits = norm.filter((h) => p.aliasSet.has(h)).length;
  const sig = p.signature.map(normalizeHeader);
  const sigHits = sig.filter((s) => set.has(s)).length;
  const cover = headers.length ? hits / headers.length : 0;
  const sigCover = sig.length ? sigHits / sig.length : 0;
  const score = (sig.length ? 0.5 * cover + 0.5 * sigCover : cover) * p.weight;
  return { preset: presetId, score: +score.toFixed(4), hits, sigHits };
}

/** Best-scoring preset for these headers. Falls back to generic. */
export function detectPreset(headers) {
  const scores = PRESET_IDS.map((id) => scorePreset(headers, id)).sort((a, b) => b.score - a.score);
  const best = scores[0];
  if (!best || best.score < 0.08) return { preset: 'generic', confidence: 0, scores };
  return { preset: best.preset, confidence: Math.min(1, +(best.score / 0.8).toFixed(3)), scores };
}

// ---------------------------------------------------------------- mapping --

const KIND_HINTS = {
  attendance: ['daysabsent', 'dayspresent', 'attendancecode', 'attcode', 'attendancedate', 'absences', 'membership', 'absencetype', 'daysenrolled'],
  grades: ['lettergrade', 'coursename', 'course', 'markingperiod', 'gradingperiod', 'credits', 'finalgrade', 'mark', 'term', 'semester',
    'assignment', 'pointspossible', 'pointsearned', 'scorestatus'],
  discipline: ['incident', 'incidenttype', 'infraction', 'offense', 'suspension', 'referral', 'disposition', 'consequence', 'violation'],
  orgs: ['parentsourcedid', 'orgtype', 'schooltype'],
  staff: ['staffid', 'teacherid', 'position', 'jobtitle', 'stafftype', 'employeeid'],
};
const STUDENT_HINTS = ['gpa', 'gradelevel', 'gr', 'studentnumber', 'lastname', 'ln', 'firstname', 'fn', 'birthdate', 'bd', 'dob', 'attendancepct'];
const STAFF_ROLES = new Set(['teacher', 'staff', 'administrator', 'aide', 'proctor', 'counselor', 'principal', 'relative', 'parent', 'guardian']);

/**
 * OneRoster ships one file per table, and the sourcedId reference columns name
 * the table unambiguously. Checked most-specific first: a results file also
 * carries a sourcedId, so "has sourcedId" alone decides nothing.
 */
const ONEROSTER_SHAPES = [
  ['results', (h) => h.has('lineitemsourcedid')],
  ['lineItems', (h) => h.has('resultvaluemax') || h.has('resultvaluemin') || (h.has('classsourcedid') && h.has('duedate'))],
  ['enrollments', (h) => h.has('usersourcedid') && h.has('classsourcedid')],
  ['classes', (h) => h.has('coursesourcedid') || h.has('classtype') || h.has('classcode')],
  ['courses', (h) => h.has('coursecode') || (h.has('orgsourcedid') && h.has('subjects'))],
  ['academicSessions', (h) => h.has('schoolyear') && (h.has('startdate') || h.has('enddate'))],
  ['orgs', (h) => h.has('parentsourcedid') || (h.has('name') && h.has('type'))],
];

/**
 * Guess what kind of file this is from its headers (and, when a `role` column
 * exists, from the first rows' values).
 */
export function detectKind(headers, presetId = 'generic', rows = []) {
  const set = new Set(headers.map(normalizeHeader));
  if (set.has('sourcedid')) {
    for (const [kind, matches] of ONEROSTER_SHAPES) if (matches(set)) return kind;
    if (set.has('givenname') || set.has('familyname')) return roleKind(rows) || 'students';
  }
  // A per-day attendance log is just student + date + code; too few columns for
  // the hint counting below to reach a verdict, so name the shape outright.
  const attCode = ['attendancecode', 'attcode', 'attendancestatus', 'absencetype', 'dailystatus'].some((h) => set.has(h));
  if (attCode && (set.has('date') || set.has('attendancedate'))) return 'attendance';
  const score = (list) => list.filter((h) => set.has(h)).length;
  const counts = Object.fromEntries(Object.entries(KIND_HINTS).map(([k, v]) => [k, score(v)]));
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const studentScore = score(STUDENT_HINTS);
  if (best && best[1] >= 2 && best[1] >= studentScore) return best[0];
  if (counts.staff >= 1 && studentScore < 2) return 'staff';
  if (studentScore >= 2) return roleKind(rows) || 'students';
  if (best && best[1] >= 2) return best[0];
  return 'unknown';
}

function roleKind(rows) {
  if (!rows?.length) return null;
  const key = Object.keys(rows[0] || {}).find((k) => normalizeHeader(k) === 'role');
  if (!key) return null;
  let staff = 0;
  let student = 0;
  for (const r of rows.slice(0, 25)) {
    const v = String(r[key] || '').trim().toLowerCase();
    if (!v) continue;
    if (v === 'student') student++;
    else if (STAFF_ROLES.has(v)) staff++;
  }
  if (!staff && !student) return null;
  return staff > student ? 'staff' : 'students';
}

/**
 * Match canonical fields to source headers. Preset aliases win; the generic
 * dictionary is always consulted as a fallback, then a loose contains-match.
 */
export function buildMapping(headers, presetId = 'generic', kind = 'students') {
  const preset = PRESETS[presetId] || GENERIC_PRESET;
  const fields = CANONICAL_FIELDS[kind] || CANONICAL_FIELDS.students;
  const norm = headers.map((h) => ({ header: h, n: normalizeHeader(h) }));
  const taken = new Set();
  const mapping = {};
  const pick = (aliases) => {
    if (!aliases) return null;
    const wanted = aliases.map(normalizeHeader);
    for (const w of wanted) {
      const hit = norm.find((h) => h.n === w && !taken.has(h.header));
      if (hit) return hit.header;
    }
    return null;
  };
  // Loose match: a header that *contains* a reasonably long alias. Only the
  // one direction, and only for aliases of 6+ characters, or "email" starts
  // eating "guardian_email" and the mapping quietly goes wrong.
  const loose = (aliases) => {
    if (!aliases) return null;
    let best = null;
    for (const a of aliases.map(normalizeHeader).filter((x) => x.length >= 6)) {
      for (const h of norm) {
        if (taken.has(h.header)) continue;
        if (h.n.includes(a) && (!best || a.length > best.len)) best = { header: h.header, len: a.length };
      }
    }
    return best?.header || null;
  };
  // Two passes on purpose. Every exact alias match is claimed first, so a
  // fuzzy match for "guardian" can never steal the column that "Guardian_Email"
  // names outright.
  for (const f of fields) {
    const hit = pick(preset.aliases[f]) || pick(GENERIC_PRESET.aliases[f]) || pick([f]);
    mapping[f] = hit || null;
    if (hit) taken.add(hit);
  }
  for (const f of fields) {
    if (mapping[f]) continue;
    const hit = loose(preset.aliases[f]) || loose(GENERIC_PRESET.aliases[f]);
    if (hit) { mapping[f] = hit; taken.add(hit); }
  }
  const unmapped = headers.filter((h) => !taken.has(h));
  return { mapping, unmapped };
}
