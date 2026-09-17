// The sovereignty panel: where the data lives, whether the ledger still checks
// out, what leaves the building, and how to get everything back out.
import { api, apiOptional, h, state, status } from '/app.js';

const EXPORTS = [
  ['/api/export/students.csv', 'Students (CSV)', 'Identity, metrics and the 15 computed signals, one row per student.'],
  ['/api/export/fragments.csv', 'Fragments (CSV)', 'Every note, observation and caption, with author and audience.'],
  ['/api/export/bundle.json', 'Everything (JSON)', 'Entities, fragments, apps and the ledger head in one file.'],
  ['/api/export/ledger.jsonl', 'Ledger (JSONL)', 'The append-only event log, verbatim.'],
];

export async function panel() {
  const box = h('div.card.stack',
    h('h2', { style: 'margin-top:0' }, 'Sovereignty'),
    h('p.lede', 'Three questions worth being able to answer about any system that holds children’s records.'),
  );
  box.appendChild(h('div.stack',
    whereBlock(),
    ledgerBlock(),
    leavesBlock(),
    exportBlock(),
  ));
  return box;
}

/** Where the data lives: the folder, the ledger, and the queryable projection. */
function whereBlock() {
  const wrap = item('Where the data lives',
    'On this machine, in one folder: a plain event log plus its snapshots. No cloud account, no vendor database, no copy you cannot see.');
  const extra = h('p.small.muted', { style: 'margin:6px 0 0' });
  wrap.appendChild(extra);
  apiOptional('/api/sql/status').then((s) => {
    if (!s) {
      extra.textContent = 'Alongside the log sits a SQLite file holding the same records as tables, so you can query them with ordinary SQL.';
      return;
    }
    extra.replaceChildren(
      h('span', 'Alongside the log sits a SQLite file holding the same records as tables, rebuilt from the log and queryable with ordinary SQL:'),
      h('span.mono', { style: 'display:block;word-break:break-all;margin-top:2px' }, s.file),
      countsLine(s.counts),
    );
  }).catch(() => { extra.textContent = 'Alongside the log sits a SQLite file holding the same records as tables.'; });
  return wrap;
}

/** Admin sees exactly how many rows are in each table. */
function countsLine(counts) {
  if (state.user?.role !== 'admin' || !counts) return null;
  const parts = Object.entries(counts).filter(([, n]) => n > 0).map(([t, n]) => `${t} ${n.toLocaleString()}`);
  const empty = Object.entries(counts).filter(([, n]) => !n).map(([t]) => t);
  return h('span', { style: 'display:block;margin-top:4px' },
    h('span', parts.length ? 'Rows: ' + parts.join(' \u00b7 ') + '.' : 'No rows yet.'),
    empty.length ? h('span', { style: 'display:block;color:var(--ink-faint)' }, 'Empty: ' + empty.join(', ') + '.') : null);
}

function item(title, body, extra) {
  return h('div', h('h3', { style: 'margin-top:0' }, title), h('p.small.muted', { style: 'margin:0' }, body), extra || null);
}

function ledgerBlock() {
  const slot = h('p.small.muted', { style: 'margin:0' }, 'Checking the ledger…');
  const wrap = item('Ledger integrity', '');
  wrap.replaceChild(slot, wrap.lastChild);
  if (state.user?.role !== 'admin') {
    slot.textContent = 'Every change is appended to a hash-chained ledger. An administrator can verify the chain from the home page.';
    return wrap;
  }
  api('/api/ledger/verify').then((v) => {
    slot.replaceChildren(
      h('span', { style: `color:var(${v.ok ? '--ok' : '--risk'});font-weight:600` }, v.ok ? 'Chain verified' : 'Chain broken'),
      h('span', ` · ${v.events ?? v.count ?? 0} events`),
      v.head ? h('span.mono', { style: 'display:block;color:var(--ink-faint)' }, 'head ' + String(v.head).slice(0, 16)) : null,
    );
  }).catch((e) => { slot.textContent = 'Could not verify the ledger: ' + e.message; });
  return wrap;
}

function leavesBlock() {
  const slot = h('p.small.muted', { style: 'margin:0' }, 'Checking…');
  const wrap = item('What leaves the building', '');
  wrap.replaceChild(slot, wrap.lastChild);
  apiOptional('/api/vibe/provider').then((info) => {
    if (!info) { slot.textContent = 'Nothing. No model provider is configured, so no request is made to anyone.'; return; }
    const p = info.provider || info;
    const wl = info.whatLeaves;
    const statement = typeof wl === 'string' ? wl : wl?.statement || (wl?.leaves ? `What leaves: ${wl.leaves}.` : '');
    const never = (wl && typeof wl === 'object' && wl.neverSends) || [];
    slot.replaceChildren(
      h('span', statement || (p.offline
        ? 'Nothing. Apps are built from local templates, so no request is made to anyone.'
        : 'Your prompt and a redacted, aggregate description of the data. Names and identifiers are stripped before anything is sent.')),
      never.length ? h('span.small', { style: 'display:block;margin-top:4px' }, 'Never sent: ' + never.join(', ') + '.') : null,
      h('span.small', { style: 'display:block;color:var(--ink-faint);margin-top:4px' }, `Provider: ${p.name || 'local'}${p.model ? ' · ' + p.model : ''}${p.offline ? ' · offline' : ''}`),
    );
  }).catch(() => { slot.textContent = 'Provider information is not available.'; });
  return wrap;
}

function exportBlock() {
  if (state.user?.role !== 'admin') {
    return item('Taking your data with you', 'An administrator can export everything as CSV and JSON at any time. There is no export fee and no exit interview.');
  }
  const links = h('div.row', { style: 'margin-top:8px' }, EXPORTS.map(([href, label, hint]) =>
    h('a.btn.ghost.small', { href, download: '', title: hint, onclick: () => status('Downloading ' + label + '…') }, label)));
  return item('Taking your data with you', 'Everything comes back out as plain files a district can read without Librea.', links);
}
