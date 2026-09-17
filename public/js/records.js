// The relational side of one student: attendance, incidents, services. Each
// panel is one scoped SQL query, so a viewer only ever sees their own rows.
import { api, h, clear, when } from '/app.js';

const esc = (id) => String(id).replace(/'/g, "''");

const PANELS = (id) => [
  {
    title: 'Attendance',
    note: 'The last 30 days on record.',
    empty: 'No attendance has been recorded.',
    sql: `SELECT date, code, period, note FROM attendance WHERE studentSourcedId = '${esc(id)}' ORDER BY date DESC LIMIT 30`,
    columns: [['date', 'Date', when], ['code', 'Code'], ['period', 'Period'], ['note', 'Note']],
    summary: (rows) => {
      const present = rows.filter((r) => r.code === 'present').length;
      return `${present} of ${rows.length} days present in this window.`;
    },
  },
  {
    title: 'Incidents',
    note: 'Behaviour incidents and what was done.',
    empty: 'No discipline incidents are recorded. Worth saying out loud.',
    sql: `SELECT date, type, action, description FROM discipline_incidents WHERE studentSourcedId = '${esc(id)}' ORDER BY date DESC LIMIT 30`,
    columns: [['date', 'Date', when], ['type', 'Type'], ['action', 'Action'], ['description', 'What happened']],
  },
  {
    title: 'Services',
    note: 'Programs and supports this student is part of.',
    empty: 'No services are recorded.',
    sql: `SELECT type, level, startDate, endDate, provider FROM services WHERE studentSourcedId = '${esc(id)}' ORDER BY startDate DESC LIMIT 30`,
    columns: [['type', 'Service'], ['level', 'Level'], ['startDate', 'From', when], ['endDate', 'Until', when], ['provider', 'Provider']],
  },
];

/** Returns the Records section; each panel loads and degrades on its own. */
export function recordsSection(studentId) {
  const grid = h('div.recordgrid');
  const section = h('div', { style: 'margin-top:22px' },
    h('h2', 'Records'),
    h('p.lede', 'The structured rows behind the numbers: days, incidents, services. This is what the metrics are computed from.'),
    grid);
  for (const panel of PANELS(studentId)) grid.appendChild(panelCard(panel));
  return section;
}

function panelCard(panel) {
  const body = h('div', h('p.small.muted', 'Loading…'));
  const card = h('div.card',
    h('h3', { style: 'margin-top:0' }, panel.title),
    h('p.small.muted', { style: 'margin-top:0' }, panel.note),
    body);
  api('/api/sql/query', { method: 'POST', body: { sql: panel.sql, limit: 30 } })
    .then((r) => {
      clear(body);
      if (!r.rowCount) { body.appendChild(h('p.empty', { style: 'padding:14px 0' }, panel.empty)); return; }
      if (panel.summary) body.appendChild(h('p.small.muted', { style: 'margin:0 0 8px' }, panel.summary(r.rows)));
      body.appendChild(table(panel.columns, r.rows));
      body.appendChild(h('p.small.muted', { style: 'margin:8px 0 0' }, `${r.rowCount} row${r.rowCount === 1 ? '' : 's'}${r.truncated ? ', more not shown' : ''}.`));
    })
    .catch((e) => { clear(body).appendChild(h('p.small.muted', e.status === 404 ? 'Tables are not available on this server.' : panel.empty)); });
  return card;
}

function table(columns, rows) {
  return h('div.tablewrap', { style: 'max-height:280px;overflow:auto' }, h('table',
    h('thead', h('tr', columns.map(([, label]) => h('th', { scope: 'col' }, label)))),
    h('tbody', rows.map((row) => h('tr', columns.map(([key, , fmt]) => {
      const v = row[key];
      return h('td.wrap', v == null || v === '' ? h('span.muted', '—') : String(fmt ? fmt(v) : v));
    })))),
  ));
}
