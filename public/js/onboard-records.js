// Wizard screens that are not about creating people: the paperwork, the drills,
// the compliance summary, the invites, and the nudge to build something.
import { api, apiOptional, h, clear, state, go, displayName, when } from '/app.js';
import { t, Word, feature, say } from '/js/edition.js';
import { recordForm } from '/js/recordform.js';
import { inviteComposer, inviteList } from '/js/invites.js';
import { table, statusChip } from '/js/ui.js';

const RECORD_TABLES = [
  ['documents', 'Paperwork'],
  ['immunizations', 'Health'],
  ['contacts', 'Emergency contacts'],
  ['staff_credentials', 'Staff checks'],
  ['learning_plans', 'Learning plans'],
  ['enrollment_events', 'Enrollment'],
  ['services', 'Services'],
];

/** Tabs of generic record forms, one per fact table. */
export async function records(tables = RECORD_TABLES) {
  let active = tables[0][0];
  const tabs = h('div.tabs', { role: 'tablist' });
  const body = h('div');

  function drawTabs() {
    clear(tabs).append(...tables.map(([name, label]) => h('button', {
      role: 'tab', 'aria-selected': String(active === name),
      onclick: () => { active = name; drawTabs(); drawBody(); },
    }, t(label))));
  }
  async function drawBody() {
    clear(body).appendChild(h('p.small.muted', 'Loading…'));
    const form = await recordForm(active, { onSaved: () => drawBody() });
    clear(body).append(h('div.card', form), await recent(active));
  }
  drawTabs();
  await drawBody();

  return h('div',
    h('p.lede', say(['onboarding_records', 'onboardingRecords'], 'The ordinary questions on the ordinary day: who is allowed to collect them, who has had their shots, who checked the adults, what each student is working toward. Type what you already have on paper.')),
    tabs, body);
}

/** The last rows written to a table, so you can see the typing land. */
async function recent(tableName) {
  try {
    const r = await api('/api/sql/query', { method: 'POST', body: { sql: `SELECT * FROM ${tableName} LIMIT 10`, limit: 10 } });
    if (!r.rowCount) return h('p.empty', t('Nothing on file here yet.'));
    const cols = r.columns.filter((c) => c !== 'id').slice(0, 6);
    return h('div', { style: 'margin-top:14px' },
      h('h4', { style: 'margin:0 0 6px' }, t('On file')),
      table(cols.map((c) => [c, labelize(c), (v) => (/status|exemption|event/.test(c) && v ? statusChip(v) : v)]), r.rows));
  } catch { return h('p.small.muted', t('The table view is not available on this server.')); }
}

const labelize = (k) => String(k).replace(/SourcedId$/, '').replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

const CREDIT_TABLES = [
  ['courses', 'Courses'],
  ['classes', 'Sections'],
  ['enrollments', 'Who is in them'],
  ['line_items', 'Credit-bearing items'],
  ['academic_sessions', 'Terms'],
];

/** Courses, sections and the credits they carry — the number the school runs on. */
export async function credits() {
  const intro = say(['onboarding_credits', 'onboardingCredits'],
    'A course, the sections it is taught in, who is enrolled, and how many credits each one carries.');
  const body = await records(CREDIT_TABLES);
  body.replaceChild(h('p.lede', intro), body.firstChild);
  return body;
}

export async function drills() {
  const box = h('div');
  async function draw() {
    clear(box).append(h('div.card', await recordForm('drills', { onSaved: draw })), await recent('drills'));
  }
  await draw();
  return h('div',
    h('p.lede', say(['onboarding_drills', 'onboardingDrills'], 'Fire, lockdown, evacuation. Nobody remembers the date a year later, so write it down the day you do it.')),
    box);
}

export async function compliance() {
  const st = await apiOptional('/api/compliance/status');
  if (!st) {
    return h('div.card', h('h3', { style: 'margin-top:0' }, t('Not available yet')),
      h('p.small.muted', t('The compliance module is not installed on this server. Once it is, this page lists what you have to be able to show and whether you can show it.')));
  }
  return h('div',
    h('p.lede', say(['compliance_intro', 'complianceIntro'], 'What you should be able to answer on an ordinary day, and whether the record can answer it.')),
    summaryTiles(st),
    h('div.row', { style: 'margin-top:14px' }, h('button.btn', { onclick: () => go('/compliance') }, t('Open the full list'))));
}

/** Shared with the compliance page. */
export function summaryTiles(st) {
  const s = st.summary || {};
  const tile = (label, counts) => h('div.stat',
    h('span.n', String((counts?.pass || 0) + '/' + ((counts?.pass || 0) + (counts?.fail || 0) + (counts?.warn || 0)))),
    h('span.k', t(label)),
    h('p.small.muted', { style: 'margin:4px 0 0' },
      `${counts?.fail || 0} ${t('to fix')} · ${counts?.warn || 0} ${t('to watch')}`));
  return h('div.grid.four',
    tile('Required', s.required),
    tile('Recommended', s.recommended),
    h('div.stat', h('span.n', String((st.packs || []).length)), h('span.k', t('Packs')),
      h('p.small.muted', { style: 'margin:4px 0 0' }, (st.packs || []).join(', ') || '—')),
    h('div.stat', h('span.n', String((st.checks || []).length)), h('span.k', t('Checks')),
      h('p.small.muted', { style: 'margin:4px 0 0' }, st.ran ? t('Last run ') + when(st.ran) : '')),
  );
}

// ---------- share ----------

export async function share() {
  if (!feature('invites')) return h('p.empty', t('This edition does not use invite codes. Make accounts on the Accounts page instead.'));
  const ctx = await inviteContext();
  const list = inviteList(ctx);
  const composer = inviteComposer({ ...ctx, onCreated: () => list.reload() });
  return h('div',
    h('p.lede', say(['onboarding_share', 'onboardingShare'], 'Everyone gets their own login, and sees only their own slice of the record. Make a code, send it however you already talk to them.')),
    h('div.card', composer),
    h('div', { style: 'margin-top:18px' }, await peoplePicker(ctx, list)),
    h('h3', t('Invites waiting')), list.node);
}

export async function inviteContext() {
  const schools = await api('/api/people?type=school&limit=5').then((r) => r.people).catch(() => []);
  return { orgName: schools[0]?.name || schools[0]?.id || '', inviter: state.user?.displayName || state.user?.username || '' };
}

/** One row per family / staff member, each with a one-click invite. */
async function peoplePicker(ctx, list) {
  const out = h('div');
  const [families, staff, students] = await Promise.all([
    api('/api/people?type=family&limit=100').then((r) => r.people).catch(() => []),
    api('/api/people?type=staff&limit=100').then((r) => r.people).catch(() => []),
    api('/api/people?type=student&limit=500').then((r) => r.people).catch(() => []),
  ]);
  const nameById = new Map(students.map((s) => [s.id, displayName(s)]));
  // A family invite reads better when it names the child it is about.
  const childOf = (f) => (f.students || []).map((id) => nameById.get(id)).filter(Boolean).join(' and ');
  const made = h('div');

  async function make(role, entity, who) {
    try {
      const body = { role, displayName: who, days: 14 };
      if (role === 'family') body.entityIds = entity.students?.length ? entity.students : [entity.id];
      else body.entityId = entity.id;
      const { invite } = await api('/api/invites', { method: 'POST', body });
      const { inviteCard } = await import('/js/invites.js');
      clear(made).appendChild(inviteCard(invite, { ...ctx, who, child: role === 'family' ? childOf(entity) : '' }));
      made.scrollIntoView?.({ block: 'nearest' });
      list.reload();
    } catch (e) { clear(made).appendChild(h('p.err', e.message)); }
  }

  const sectionFor = (rows, role, label, nameOf) => (rows.length ? h('div',
    h('h3', t(label)),
    table([
      [nameOf, 'Name'],
      ['id', 'Id', (v) => h('span.mono.small', v)],
      [(r) => h('button.btn.ghost.small', { onclick: () => make(role, r, nameOf(r)) }, t('Make an invite')), ''],
    ], rows)) : null);

  clear(out).append(
    sectionFor(families, 'family', 'Families', (f) => f.name || (f.members || [])[0]?.name || f.id),
    sectionFor(staff, 'staff', Word('staff', true), (s) => displayName(s)),
    made,
  );
  return out;
}

export async function apps() {
  if (!feature('vibe')) return h('p.empty', t('This edition does not include the app builder.'));
  return h('div',
    h('p.lede', say(['onboarding_apps', 'onboardingApps'], 'The last step is the one nobody else offers: describe a tool you wish you had, and Librea writes it against your own records.')),
    h('div.row', h('button.btn', { onclick: () => go('/build') }, t('Build something')),
      h('button.btn.ghost', { onclick: () => go('/apps') }, t('See what is here'))));
}
