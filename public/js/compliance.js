// Compliance: what you should be able to show, whether you can show it, and a
// form that fixes the one row that is missing.
import { api, apiOptional, h, clear, render, go, panelMissing } from '/app.js';
import { t, copy, say } from '/js/edition.js';
import { statusChip, table } from '/js/ui.js';
import { FORMS, openRecordForm } from '/js/recordform.js';
import { summaryTiles } from '/js/onboard-records.js';

export async function show() {
  const st = await apiOptional('/api/compliance/status');
  if (!st) {
    render(h('div', h('h1', t('Compliance')),
      panelMissing(t('Not available yet'), t('The compliance module is not installed on this server. Once it is, this page lists every check, what is failing, and a form that fixes it.'))));
    return;
  }
  render(h('div',
    h('h1', t('Compliance')),
    h('p.lede', say(['compliance_intro', 'complianceIntro'], 'The ordinary questions on an ordinary day. Requirements vary by state — this keeps your own house in order, it is not legal advice.')),
    summaryTiles(st),
    await reportsCard(),
    ...groups(st.checks || []),
    outro(),
  ));
}

/** An edition may close the page in its own words. */
function outro() {
  const text = copy('compliance_outro', 'complianceOutro');
  return text ? h('p.lede', { style: 'margin-top:18px' }, text) : null;
}

/** Checks grouped by pack, then by subject. */
function groups(checks) {
  const byPack = new Map();
  for (const c of checks) {
    const pack = c.pack || 'core';
    if (!byPack.has(pack)) byPack.set(pack, new Map());
    const bySubject = byPack.get(pack);
    const subject = c.subject || 'other';
    if (!bySubject.has(subject)) bySubject.set(subject, []);
    bySubject.get(subject).push(c);
  }
  const out = [];
  for (const [pack, bySubject] of byPack) {
    out.push(h('h2', t(titleCase(pack)) + ' ' + t('pack')));
    for (const [subject, list] of bySubject) {
      out.push(h('div.card', { style: 'margin-bottom:14px' },
        h('h3', { style: 'margin-top:0' }, t(titleCase(subject))),
        h('div.stack', list.map(checkRow))));
    }
  }
  return out.length ? out : [h('p.empty', t('No checks ran. The packs may be empty for this edition.'))];
}

const titleCase = (s) => String(s).replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase());

function checkRow(check) {
  const detail = h('div');
  let open = false;
  const toggle = h('button.linkish', { onclick: () => { open = !open; open ? load() : clear(detail); } },
    t(check.failingCount ? `Show the ${check.failingCount} that are not covered` : 'Show detail'));

  async function load() {
    clear(detail).appendChild(h('p.small.muted', 'Loading…'));
    try {
      const full = await api('/api/compliance/checks/' + encodeURIComponent(check.id));
      clear(detail).appendChild(failingList(full.check || full, check));
    } catch (e) { clear(detail).appendChild(h('p.err', e.message)); }
  }

  return h('div.checkrow',
    h('div.spread',
      h('div', h('strong', t(check.title || check.id)),
        check.severity ? h('span.chip', { style: 'margin-left:8px' }, t(check.severity)) : null),
      statusChip(check.status)),
    check.why ? h('p.small.muted', { style: 'margin:4px 0' }, t(check.why)) : null,
    h('p.small.muted', { style: 'margin:4px 0' },
      check.total != null ? `${(check.total || 0) - (check.failingCount || 0)} ${t('of')} ${check.total} ${t('covered')}` : '',
      check.fix?.hint ? h('span', { style: 'display:block' }, t(check.fix.hint)) : null),
    check.status === 'pass' || check.status === 'n/a' ? null : toggle,
    detail,
  );
}

function failingList(full, check) {
  const failing = full.failing || [];
  const fixTable = full.fix?.table || check.fix?.table;
  const host = h('div');
  if (!failing.length) return h('p.small.muted', t('Nothing is failing this check right now.'));
  return h('div',
    table([
      [(f) => f.label || f.id, 'Who or what'],
      ['detail', 'What is missing'],
      [(f) => h('div.row', { style: 'gap:6px;flex-wrap:nowrap' },
        f.id ? h('button.btn.ghost.small', { onclick: () => go('/person/' + f.id) }, t('Open')) : null,
        fixTable && FORMS[fixTable]
          ? h('button.btn.small', { onclick: () => openRecordForm(host, fixTable, { prefill: prefillFor(fixTable, f), onSaved: () => clear(host) }) }, t('Fix'))
          : null), ''],
    ], failing),
    host);
}

/** Point the record form at the right person or school. */
export function prefillFor(tableName, item) {
  const spec = FORMS[tableName];
  const prefill = {};
  if (spec?.subject && item?.id) prefill[spec.subject] = item.id;
  if (tableName === 'documents') prefill.subjectType = item?.subjectType || (String(item?.id || '').startsWith('STF') ? 'staff' : 'student');
  if (item?.fix) Object.assign(prefill, item.fix);
  return prefill;
}

async function reportsCard() {
  const data = await apiOptional('/api/compliance/reports');
  const reports = data?.reports || [];
  if (!reports.length) return null;
  return h('div.card', { style: 'margin-top:18px' },
    h('h2', { style: 'margin-top:0' }, t('Reports')),
    h('p.small.muted', { style: 'margin-top:0' }, t('Built here, on this machine. Nothing is sent anywhere to make one.')),
    h('div.row', reports.map((r) => h('a.btn.ghost.small', { href: `/api/compliance/reports/${encodeURIComponent(r.id)}.csv`, download: '' }, t(r.title || r.id)))),
  );
}

/** The "Your records" card families and students see on their home page. */
export async function myRecordsCard() {
  const data = await apiOptional('/api/compliance/mine');
  if (!data) return null;
  const items = data.items || [];
  const missing = items.filter((i) => i.status !== 'pass');
  return h('div.card', { style: 'margin-top:14px' },
    h('h2', { style: 'margin-top:0' }, t('Your records')),
    h('p.small.muted', { style: 'margin-top:0' },
      say(['mine_intro', 'mineIntro'], 'What the school has on file for you, and what it is still waiting for.')),
    items.length
      ? table([
        [(i) => i.label, 'Record'],
        [(i) => statusChip(i.status), ''],
        ['detail', 'What to do'],
      ], items)
      : h('p.empty', t('Nothing is outstanding.')),
    missing.length
      ? h('p.small.muted', { style: 'margin-top:10px' },
        t(`${missing.length} thing${missing.length === 1 ? '' : 's'} to sort out. Bring it to the office, or write to them — they enter it here.`))
      : null,
  );
}
