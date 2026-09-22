// Data: the schema your scope can see, and a read-only SQL console over it.
// The database enforces the scope, so the same console is safe for every role.
import { api, h, clear, render, state, status } from '/app.js';
import { t } from '/js/edition.js';

const EXAMPLES = [
  ['Absence rate by school',
    `SELECT o.name AS school,
       ROUND(100.0 * SUM(CASE WHEN a.code IN ('absent','excused') THEN 1 ELSE 0 END) / COUNT(*), 1) AS absence_rate,
       COUNT(*) AS days_recorded
FROM attendance a
JOIN students s ON s.sourcedId = a.studentSourcedId
JOIN orgs o ON o.sourcedId = s.schoolSourcedId
GROUP BY o.name
ORDER BY absence_rate DESC`],
  ['Students by outcome and grade',
    `SELECT grade, outcome, COUNT(*) AS students
FROM students
GROUP BY grade, outcome
ORDER BY grade, students DESC`],
  ['One student’s scores',
    `SELECT li.title AS assignment, li.category, li.dueDate, r.score, r.scoreStatus
FROM results r
JOIN line_items li ON li.sourcedId = r.lineItemSourcedId
WHERE r.studentSourcedId = 'STU-0001'
ORDER BY li.dueDate DESC
LIMIT 50`],
  ['Incidents by type this month',
    `SELECT type, action, COUNT(*) AS incidents
FROM discipline_incidents
WHERE date >= date('now','start of month')
GROUP BY type, action
ORDER BY incidents DESC`],
];

let editor;
let last = null;

export async function show() {
  const schema = await api('/api/sql/schema');
  editor = h('textarea', {
    id: 'sql', rows: '9', spellcheck: 'false', class: 'mono',
    placeholder: 'SELECT outcome, COUNT(*) FROM students GROUP BY outcome',
    onkeydown: (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault?.(); run(); } },
  });
  const out = h('div');
  const err = h('p.err', { role: 'alert' });
  const meta = h('p.small.muted', { 'aria-live': 'polite' });
  const runBtn = h('button.btn', { onclick: () => run() }, t('Run'));
  const copyBtn = h('button.btn.ghost.small', { disabled: true, onclick: () => copyCsv(copyBtn) }, t('Copy as CSV'));

  const console_ = h('div.card',
    h('div.spread', h('h2', { style: 'margin-top:0' }, t('Query')), h('span.small.muted', schema.dialect === 'sqlite' ? 'SQLite · read-only' : schema.dialect)),
    h('label', { for: 'sql' }, t('One SELECT statement')),
    editor,
    h('div.row', { style: 'margin-top:10px' }, runBtn, copyBtn, h('span.small.muted', t('Cmd or Ctrl + Enter runs it.'))),
    h('div.chips', { style: 'margin-top:12px' }, EXAMPLES.map(([label, sql]) =>
      h('button', { type: 'button', title: 'Load this query', onclick: () => { editor.value = sql; run(); } }, label))),
    err, meta, out,
  );

  render(h('div',
    h('h1', t('Data')),
    h('p.lede', t('Your records as tables. Everything here is read-only and already narrowed to what your account may see, by the database itself.')),
    ['admin', 'staff'].includes(state.user?.role) ? statusCard() : null,
    h('div.datagrid', { style: 'margin-top:18px' },
      schemaBrowser(schema),
      console_),
  ));

  async function run() {
    const sql = editor.value.trim();
    err.textContent = '';
    if (!sql) { err.textContent = t('Write a query first.'); return; }
    runBtn.disabled = true;
    meta.textContent = 'Running…';
    clear(out);
    try {
      const r = await api('/api/sql/query', { method: 'POST', body: { sql } });
      last = r;
      copyBtn.disabled = !r.rowCount;
      meta.textContent = `${r.rowCount} row${r.rowCount === 1 ? '' : 's'} · ${r.ms} ms`;
      if (r.truncated) out.appendChild(h('p.notice', 'Truncated: only the first rows are shown. Add a LIMIT or aggregate to see the whole picture.'));
      out.appendChild(resultTable(r));
    } catch (ex) {
      last = null;
      copyBtn.disabled = true;
      meta.textContent = '';
      err.textContent = ex.message;
    }
    runBtn.disabled = false;
  }
}

function resultTable(r) {
  if (!r.rowCount) return h('p.empty', t('The query ran and matched no rows.'));
  return h('div.tablewrap', { style: 'margin-top:10px;max-height:460px;overflow:auto' }, h('table',
    h('thead', h('tr', r.columns.map((c) => h('th', { scope: 'col' }, c)))),
    h('tbody', r.rows.map((row) => h('tr', r.columns.map((c) => h('td', cell(row[c])))))),
  ));
}

const cell = (v) => (v == null ? h('span.muted', '—') : typeof v === 'number' ? String(v) : String(v).slice(0, 300));

function schemaBrowser(schema) {
  const box = h('div.card', { style: 'position:sticky;top:64px;max-height:78vh;overflow:auto' },
    h('h2', { style: 'margin-top:0' }, t('Tables')),
    h('p.small.muted', { style: 'margin-top:0' }, t('Click a table to query it, or a column to insert its name.')),
    schema.tables.map(tableBlock),
    schema.notes?.length ? h('div', { style: 'margin-top:14px' },
      h('h3', t('In your scope')),
      h('ul.small.muted', { style: 'padding-left:18px;margin:0' }, schema.notes.map((n) => h('li', n)))) : null,
  );
  return box;
}

function tableBlock(spec) {
  return h('details', { style: 'border-bottom:1px solid var(--line);padding:2px 0' },
    h('summary', h('span.mono', { style: 'font-weight:600' }, spec.name), h('span.small.muted', ` · ${spec.columns.length}`)),
    h('p.small.muted', { style: 'margin:4px 0 6px' }, spec.doc),
    h('div.row', { style: 'gap:6px;margin-bottom:8px' },
      h('button.btn.ghost.small', { onclick: () => insert(`SELECT * FROM ${spec.name} LIMIT 50`, true) }, t('Query this table'))),
    h('div.chips', spec.columns.map((c) => h('button', { type: 'button', title: t('Insert ') + c, onclick: () => insert(c) }, c))),
  );
}

/** Insert at the cursor, or replace the whole editor for a table query. */
function insert(text, replace = false) {
  if (!editor) return;
  if (replace) { editor.value = text; editor.focus(); return; }
  const start = editor.selectionStart, end = editor.selectionEnd;
  if (typeof start === 'number' && typeof end === 'number') {
    editor.value = editor.value.slice(0, start) + text + editor.value.slice(end);
    const at = start + text.length;
    editor.selectionStart = editor.selectionEnd = at;
  } else editor.value += text;
  editor.focus();
}

function statusCard() {
  const body = h('div', h('p.small.muted', 'Loading…'));
  const card = h('div.card', { style: 'margin-top:18px' },
    h('h2', { style: 'margin-top:0' }, t('The projection')),
    h('p.small.muted', { style: 'margin-top:0' }, t('These tables are rebuilt from the ledger. The ledger is the record; this is a view of it you can query.')),
    body);
  load();
  async function load() {
    body.replaceChildren(h('p.small.muted', 'Loading…'));
    try {
      const s = await api('/api/sql/status');
      const behind = (s.ledgerSeq ?? 0) - (s.seq ?? 0);
      body.replaceChildren(
        h('p.small', { style: 'margin:0' },
          h('span', { style: `color:var(${behind ? '--watch' : '--ok'});font-weight:600` }, behind ? `${behind} events behind` : 'Up to date'),
          h('span.muted', ` · projection ${s.seq} of ledger ${s.ledgerSeq}`)),
        h('p.small.muted.mono', { style: 'margin:4px 0 10px;word-break:break-all' }, s.file),
        countTable(s.counts),
        h('div.row', { style: 'margin-top:12px' },
          h('button.btn.ghost.small', { onclick: (e) => rebuild(e.target) }, t('Rebuild from the ledger')),
          h('button.btn.ghost.small', { onclick: (e) => derive(e.target) }, t('Recompute metrics from facts'))),
      );
    } catch (e) { body.replaceChildren(h('p.err', e.message)); }
  }
  async function rebuild(btn) {
    if (!window.confirm('Rebuild every table from the ledger? Nothing is lost: the ledger is the record.')) return;
    btn.disabled = true;
    try { const r = await api('/api/sql/rebuild', { method: 'POST', body: {} }); status(`Rebuilt through event ${r.seq}.`); await load(); }
    catch (e) { status(e.message, true); btn.disabled = false; }
  }
  async function derive(btn) {
    btn.disabled = true;
    try {
      const r = await api('/api/derive', { method: 'POST', body: {} });
      status(`Recomputed ${r.updated} student${r.updated === 1 ? '' : 's'} from the fact tables${r.skipped ? `, skipped ${r.skipped} with no facts` : ''}.`);
    } catch (e) { status(e.message, true); }
    btn.disabled = false;
  }
  return card;
}

function countTable(counts) {
  const rows = Object.entries(counts || {});
  if (!rows.length) return null;
  return h('div.tablewrap', { style: 'max-height:240px;overflow:auto' }, h('table',
    h('thead', h('tr', h('th', { scope: 'col' }, t('Table')), h('th', { scope: 'col' }, t('Rows')))),
    h('tbody', rows.map(([name, n]) => h('tr',
      h('td', h('span.mono', name)),
      h('td', n ? String(n) : h('span.muted', '0'))))),
  ));
}

/** CSV is built here, in the page. Nothing is sent anywhere to make it. */
export function toCsv(r) {
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return [r.columns, ...r.rows.map((row) => r.columns.map((c) => row[c]))].map((line) => line.map(esc).join(',')).join('\n');
}

async function copyCsv(btn) {
  if (!last) return;
  const csv = toCsv(last);
  try { await navigator.clipboard.writeText(csv); status(`Copied ${last.rowCount} rows as CSV.`); }
  catch { window.prompt('Copy this CSV', csv); }
  void btn;
}
