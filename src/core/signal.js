// The 15-dimension "signal vector": a normalized view of a student's structured
// record. Every dimension is 0..1 where 1 is the favorable end, so vectors are
// directly comparable and a radar chart reads intuitively.
import { DIM_KEYS } from './schema.js';

const clamp01 = (x) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : null);

const ELL = { None: 1, Advanced: 0.75, Intermediate: 0.5, Beginner: 0.25, Newcomer: 0 };
const SPED = { None: 1, '504': 0.66, 'IEP-partial': 0.33, 'IEP-full': 0 };

/** Map raw metrics -> 15 normalized dims. Missing values become null. */
export function dimsFromMetrics(m = {}) {
  return {
    gpa: m.gpa != null ? clamp01(m.gpa / 4) : null,
    attendance: m.attendancePct != null ? clamp01(m.attendancePct / 100) : null,
    testScore: m.testPercentile != null ? clamp01(m.testPercentile / 100) : null,
    courseRigor: m.courseRigor != null ? clamp01(m.courseRigor) : null,
    assignCompletion: m.assignCompletionPct != null ? clamp01(m.assignCompletionPct / 100) : null,
    discipline: m.disciplineIncidents != null ? clamp01(1 - m.disciplineIncidents / 10) : null,
    extracurricular: m.extracurricularCount != null ? clamp01(m.extracurricularCount / 5) : null,
    selScore: m.selScore != null ? clamp01(m.selScore) : null,
    counselorVisits: m.counselorVisits != null ? clamp01(1 - m.counselorVisits / 15) : null,
    trajectory: m.trajectory != null ? clamp01((m.trajectory + 1) / 2) : null,
    socioeconomic: m.ses != null ? clamp01(m.ses) : null,
    homeStability: m.homeStability != null ? clamp01(m.homeStability) : null,
    ellStatus: m.ellLevel != null ? (ELL[m.ellLevel] ?? null) : null,
    specialEd: m.specialEd != null ? (SPED[m.specialEd] ?? null) : null,
    peerConnected: m.peerConnected != null ? clamp01(m.peerConnected) : null,
  };
}

/** Dims object -> ordered array, nulls filled with 0.5 (neutral). */
export function signalVector(dims) {
  return DIM_KEYS.map((k) => (dims[k] == null ? 0.5 : dims[k]));
}

export function coverage(dims) {
  return DIM_KEYS.filter((k) => dims[k] != null).length / DIM_KEYS.length;
}

export function cosine(a, b) {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? d / Math.sqrt(na * nb) : 0;
}

export function euclidean(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

/**
 * Pattern flags. These are heuristics, surfaced as *questions for a human*,
 * never as verdicts. Each flag has a plain-language reason.
 */
export function flags(dims) {
  const out = [];
  const d = dims;
  const has = (...ks) => ks.every((k) => d[k] != null);
  if (has('attendance') && d.attendance < 0.9) out.push({ key: 'chronicAbsent', reason: 'Attendance below 90%' });
  if (has('discipline') && d.discipline < 0.6) out.push({ key: 'highDiscipline', reason: 'Four or more discipline incidents' });
  if (has('trajectory') && d.trajectory < 0.35) out.push({ key: 'decliningGrades', reason: 'GPA trend is negative' });
  if (has('gpa', 'socioeconomic', 'homeStability') && d.gpa >= 0.7 && (d.socioeconomic < 0.3 || d.homeStability < 0.4))
    out.push({ key: 'resilient', reason: 'Strong grades despite environmental headwinds' });
  if (has('gpa', 'selScore', 'peerConnected', 'trajectory') && d.gpa >= 0.6 && (d.selScore < 0.4 || d.peerConnected < 0.3) && d.trajectory < 0.45)
    out.push({ key: 'hiddenRisk', reason: 'Grades look fine, but wellness signals and trend are slipping' });
  return out;
}

/**
 * Risk score on raw metrics, same formula as the student-vectors district
 * generator so labels line up with that dataset. Higher = more risk.
 */
export function riskScore(m = {}) {
  const att = m.attendancePct != null ? m.attendancePct / 100 : 0.9;
  const gpa = m.gpa ?? 2.5;
  const disc = m.disciplineIncidents ?? 0;
  const asg = m.assignCompletionPct != null ? m.assignCompletionPct / 100 : 0.75;
  const traj = m.trajectory ?? 0;
  const home = m.homeStability ?? 0.7;
  const cv = m.counselorVisits ?? 2;
  return +((1 - att) * 3 + ((4 - gpa) / 4) * 2 + disc * 0.3 + (1 - asg) * 2 + (traj < -0.2 ? 1 : 0) + (1 - home) * 0.5 + (cv > 5 ? 0.5 : 0)).toFixed(3);
}

const ACADEMIC = ['gpa', 'attendance', 'assignCompletion', 'testScore'];

function classify(xs) {
  if (xs.length < 4) return 'flat';
  const first = xs[0], last = xs[xs.length - 1];
  const minI = xs.indexOf(Math.min(...xs));
  const min = xs[minI];
  if (minI > 0 && minI < xs.length - 1 && first - min >= 0.06 && last - min >= 0.1) return 'turnaround';
  if (last - first >= 0.1) return 'climb';
  if (first - last >= 0.1) return 'slide';
  return 'flat';
}

/**
 * Read the arc of a timeline (oldest first) on the academic composite:
 * 'turnaround' (dip then recovery), 'climb', 'slide', or 'flat'.
 */
export function detectArc(timeline) {
  const xs = (timeline || []).map((t) => {
    const vals = ACADEMIC.map((k) => t.dims?.[k]).filter((v) => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }).filter((v) => v != null);
  return classify(xs);
}

/** Per-dimension arcs and the biggest movers over the timeline. */
export function arcs(timeline) {
  const out = {};
  for (const k of DIM_KEYS) {
    const xs = (timeline || []).map((t) => t.dims?.[k]).filter((v) => v != null);
    if (xs.length < 2) continue;
    out[k] = { arc: classify(xs), delta: +(xs[xs.length - 1] - xs[0]).toFixed(3) };
  }
  const movers = Object.entries(out).sort((a, b) => Math.abs(b[1].delta) - Math.abs(a[1].delta)).slice(0, 3).map(([key, v]) => ({ key, ...v }));
  return { dims: out, movers };
}

export function outcomeLabel(dims, fl = flags(dims), metrics = null, timeline = null) {
  const keys = new Set(fl.map((f) => f.key));
  if (keys.has('hiddenRisk')) return 'hidden-risk';
  const score = metrics ? riskScore(metrics) : null;
  let label;
  if (score != null) label = score > 5 ? 'high-risk' : score > 3 ? 'watch' : keys.has('resilient') ? 'resilient' : 'on-track';
  else {
    const risk = ['chronicAbsent', 'highDiscipline', 'decliningGrades'].filter((k) => keys.has(k)).length;
    label = risk >= 2 ? 'high-risk' : risk === 1 ? 'watch' : keys.has('resilient') ? 'resilient' : 'on-track';
  }
  if (detectArc(timeline) === 'turnaround') return 'intervention-success';
  return label;
}
