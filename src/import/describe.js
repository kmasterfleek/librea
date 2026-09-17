// A structured record, said out loud.
//
// Stored as a 'record' fragment so semantic search can find a student by their
// situation ("newcomer who is missing a lot of school") rather than by a
// column name. The name is deliberately left out: the paragraph describes a
// circumstance, and the record it hangs on already says who it belongs to.
import { ordinal } from './values.js';

const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const count = (n) => (n >= 0 && n <= 10 ? COUNT_WORDS[n] : String(n));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function gradeLabel(grade) {
  if (grade == null || !Number.isFinite(grade)) return null;
  if (grade === -1) return 'Pre-K student';
  if (grade === 0) return 'Kindergartner';
  if (grade >= 13) return 'Post-secondary student';
  return `${ordinal(grade)} grader`;
}

const ELL_PHRASE = {
  Newcomer: 'English proficiency: newcomer.',
  Beginner: 'English proficiency: beginning.',
  Intermediate: 'English proficiency: intermediate.',
  Advanced: 'English proficiency: advanced.',
  None: 'Fully English proficient.',
};
const SPED_PHRASE = {
  '504': 'Receives 504 accommodations.',
  'IEP-partial': 'Has an IEP with partial services.',
  'IEP-full': 'Has a full-time IEP.',
};
const FLAG_PHRASE = {
  chronicAbsent: 'Chronically absent.',
  highDiscipline: 'Repeated discipline referrals.',
  decliningGrades: 'Grades are sliding.',
  resilient: 'Doing well against real headwinds at home.',
  hiddenRisk: 'Grades look fine, but the wellness signals are slipping.',
};

function trendWord(t) {
  if (t == null) return null;
  if (t > 0.15) return 'trending up';
  if (t < -0.15) return 'trending down';
  return 'trending flat';
}

/**
 * A short plain-English paragraph about a student record, with no name in it.
 * `opts.schoolName` fills in the school when the caller can resolve it.
 */
export function describeStudent(entity, opts = {}) {
  if (!entity || entity.type !== 'student') return '';
  const m = entity.metrics || {};
  const parts = [];

  const who = gradeLabel(entity.grade);
  const school = opts.schoolName || entity.schoolName || null;
  if (who && school) parts.push(`${who} at ${school}.`);
  else if (who) parts.push(`${who}.`);
  else if (school) parts.push(`Enrolled at ${school}.`);

  if (m.attendancePct != null) parts.push(`Attendance ${Math.round(m.attendancePct)}%.`);
  if (m.gpa != null) {
    const trend = trendWord(m.trajectory);
    parts.push(trend ? `GPA ${m.gpa.toFixed(1)}, ${trend}.` : `GPA ${m.gpa.toFixed(1)}.`);
  } else if (m.trajectory != null) {
    parts.push(`Grades ${trendWord(m.trajectory)}.`);
  }
  if (m.testPercentile != null) parts.push(`Test scores in the ${ordinal(Math.round(m.testPercentile))} percentile.`);
  if (m.assignCompletionPct != null && m.assignCompletionPct < 80) parts.push(`Turns in ${Math.round(m.assignCompletionPct)}% of assignments.`);
  if (m.courseRigor != null && m.courseRigor >= 0.3) parts.push(`Takes a demanding course load.`);

  if (m.extracurricularCount != null) {
    const n = m.extracurricularCount;
    parts.push(n === 0 ? 'No extracurriculars on record.' : `${cap(count(n))} extracurricular${n === 1 ? '' : 's'}.`);
  }
  if (m.disciplineIncidents) parts.push(`${cap(count(m.disciplineIncidents))} discipline incident${m.disciplineIncidents === 1 ? '' : 's'} on record.`);
  if (m.counselorVisits != null && m.counselorVisits >= 5) parts.push(`Sees a counselor often (${m.counselorVisits} visits).`);
  if (m.selScore != null && m.selScore < 0.4) parts.push('Social-emotional check-ins are low.');
  if (m.peerConnected != null && m.peerConnected < 0.3) parts.push('Few peer connections.');

  if (m.ellLevel && ELL_PHRASE[m.ellLevel]) parts.push(ELL_PHRASE[m.ellLevel]);
  if (m.specialEd && SPED_PHRASE[m.specialEd]) parts.push(SPED_PHRASE[m.specialEd]);
  if (entity.frl === 'free') parts.push('Qualifies for free lunch.');
  else if (entity.frl === 'reduced') parts.push('Qualifies for reduced-price lunch.');
  if (m.homeStability != null && m.homeStability < 0.4) parts.push('Housing has been unstable.');

  for (const f of entity.flags || []) if (FLAG_PHRASE[f.key]) parts.push(FLAG_PHRASE[f.key]);

  if (!parts.length) return 'Imported record with no readable details yet.';
  return parts.join(' ');
}
