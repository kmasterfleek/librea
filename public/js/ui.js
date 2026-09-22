// Small shared widgets the onboarding, compliance and record pages all want.
// Nothing here knows about any particular page.
import { h, clear, status } from '/app.js';
import { t } from '/js/edition.js';

let seq = 0;
export const uid = (p = 'f') => `${p}-${++seq}`;

/** A labelled control. `input` may be an <input>, <select> or <textarea>. */
export function field(label, input, hint) {
  if (!input.id) input.id = uid();
  return h('div.field', h('label', { for: input.id }, t(label)), input, hint ? h('p.small.muted', { style: 'margin:4px 0 0' }, t(hint)) : null);
}

export function input(attrs = {}) { return h('input', { type: 'text', ...attrs, id: attrs.id || uid() }); }

export function select(options, value, attrs = {}) {
  const el = h('select', { ...attrs, id: attrs.id || uid() },
    options.map((o) => { const [v, label] = Array.isArray(o) ? o : [o, o]; return h('option', { value: v }, t(String(label))); }));
  el.value = value ?? '';
  return el;
}

export const labelled = (label, ctl) => { if (!ctl.id) ctl.id = uid(); return h('div', h('label', { for: ctl.id }, t(label)), ctl); };

export function debounce(fn, ms = 300) {
  let timer;
  return (...a) => { clearTimeout(timer); timer = setTimeout(() => fn(...a), ms); };
}

/** Copy to the clipboard, falling back to a prompt when the browser says no. */
export async function copyText(text, note = 'Copied.') {
  try { await navigator.clipboard.writeText(text); status(note); }
  catch { window.prompt('Copy this', text); }
}

/** A read-only box with the text and a Copy button beside it. */
export function copyBox(text, label = 'Copy') {
  const box = h('textarea', { rows: String(Math.min(12, Math.max(3, String(text).split('\n').length + 1))), readonly: true, class: 'mono', id: uid('copy') });
  box.value = text;
  return h('div',
    box,
    h('div.row', { style: 'margin-top:8px' }, h('button.btn.ghost.small', { type: 'button', onclick: () => copyText(box.value) }, label)));
}

const CHIP = { pass: '--ok', fail: '--risk', warn: '--watch', 'n/a': '--ink-faint', missing: '--risk', expired: '--risk', 'on-file': '--ok', valid: '--ok', pending: '--watch' };
/** A coloured status word. */
export const statusChip = (s) => h('span.statuschip', { style: `color:var(${CHIP[s] || '--ink-soft'})` }, t(String(s || '—')));

/** A card that shows a spinner, then whatever `load()` resolves to. */
export function lazyCard(title, note, load) {
  const body = h('div', h('p.small.muted', 'Loading…'));
  const card = h('div.card', title ? h('h2', { style: 'margin-top:0' }, t(title)) : null,
    note ? h('p.small.muted', { style: 'margin-top:0' }, t(note)) : null, body);
  Promise.resolve().then(load)
    .then((node) => clear(body).appendChild(node || h('p.empty', 'Nothing here.')))
    .catch((e) => clear(body).appendChild(h('p.err', e.message)));
  return card;
}

/** A plain table from [[key, label, fmt?]] specs. */
export function table(columns, rows, onRow) {
  return h('div.tablewrap', h('table',
    h('thead', h('tr', columns.map(([, label]) => h('th', { scope: 'col' }, t(label))))),
    h('tbody', rows.map((row) => h(onRow ? 'tr.clickable' : 'tr', onRow ? { tabindex: '0', onclick: () => onRow(row), onkeydown: (e) => { if (e.key === 'Enter') onRow(row); } } : null,
      columns.map(([key, , fmt]) => {
        const v = typeof key === 'function' ? key(row) : row[key];
        if (v instanceof Node) return h('td', v);
        const shown = fmt ? fmt(v, row) : v;
        return h('td.wrap', shown instanceof Node ? shown : (shown == null || shown === '' ? h('span.muted', '—') : String(shown)));
      })))),
  ));
}
