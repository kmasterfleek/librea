// The design package: the contract between a frontier model that never sees
// the schema and a binder that never leaves the building.
//
// A design is ONE HTML document that carries a manifest in
//   <script id="librea-design" type="application/json">{ ... }</script>
// and marks each data region with data-slot="<id>". The manifest declares
// each slot's KIND from a small closed vocabulary. The document contains no
// other script: the binder (runtime-bind.js) is injected by the server and
// renders standard markup into each region, which the design's CSS styles.
//
// The only data in a package is the per-slot `sample`, used to preview an
// UNBOUND slot for its editor. A published app never renders samples.

export const DESIGN_VERSION = 1;

/** Closed slot vocabulary. Adding a kind is a versioned change to the contract. */
export const SLOT_KINDS = {
  stat: { doc: 'One number with a label. Rows: one row { value, label?, note? }.', fields: ['value', 'label', 'note'], maxRows: 1 },
  bar: { doc: 'A bar chart of categories. Rows: { label, value }, up to 50.', fields: ['label', 'value'], maxRows: 50 },
  line: { doc: 'A line over an ordered axis (dates, weeks, grades). Rows: { label, value }, up to 200.', fields: ['label', 'value'], maxRows: 200 },
  table: { doc: 'A table. The slot declares columns: [{ key, label }]; rows carry those keys. Up to 200 rows shown.', fields: null, maxRows: 200 },
  list: { doc: 'A list of items. Rows: { title, subtitle?, meta? }, up to 100.', fields: ['title', 'subtitle', 'meta'], maxRows: 100 },
  text: { doc: 'One or more paragraphs. Rows: { text }.', fields: ['text'], maxRows: 20 },
};
export const SLOT_KIND_NAMES = Object.keys(SLOT_KINDS);

/** Class names the binder emits, so a design can style them. Documented in the design prompt. */
export const BINDER_CLASSES = [
  'lb-stat', 'lb-stat-value', 'lb-stat-label', 'lb-stat-note',
  'lb-chart', 'lb-table', 'lb-list', 'lb-list-title', 'lb-list-sub', 'lb-list-meta', 'lb-text',
  'lb-empty', 'lb-error', 'lb-note', 'lb-sample', 'lb-sample-tag',
];

const SLOT_ID = /^[a-z][a-z0-9-]{1,39}$/;
const MAX_SLOTS = 24;
const MAX_SAMPLE = 12;
const MANIFEST_RE = /<script\b[^>]*\bid\s*=\s*["']librea-design["'][^>]*>([\s\S]*?)<\/script>/i;

export class DesignError extends Error { constructor(msg) { super(msg); this.status = 400; } }

const clean = (v, max) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, max));

/** Normalize one slot declaration. Throws DesignError on anything off-contract. */
export function normalizeSlot(raw, seen = new Set()) {
  if (!raw || typeof raw !== 'object') throw new DesignError('each slot must be an object');
  const id = clean(raw.id, 40);
  if (!SLOT_ID.test(id)) throw new DesignError(`slot id "${id}" must be lowercase letters, digits, dashes (2-40 chars)`);
  if (seen.has(id)) throw new DesignError(`duplicate slot id "${id}"`);
  seen.add(id);
  const kind = clean(raw.kind, 20);
  if (!SLOT_KINDS[kind]) throw new DesignError(`slot "${id}" has unknown kind "${kind}"; one of ${SLOT_KIND_NAMES.join(', ')}`);
  const slot = { id, kind, label: clean(raw.label, 120) || id, hint: clean(raw.hint, 400) };
  if (kind === 'table') {
    const cols = Array.isArray(raw.columns) ? raw.columns : [];
    slot.columns = cols.slice(0, 12).map((c) => {
      const key = clean(typeof c === 'string' ? c : c?.key, 40);
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(key)) throw new DesignError(`slot "${id}" has a bad column key "${key}"`);
      return { key, label: clean(typeof c === 'string' ? c : c?.label, 60) || key };
    });
    if (!slot.columns.length) throw new DesignError(`table slot "${id}" declares no columns`);
  }
  if (raw.empty != null) slot.empty = clean(raw.empty, 160);
  slot.sample = sampleRows(slot, raw.sample);
  return slot;
}

/** Samples are the only data a design may carry. Coerce them to the slot's shape. */
function sampleRows(slot, rows) {
  if (!Array.isArray(rows)) return [];
  const fields = slot.kind === 'table' ? slot.columns.map((c) => c.key) : SLOT_KINDS[slot.kind].fields;
  return rows.slice(0, MAX_SAMPLE).map((r) => {
    if (!r || typeof r !== 'object') return null;
    const out = {};
    for (const f of fields) if (r[f] != null) out[f] = typeof r[f] === 'number' ? r[f] : clean(r[f], 200);
    return Object.keys(out).length ? out : null;
  }).filter(Boolean);
}

/** Parse and validate the manifest inside a design document. */
export function parseDesign(html) {
  const m = MANIFEST_RE.exec(String(html || ''));
  if (!m) throw new DesignError('the design has no <script id="librea-design" type="application/json"> manifest');
  let raw;
  try { raw = JSON.parse(m[1]); } catch (e) { throw new DesignError('the design manifest is not valid JSON: ' + e.message); }
  if (!raw || typeof raw !== 'object') throw new DesignError('the design manifest must be an object');
  if (Number(raw.librea) !== DESIGN_VERSION) throw new DesignError(`the design manifest must declare "librea": ${DESIGN_VERSION}`);
  if (!Array.isArray(raw.slots) || !raw.slots.length) throw new DesignError('the design manifest declares no slots');
  if (raw.slots.length > MAX_SLOTS) throw new DesignError(`too many slots (max ${MAX_SLOTS})`);
  const seen = new Set();
  return { librea: DESIGN_VERSION, title: clean(raw.title, 120), slots: raw.slots.map((s) => normalizeSlot(s, seen)) };
}

/** Does every declared slot have a region, and is the document otherwise inert? */
export function auditDesign(html, manifest) {
  const problems = [];
  const doc = String(html || '');
  const scripts = [...doc.matchAll(/<script\b([^>]*)>/gi)].map((m) => m[1]);
  for (const attrs of scripts) {
    if (!/\bid\s*=\s*["']librea-design["']/i.test(attrs)) problems.push('The design contains a script other than its manifest. Designs carry markup and style only; the binder is added here.');
  }
  if (/\bon[a-z]+\s*=/i.test(doc.replace(MANIFEST_RE, ''))) problems.push('The design uses an inline event handler attribute. Designs are inert.');
  if (/javascript:/i.test(doc)) problems.push('The design uses a javascript: URL.');
  if (/<(iframe|object|embed|form)\b/i.test(doc)) problems.push('The design embeds a frame, object, or form. Not allowed in a static design.');
  if (/<link[^>]+href=["']https?:|@import\s+url\(|url\(\s*["']?https?:/i.test(doc)) problems.push('The design links an external stylesheet, font, or image. The sandbox blocks all of it.');
  if (/<img[^>]+src=["']https?:/i.test(doc)) problems.push('The design loads a remote image. The sandbox blocks it.');
  for (const s of manifest.slots) {
    const re = new RegExp(`data-slot\\s*=\\s*["']${s.id}["']`, 'i');
    if (!re.test(doc)) problems.push(`Slot "${s.id}" is declared but no element carries data-slot="${s.id}".`);
  }
  const regions = [...doc.matchAll(/data-slot\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
  for (const id of regions) if (!manifest.slots.some((s) => s.id === id)) problems.push(`Element data-slot="${id}" has no matching slot in the manifest.`);
  return problems;
}

/** Strip samples from a manifest (what a viewer of a published app receives). */
export function publicManifest(manifest) {
  return { ...manifest, slots: manifest.slots.map(({ sample, ...s }) => s) };
}

/** Slot ids that have a binding. */
export function unboundSlots(manifest, bindings = {}) {
  return manifest.slots.filter((s) => !bindings[s.id]).map((s) => s.id);
}
