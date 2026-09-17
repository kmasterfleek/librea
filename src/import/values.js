// Coercion at the boundary. Vendor CSVs carry the same fact a dozen ways
// ("Y", "LEP", "3", "Intermediate"); everything funnels into the canonical
// units declared in src/core/schema.js. A value we cannot read returns
// undefined rather than throwing, so one odd cell never kills a batch.

const s = (v) => String(v ?? '').trim();
const low = (v) => s(v).toLowerCase();
const KEY = (v) => low(v).replace(/[^a-z0-9]+/g, '');

export const TRUTHY = new Set(['y', 'yes', 't', 'true', '1', 'active', 'enrolled', 'x']);
export const FALSY = new Set(['n', 'no', 'f', 'false', '0', 'none', 'inactive', 'na', 'n/a', '']);

export function toBool(v) {
  const k = low(v);
  if (TRUTHY.has(k)) return true;
  if (FALSY.has(k)) return false;
  return undefined;
}

/** Strip %, $, commas and spaces; return a finite number or undefined. */
export function toNumber(v) {
  const t = s(v).replace(/[%$,\s]/g, '');
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

export function toInt(v) {
  const n = toNumber(v);
  return n === undefined ? undefined : Math.max(0, Math.round(n));
}

/** A 0-100 percentage. Accepts 0.93, 93, "93%", "93.2". */
export function toPercent(v) {
  let n = toNumber(v);
  if (n === undefined) return undefined;
  if (n > 0 && n <= 1 && /\./.test(s(v))) n *= 100;
  return Math.min(100, Math.max(0, n));
}

/** A 0-1 ratio. Accepts 0.8, 80, "80%". */
export function toRatio(v) {
  let n = toNumber(v);
  if (n === undefined) return undefined;
  if (n > 1) n /= 100;
  return Math.min(1, Math.max(0, n));
}

const LETTER_GPA = { 'a+': 4, a: 4, 'a-': 3.7, 'b+': 3.3, b: 3, 'b-': 2.7, 'c+': 2.3, c: 2, 'c-': 1.7, 'd+': 1.3, d: 1, 'd-': 0.7, f: 0, e: 0, i: undefined, p: undefined };

export function letterToGpa(v) {
  const k = low(v).replace(/\s+/g, '');
  if (!k) return undefined;
  return Object.prototype.hasOwnProperty.call(LETTER_GPA, k) ? LETTER_GPA[k] : undefined;
}

/** Any grade expression -> 0..4 GPA points. Handles letters, %, weighted. */
export function toGpa(v) {
  const letter = letterToGpa(v);
  if (letter !== undefined) return letter;
  const n = toNumber(v);
  if (n === undefined) return undefined;
  if (n <= 5) return Math.min(4, Math.max(0, n));      // 0-4 (or weighted 5.0)
  if (n <= 100) return Math.min(4, Math.max(0, (n - 50) / 12.5)); // percent scale
  return undefined;
}

const ELL_MAP = {
  none: 'None', no: 'None', n: 'None', eo: 'None', englishonly: 'None', rfep: 'None', ifep: 'None',
  fluent: 'None', fluentenglishproficient: 'None', exited: 'None', monitored: 'None', native: 'None',
  e: 'None', r: 'None', f: 'None', notell: 'None', notel: 'None', '0': 'None',
  advanced: 'Advanced', earlyadvanced: 'Advanced', bridging: 'Advanced', proficient: 'Advanced', level4: 'Advanced', '4': 'Advanced',
  intermediate: 'Intermediate', earlyintermediate: 'Intermediate', developing: 'Intermediate', expanding: 'Intermediate',
  level3: 'Intermediate', '3': 'Intermediate', y: 'Intermediate', yes: 'Intermediate', lep: 'Intermediate',
  ell: 'Intermediate', el: 'Intermediate', l: 'Intermediate', esl: 'Intermediate', '1': 'Intermediate',
  beginner: 'Beginner', beginning: 'Beginner', emerging: 'Beginner', entering: 'Beginner', level2: 'Beginner', '2': 'Beginner',
  newcomer: 'Newcomer', new: 'Newcomer', level1: 'Newcomer', preemergent: 'Newcomer', nonenglish: 'Newcomer',
};

/** -> None | Advanced | Intermediate | Beginner | Newcomer */
export function toEllLevel(v) {
  const k = KEY(v);
  if (!k) return undefined;
  if (ELL_MAP[k]) return ELL_MAP[k];
  for (const [needle, out] of [['newcomer', 'Newcomer'], ['begin', 'Beginner'], ['emerg', 'Beginner'],
    ['interm', 'Intermediate'], ['expand', 'Intermediate'], ['advanc', 'Advanced'], ['bridg', 'Advanced'],
    ['fluent', 'None'], ['englishonly', 'None'], ['rfep', 'None']]) if (k.includes(needle)) return out;
  return undefined;
}

const SPED_MAP = {
  none: 'None', no: 'None', n: 'None', '0': 'None', notsped: 'None', regular: 'None', general: 'None',
  '504': '504', section504: '504', '504plan': '504', plan504: '504',
  ieppartial: 'IEP-partial', partial: 'IEP-partial', rsp: 'IEP-partial', resource: 'IEP-partial',
  r: 'IEP-partial', y: 'IEP-partial', yes: 'IEP-partial', iep: 'IEP-partial', sped: 'IEP-partial',
  specialed: 'IEP-partial', specialeducation: 'IEP-partial', '1': 'IEP-partial', dis: 'IEP-partial', speech: 'IEP-partial',
  iepfull: 'IEP-full', full: 'IEP-full', sdc: 'IEP-full', s: 'IEP-full', specialdayclass: 'IEP-full',
  selfcontained: 'IEP-full', fullinclusion: 'IEP-full', nps: 'IEP-full',
};

/** -> None | 504 | IEP-partial | IEP-full */
export function toSpecialEd(v) {
  const k = KEY(v);
  if (!k) return undefined;
  if (SPED_MAP[k]) return SPED_MAP[k];
  if (k.includes('504')) return '504';
  if (k.includes('selfcontain') || k.includes('sdc') || k.includes('fullday')) return 'IEP-full';
  if (k.includes('iep') || k.includes('sped') || k.includes('special')) return 'IEP-partial';
  return undefined;
}

/** -> free | reduced | paid | undefined */
export function toFrl(v) {
  const k = KEY(v);
  if (!k) return undefined;
  if (k === 'f' || k.includes('free')) return 'free';
  if (k === 'r' || k.includes('reduc')) return 'reduced';
  if (k === 'p' || k.includes('paid') || k === 'full' || k.includes('fullprice') || k === 'n' || k === 'none') return 'paid';
  if (TRUTHY.has(k)) return 'free';
  return undefined;
}
/** FRL is the proxy districts already have for economic need. */
export const FRL_SES = { free: 0.2, reduced: 0.4, paid: 0.75 };

/** -1..1 trend. Accepts numbers or words. */
export function toTrajectory(v) {
  const k = KEY(v);
  if (!k) return undefined;
  if (k.includes('improv') || k.includes('up') || k.includes('rising')) return 0.5;
  if (k.includes('declin') || k.includes('down') || k.includes('falling')) return -0.5;
  if (k.includes('flat') || k.includes('steady') || k.includes('stable')) return 0;
  const n = toNumber(v);
  if (n === undefined) return undefined;
  return Math.min(1, Math.max(-1, n));
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** -> YYYY-MM-DD, or the trimmed original when it cannot be parsed. */
export function toDate(v) {
  const t = s(v);
  if (!t) return undefined;
  let m = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return iso(m[1], m[2], m[3]);
  m = t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (m) {
    let y = Number(m[3]);
    if (y < 100) y += y > 30 ? 1900 : 2000;
    return iso(String(y), m[1], m[2]);
  }
  m = t.match(/^(\d{1,2})[-\s]([A-Za-z]{3,})[-\s](\d{2,4})$/);
  if (m) {
    const mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    let y = Number(m[3]);
    if (y < 100) y += y > 30 ? 1900 : 2000;
    if (mi >= 0) return iso(String(y), String(mi + 1), m[1]);
  }
  return t;
}
const iso = (y, m, d) => `${y}-${String(Number(m)).padStart(2, '0')}-${String(Number(d)).padStart(2, '0')}`;

const ABSENT = ['a', 'abs', 'absent', 'u', 'unexcused', 'e', 'excused', 'ill', 'sick', 'susp', 'suspended', 'truant', 't'];
const PRESENT = ['p', 'present', 'here', 'in', 'ok', 'attended', 'tardy', 'l', 'late', 'y'];

/** An attendance code -> true (present) / false (absent) / undefined. */
export function toPresence(v) {
  const k = KEY(v);
  if (!k) return undefined;
  if (PRESENT.includes(k)) return true;
  if (ABSENT.includes(k)) return false;
  if (k.includes('absent') || k.includes('unexcused')) return false;
  if (k.includes('present') || k.includes('tardy')) return true;
  const b = toBool(v);
  return b;
}

const ATT_CODES = [
  [['p', 'present', 'here', 'in', 'ok', 'attended', 'y', 'yes', 'a1', 'full'], 'present'],
  [['t', 'tardy', 'late', 'l', 'tdy', 'partial'], 'tardy'],
  [['e', 'excused', 'ea', 'excusedabsence', 'ill', 'sick', 'medical', 'bereavement'], 'excused'],
  [['r', 'remote', 'virtual', 'online', 'distance', 'independentstudy', 'is'], 'remote'],
  [['a', 'absent', 'u', 'unexcused', 'ua', 'truant', 'susp', 'suspended', 'n', 'no', 'abs'], 'absent'],
];

/** An attendance code -> present | absent | tardy | excused | remote. */
export function toAttendanceCode(v) {
  const k = KEY(v);
  if (!k) return undefined;
  for (const [codes, out] of ATT_CODES) if (codes.includes(k)) return out;
  for (const [, out] of ATT_CODES) if (k.includes(out)) return out;
  if (k.includes('unexcus') || k.includes('truan') || k.includes('suspend')) return 'absent';
  if (k.includes('excus')) return 'excused';
  if (k.includes('virtual') || k.includes('online')) return 'remote';
  return undefined;
}

/**
 * A fact-table primary key built from its parts. Fact keys allow 128 chars,
 * which is roomier than an entity id, but each part is still clamped so one
 * long assignment title cannot crowd out the student and date that follow it.
 */
export function factId(...parts) {
  const clean = parts
    .filter((p) => p != null && String(p).trim() !== '')
    .map((p) => String(p).trim().replace(/[^A-Za-z0-9_.:-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40))
    .filter(Boolean);
  return clean.join('-').slice(0, 128) || 'row';
}

/** 'Riverside Elementary' -> 'RIVERSIDE-ELEMENTARY' (safe for an entity id). */
export function slug(name) {
  return s(name).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'UNKNOWN';
}

/** Entity ids must match /^[A-Za-z0-9_.:-]{1,64}$/. */
export function safeId(prefix, raw) {
  const clean = s(raw).replace(/[^A-Za-z0-9_.:-]+/g, '-').replace(/^-+|-+$/g, '');
  return (prefix + (clean || 'UNKNOWN')).slice(0, 64);
}

export const ordinal = (n) => {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
};
