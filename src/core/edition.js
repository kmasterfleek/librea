// Editions: one codebase, several flavors. An edition is a folder under
// editions/<name>/ with an edition.json that sets branding, vocabulary,
// enabled features, compliance packs, onboarding steps, and where its seed
// and app templates live. Selected by LIBREA_EDITION (default: 'district').
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

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
  theme: { accent: '#3d6b8e', accent2: '#c97b4a', logoText: 'Librea' },
  seed: 'data/seed/district.json',
  templates: null,
  copy: {},
};

let cached = null;

export function editionId() { return String(process.env.LIBREA_EDITION || 'district').trim().toLowerCase().replace(/[^a-z0-9-]/g, ''); }

/** Load the active edition, merged over BASE_EDITION. Missing folder -> base. */
export function loadEdition(id = editionId()) {
  if (cached && cached.id === id) return cached;
  let overrides = {};
  const file = path.join(ROOT, 'editions', id, 'edition.json');
  if (id !== 'district' && fs.existsSync(file)) overrides = JSON.parse(fs.readFileSync(file, 'utf8'));
  cached = {
    ...BASE_EDITION, ...overrides, id,
    vocabulary: { ...BASE_EDITION.vocabulary, ...(overrides.vocabulary || {}) },
    features: { ...BASE_EDITION.features, ...(overrides.features || {}) },
    compliance: { ...BASE_EDITION.compliance, ...(overrides.compliance || {}) },
    onboarding: { ...BASE_EDITION.onboarding, ...(overrides.onboarding || {}) },
    theme: { ...BASE_EDITION.theme, ...(overrides.theme || {}) },
    copy: { ...BASE_EDITION.copy, ...(overrides.copy || {}) },
    dir: path.join(ROOT, 'editions', id),
  };
  return cached;
}

export function listEditions() {
  const dir = path.join(ROOT, 'editions');
  const ids = fs.existsSync(dir) ? fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, 'edition.json'))) : [];
  return ['district', ...ids.filter((d) => d !== 'district')].map((id) => { const e = loadEdition.call(null, id); cached = null; return { id: e.id, name: e.name, tagline: e.tagline, audience: e.audience }; });
}

/** Replace vocabulary words in a sentence ("district" -> "community"), preserving case. */
export function t(text, edition = loadEdition()) {
  let out = String(text);
  for (const [k, v] of Object.entries(edition.vocabulary)) {
    if (k === v) continue;
    out = out.replace(new RegExp(`\\b${k}(s?)\\b`, 'g'), (m, s) => v + s).replace(new RegExp(`\\b${k[0].toUpperCase() + k.slice(1)}(s?)\\b`, 'g'), (m, s) => v[0].toUpperCase() + v.slice(1) + s);
  }
  return out;
}
