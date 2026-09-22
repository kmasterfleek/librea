// Canonical schema for Librea: the shapes every importer maps INTO and every
// app reads FROM. Keep this the single source of truth.

/** The 15 signal dimensions. Order matters: it is the vector layout. */
export const DIMENSIONS = [
  { key: 'gpa', label: 'GPA', domain: 'Academic', desc: 'Grade point average (normalized 0-4.0)' },
  { key: 'attendance', label: 'Attendance', domain: 'Academic', desc: 'Percentage of school days present' },
  { key: 'testScore', label: 'Test Scores', domain: 'Academic', desc: 'Standardized assessment percentile' },
  { key: 'courseRigor', label: 'Course Rigor', domain: 'Academic', desc: 'Proportion of advanced/honors courses' },
  { key: 'assignCompletion', label: 'Assignment Completion', domain: 'Academic', desc: 'Percentage of assignments submitted' },
  { key: 'discipline', label: 'Discipline', domain: 'Behavioral', desc: 'Behavioral record (1=clean, 0=many incidents)' },
  { key: 'extracurricular', label: 'Extracurricular', domain: 'Behavioral', desc: 'Number of activities (normalized)' },
  { key: 'selScore', label: 'SEL Score', domain: 'Behavioral', desc: 'Social-emotional learning assessment' },
  { key: 'counselorVisits', label: 'Counselor Visits', domain: 'Wellness', desc: 'Frequency of counselor contact (1=few, 0=many)' },
  { key: 'trajectory', label: 'Grade Trajectory', domain: 'Wellness', desc: 'GPA trend (1=improving, 0=declining)' },
  { key: 'socioeconomic', label: 'Socioeconomic', domain: 'Environment', desc: 'Economic advantage level' },
  { key: 'homeStability', label: 'Home Stability', domain: 'Environment', desc: 'Residential stability (fewer moves = higher)' },
  { key: 'ellStatus', label: 'English Proficiency', domain: 'Environment', desc: 'English language level (1=native, 0=newcomer)' },
  { key: 'specialEd', label: 'Special Services', domain: 'Environment', desc: 'Special education service level (1=none, 0=full IEP)' },
  { key: 'peerConnected', label: 'Peer Connections', domain: 'Environment', desc: 'Social integration and friendship network' },
];
export const DIM_KEYS = DIMENSIONS.map((d) => d.key);

export const ENTITY_TYPES = ['student', 'staff', 'family', 'school', 'course', 'section'];

/** Fragment kinds: who said it and what it is. */
export const FRAGMENT_KINDS = [
  'record',      // derived from an imported structured record
  'observation', // written by staff
  'self',        // written by the student about themselves
  'family',      // written by a parent/guardian
  'artifact',    // a piece of work (essay, project) with a text description
  'photo',       // an image with caption, uploaded by family or student
  'note',        // free-form
];

/**
 * Who may see a fragment. Enforced server-side on every read.
 *   private  the student alone (their own journal)
 *   family   the student and their family
 *   school   student, family, staff, admin  (default: the shared record)
 *   staff    staff and admin only (internal notes)
 */
export const VISIBILITY = ['private', 'family', 'school', 'staff'];
export const ROLE_VISIBILITY = {
  admin: ['school', 'staff'],
  staff: ['school', 'staff'],
  family: ['family', 'school'],
  student: ['private', 'family', 'school'],
};

export const ROLES = ['admin', 'staff', 'student', 'family', 'app'];

/** Fields that are direct identifiers. Never sent to a model provider. */
export const PII_FIELDS = ['firstName', 'lastName', 'preferredName', 'dob', 'email', 'phone', 'address', 'externalIds', 'guardians', 'photoPath'];

/** Raw structured metrics a student record may carry (units in comments). */
export const STUDENT_METRICS = {
  gpa: 'number 0-4',
  attendancePct: 'number 0-100',
  testPercentile: 'number 0-100',
  courseRigor: 'number 0-1',
  assignCompletionPct: 'number 0-100',
  disciplineIncidents: 'integer >= 0',
  extracurricularCount: 'integer >= 0',
  selScore: 'number 0-1',
  counselorVisits: 'integer >= 0',
  trajectory: 'number -1..1 (GPA delta trend)',
  ses: 'number 0-1',
  homeStability: 'number 0-1',
  ellLevel: 'None|Advanced|Intermediate|Beginner|Newcomer',
  specialEd: 'None|504|IEP-partial|IEP-full',
  peerConnected: 'number 0-1',
};

const isStr = (v) => typeof v === 'string';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Validate + normalize an entity at the boundary. Throws on bad input. */
export function validateEntity(e) {
  if (!e || typeof e !== 'object') throw new Error('entity must be an object');
  if (!ENTITY_TYPES.includes(e.type)) throw new Error(`unknown entity type: ${e.type}`);
  if (!isStr(e.id) || !/^[A-Za-z0-9_.:-]{1,64}$/.test(e.id)) throw new Error('entity id must be 1-64 chars [A-Za-z0-9_.:-]');
  const out = { ...e };
  if (e.type === 'student') {
    if (out.grade != null) {
      const g = typeof out.grade === 'string' ? gradeFromString(out.grade) : out.grade;
      if (!Number.isInteger(g) || g < -1 || g > 13) throw new Error(`bad grade: ${e.grade}`);
      out.grade = g;
    }
    out.metrics = normalizeMetrics(out.metrics || {});
  }
  if (e.type === 'family') {
    out.students = [...new Set((out.students || []).map(String))];
    out.members = (out.members || []).map((m) => ({ name: String(m.name || '').slice(0, 120), relation: String(m.relation || '').slice(0, 40), email: m.email ? String(m.email).slice(0, 200) : undefined, phone: m.phone ? String(m.phone).slice(0, 40) : undefined, language: m.language ? String(m.language).slice(0, 40) : undefined }));
  }
  for (const k of ['firstName', 'lastName', 'preferredName', 'schoolId', 'email']) {
    if (out[k] != null && !isStr(out[k])) throw new Error(`${k} must be a string`);
    if (isStr(out[k])) out[k] = out[k].trim().slice(0, 200);
  }
  return out;
}

export function gradeFromString(s) {
  const t = String(s).trim().toUpperCase();
  if (t === 'K' || t === 'KG' || t === 'KINDERGARTEN') return 0;
  if (t === 'PK' || t === 'TK' || t === 'PRE-K' || t === 'PREK') return -1;
  const n = parseInt(t.replace(/^0+(?=\d)/, ''), 10);
  return Number.isFinite(n) ? n : NaN;
}

export function normalizeMetrics(m) {
  const out = {};
  for (const [k, spec] of Object.entries(STUDENT_METRICS)) {
    if (m[k] == null || m[k] === '') continue;
    if (spec.startsWith('number') || spec.startsWith('integer')) {
      const n = Number(m[k]);
      if (!isNum(n)) continue;
      out[k] = n;
    } else out[k] = String(m[k]);
  }
  return out;
}

export function validateFragment(f) {
  if (!f || typeof f !== 'object') throw new Error('fragment must be an object');
  if (!isStr(f.entityId)) throw new Error('fragment.entityId required');
  if (!FRAGMENT_KINDS.includes(f.kind)) throw new Error(`unknown fragment kind: ${f.kind}`);
  if (!isStr(f.text) || !f.text.trim()) throw new Error('fragment.text required');
  if (f.text.length > 20000) throw new Error('fragment.text too long (20k max)');
  const visibility = f.visibility || 'school';
  if (!VISIBILITY.includes(visibility)) throw new Error(`bad visibility: ${f.visibility}`);
  return { ...f, text: f.text.trim(), visibility };
}

/** Strip direct identifiers (used before anything is shown to a model provider). */
export function redact(entity) {
  const out = {};
  for (const [k, v] of Object.entries(entity)) if (!PII_FIELDS.includes(k)) out[k] = v;
  return out;
}
