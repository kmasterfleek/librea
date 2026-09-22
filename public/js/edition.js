// The active edition, in the browser: vocabulary, theme, feature flags, copy.
// Every page asks `t()` for its words, so one JSON file renames the whole app.
import { api } from '/app.js';

/** Mirrors src/core/edition.js BASE_EDITION. Used until /api/edition answers. */
export const BASE_EDITION = {
  id: 'district',
  name: 'Librea',
  tagline: 'The student information system you own.',
  audience: 'Public school districts',
  vocabulary: { district: 'district', school: 'school', student: 'student', family: 'family', staff: 'staff', teacher: 'teacher', class: 'class', grade: 'grade', principal: 'principal' },
  roles: ['admin', 'staff', 'student', 'family'],
  features: { import: true, vibe: true, sql: true, compliance: true, onboarding: true, timeline: true, invites: true },
  compliance: { packs: ['core'] },
  onboarding: { mode: 'import-or-manual', steps: ['organization', 'people', 'families', 'compliance', 'apps'] },
  theme: { accent: '#a2552b', accent2: '#2f6f6a', logoText: 'Librea' },
  copy: {},
};

let current = BASE_EDITION;
let copyIndex = {};
let pairs = [];

export const edition = () => current;
export const feature = (name) => current.features?.[name] !== false;

/** Fetch the edition once at boot. Falls back to the base words on any failure. */
export async function loadEdition() {
  let raw = null;
  try { raw = await api('/api/edition'); } catch { /* base edition it is */ }
  current = merge(raw);
  copyIndex = indexCopy(current.copy);
  pairs = vocabPairs(current.vocabulary);
  applyTheme(current.theme);
  return current;
}

function merge(raw) {
  if (!raw || typeof raw !== 'object') return BASE_EDITION;
  const B = BASE_EDITION;
  return {
    ...B, ...raw,
    vocabulary: { ...B.vocabulary, ...(raw.vocabulary || {}) },
    features: { ...B.features, ...(raw.features || {}) },
    compliance: { ...B.compliance, ...(raw.compliance || {}) },
    onboarding: { ...B.onboarding, ...(raw.onboarding || {}) },
    theme: { ...B.theme, ...(raw.theme || {}) },
    copy: { ...B.copy, ...(raw.copy || {}) },
  };
}

// ---------- theme ----------

function applyTheme(theme = {}) {
  const root = document.documentElement;
  if (theme.accent) {
    root.style.setProperty('--accent', theme.accent);
    root.style.setProperty('--accent-soft', `color-mix(in srgb, ${theme.accent} 18%, var(--paper))`);
  }
  if (theme.accent2) root.style.setProperty('--accent2', theme.accent2);
  const word = document.querySelector('.wordmark');
  if (word) word.textContent = theme.logoText || current.name;
  document.title = current.name || 'Librea';
  const foot = document.querySelector('#foot p');
  if (foot) {
    foot.textContent = copyIndex[norm('footer')]
      || t('Librea runs on this machine. Nothing leaves the building unless you send it.').replace(/^Librea\b/, current.name);
  }
}

// ---------- copy ----------

const norm = (k) => String(k).toLowerCase().replace(/[^a-z0-9]/g, '');

function indexCopy(copy) {
  const out = {};
  for (const [k, v] of Object.entries(copy || {})) out[norm(k)] = v;
  return out;
}

/** copy('home_headline', 'homeHeadline') — first key that the edition defines. */
export function copy(...keys) {
  for (const k of keys) { const v = copyIndex[norm(k)]; if (v != null && v !== '') return String(v); }
  return null;
}

/**
 * The edition's own sentence if it wrote one, otherwise the base sentence with
 * the vocabulary swapped in. Edition copy is already in its own words, so it is
 * never run through `t()`.
 */
export const say = (keys, fallback) => copy(...[].concat(keys)) ?? t(fallback);

/** Fill {placeholders} in an edition copy string. */
export const fill = (text, vars) => String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));

// ---------- vocabulary ----------

const IRREGULAR = { family: 'families', class: 'classes', child: 'children', person: 'people', staff: 'staff' };

function plural(w) {
  const lower = w.toLowerCase();
  if (IRREGULAR[lower]) return IRREGULAR[lower];
  if (lower.endsWith('s')) return w; // already plural ("guides", "staff" stays put)
  if (/[^aeiou]y$/.test(lower)) return w.slice(0, -1) + 'ies';
  if (/(x|z|ch|sh)$/.test(lower)) return w + 'es';
  return w + 's';
}

/** [{ re, one, many }] for every word the edition actually renames, longest first. */
function vocabPairs(vocab) {
  return Object.entries(vocab || {})
    .filter(([base, to]) => to && base.toLowerCase() !== String(to).toLowerCase())
    .sort((a, b) => b[0].length - a[0].length)
    .map(([base, to]) => ({
      re: new RegExp(`\\b(${base}|${plural(base)})\\b`, 'gi'),
      one: String(to),
      many: plural(String(to)),
      basePlural: plural(base).toLowerCase(),
    }));
}

const recase = (sample, word) => {
  if (sample === sample.toUpperCase() && sample.length > 1) return word.toUpperCase();
  if (sample[0] === sample[0].toUpperCase()) return word[0].toUpperCase() + word.slice(1);
  return word;
};

/**
 * Swap the edition's vocabulary into a sentence, preserving case and number.
 * Only for UI chrome — never run it over user data or fragment text.
 */
export function t(text) {
  if (text == null) return text;
  let out = String(text);
  for (const p of pairs) {
    out = out.replace(p.re, (m) => recase(m, m.toLowerCase() === p.basePlural ? p.many : p.one));
  }
  return out;
}

/** The edition's word for one base term: word('student') -> 'learner'. */
export const word = (base, many = false) => {
  const v = current.vocabulary?.[base] || base;
  return many ? plural(v) : v;
};
/** Capitalized: Word('student') -> 'Learner'. */
export const Word = (base, many = false) => { const w = word(base, many); return w[0].toUpperCase() + w.slice(1); };
