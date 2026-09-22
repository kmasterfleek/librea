// The relational side of one student: attendance, incidents, services, and the
// compliance rows. Each panel is one scoped SQL query, so a viewer only ever
// sees their own rows.
import { api, h, clear, state, when } from '/app.js';
import { t } from '/js/edition.js';
import { statusChip } from '/js/ui.js';
import { openRecordForm } from '/js/recordform.js';

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
    add: 'services',
    sql: `SELECT type, level, startDate, endDate, provider FROM services WHERE studentSourcedId = '${esc(id)}' ORDER BY startDate DESC LIMIT 30`,
    columns: [['type', 'Service'], ['level', 'Level'], ['startDate', 'From', when], ['endDate', 'Until', when], ['provider', 'Provider']],
  },
  {
    title: 'Immunizations',
    note: 'Shots on record, or the exemption that stands in for one.',
    empty: 'Nothing on file. A school usually has to be able to show this.',
    add: 'immunizations',
    sql: `SELECT vaccine, date, doseNumber, exemption, verifiedBy FROM immunizations WHERE studentSourcedId = '${esc(id)}' ORDER BY date DESC LIMIT 30`,
    columns: [['vaccine', 'Vaccine'], ['date', 'Date', when], ['doseNumber', 'Dose'], ['exemption', 'Exemption', chip], ['verifiedBy', 'Verified by']],
  },
  {
    title: 'Documents',
    note: 'The paperwork on file: enrollment, consent, custody, residency.',
    empty: 'No documents are on file.',
    add: 'documents',
    sql: `SELECT type, title, status, issuedDate, expiresDate FROM documents WHERE subjectSourcedId = '${esc(id)}' ORDER BY issuedDate DESC LIMIT 30`,
    columns: [['type', 'Kind'], ['title', 'Title'], ['status', 'Status', chip], ['issuedDate', 'Signed', when], ['expiresDate', 'Expires', when]],
  },
  {
    title: 'Learning plans',
    note: 'What this student is working toward, and when it is looked at again.',
    empty: 'No learning plan is on record.',
    add: 'learning_plans',
    sql: `SELECT type, title, status, startDate, reviewDate, owner FROM learning_plans WHERE studentSourcedId = '${esc(id)}' ORDER BY startDate DESC LIMIT 30`,
    columns: [['type', 'Kind'], ['title', 'Title'], ['status', 'Status', chip], ['startDate', 'From', when], ['reviewDate', 'Next review', when], ['owner', 'Owner']],
  },
  {
    title: 'Enrollment',
    note: 'Joining, leaving, transferring, graduating.',
    empty: 'No enrollment events are recorded.',
    add: 'enrollment_events',
    sql: `SELECT event, date, orgSourcedId, reason, nextSchool FROM enrollment_events WHERE studentSourcedId = '${esc(id)}' ORDER BY date DESC LIMIT 30`,
    columns: [['event', 'What happened', chip], ['date', 'Date', when], ['orgSourcedId', 'School'], ['reason', 'Reason'], ['nextSchool', 'Next school']],
  },
];

function chip(v) { return v ? statusChip(v) : null; }

/** Returns the Records section; each panel loads and degrades on its own. */
export function recordsSection(studentId) {
  const grid = h('div.recordgrid');
  const section = h('div', { style: 'margin-top:22px' },
    h('h2', t('Records')),
    h('p.lede', t('The structured rows behind the numbers: days, incidents, services, health, paperwork, plans. This is what the metrics are computed from.')),
    grid);
  for (const panel of PANELS(studentId)) grid.appendChild(panelCard(panel, studentId));
  return section;
}

function panelCard(panel, studentId) {
  const body = h('div');
  const formHost = h('div');
  const canAdd = panel.add && ['admin', 'staff'].includes(state.user?.role);
  const card = h('div.card',
    h('div.spread',
      h('h3', { style: 'margin:0' }, t(panel.title)),
      canAdd ? h('button.btn.ghost.small', { onclick: () => add() }, t('Add')) : null),
    h('p.small.muted', { style: 'margin:4px 0 0' }, t(panel.note)),
    formHost, body);
  load();

  function add() {
    openRecordForm(formHost, panel.add, { prefill: subjectFor(panel.add, studentId), onSaved: () => { clear(formHost); load(); } });
  }

  function load() {
    clear(body).appendChild(h('p.small.muted', 'Loading…'));
    api('/api/sql/query', { method: 'POST', body: { sql: panel.sql, limit: 30 } })
      .then((r) => {
        clear(body);
        if (!r.rowCount) { body.appendChild(h('p.empty', { style: 'padding:14px 0' }, t(panel.empty))); return; }
        if (panel.summary) body.appendChild(h('p.small.muted', { style: 'margin:0 0 8px' }, t(panel.summary(r.rows))));
        body.appendChild(table(panel.columns, r.rows));
        body.appendChild(h('p.small.muted', { style: 'margin:8px 0 0' }, `${r.rowCount} ${t(r.rowCount === 1 ? 'row' : 'rows')}${r.truncated ? t(', more not shown') : ''}.`));
      })
      .catch((e) => { clear(body).appendChild(h('p.small.muted', e.status === 404 ? t('Tables are not available on this server.') : t(panel.empty))); });
  }
  return card;
}

const subjectFor = (tableName, studentId) => (tableName === 'documents'
  ? { subjectSourcedId: studentId, subjectType: 'student' }
  : { studentSourcedId: studentId });

function table(columns, rows) {
  return h('div.tablewrap', { style: 'max-height:280px;overflow:auto' }, h('table',
    h('thead', h('tr', columns.map(([, label]) => h('th', { scope: 'col' }, t(label))))),
    h('tbody', rows.map((row) => h('tr', columns.map(([key, , fmt]) => {
      const v = row[key];
      if (v == null || v === '') return h('td.wrap', h('span.muted', '—'));
      const shown = fmt ? fmt(v) : v;
      return h('td.wrap', shown instanceof Node ? shown : String(shown));
    })))),
  ));
}
