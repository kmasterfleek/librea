// Home: the district at a glance, plus the sovereignty panel.
import { api, h, render, state, go, displayName, gradeLabel, outcomePill } from '/app.js';
import { radar, domainLegend, bars } from '/js/charts.js';
import { panel as sovereigntyPanel } from '/js/sovereignty.js';
import { t, Word, copy, edition, feature, say } from '/js/edition.js';

const OUTCOME_ORDER = ['on-track', 'resilient', 'watch', 'hidden-risk', 'high-risk'];
const OUTCOME_COPY = {
  'on-track': 'No pattern flags',
  resilient: 'Thriving against headwinds',
  watch: 'One signal worth watching',
  'hidden-risk': 'Grades fine, wellness slipping',
  'high-risk': 'Two or more signals at once',
};

export async function show() {
  const stats = await api('/api/stats');
  const dims = state.schema?.dimensions || [];
  const role = state.user?.role;
  const personal = await personalCard(role);

  const headline = copy('home_headline', 'homeHeadline');
  const subhead = copy('home_subhead', 'homeSubhead');

  render(h('div',
    h('h1', headline && !personalRole(role) ? headline : greeting()),
    h('p.lede', personalRole(role)
      ? say(['home_subhead_personal', 'homeSubheadPersonal'], 'Your record lives here, and you help write it.')
      : (subhead || t('Everything below is computed on this machine from the records in your own folder.'))),
    role === 'admin' ? setUpCard(stats) : null,
    personal,
    personalRole(role) ? h('p.notice', { style: 'margin-top:18px' },
      t('Everything below this line is district-wide totals for every school, not your own record. No names are shown, and nobody else\u2019s record is visible here.')) : null,
    h('div.grid.four', { style: 'margin-top:14px' },
      stat(stats.students, t(personalRole(role) ? 'Students district-wide' : 'Students')),
      stat(stats.fragments, t(personalRole(role) ? 'Fragments district-wide' : 'Fragments')),
      stat(stats.schools?.length || 0, Word('school', true)),
      stat(stats.staff, Word('staff', true)),
    ),
    h('div.grid.two', { style: 'margin-top:14px' },
      outcomeCard(stats, role),
      radarCard(stats, dims),
    ),
    schoolsCard(stats, role),
    h('div', { style: 'margin-top:18px' }, await sovereigntyPanel()),
  ));
}

function greeting() {
  const hour = new Date().getHours();
  const time = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const name = state.user?.displayName || state.user?.username || '';
  return `${time}${name ? ', ' + name.split(/[\s.]/)[0] : ''}`;
}

const stat = (n, k) => h('div.stat', h('span.n', Number(n || 0).toLocaleString()), h('span.k', k));

async function personalCard(role) {
  if (!personalRole(role)) return null;
  const mine = feature('compliance') ? await myRecords() : null;
  if (role === 'student') {
    return h('div',
      h('div.card', { style: 'margin-top:14px' },
        h('h2', { style: 'margin-top:0' }, t('Your page')),
        h('p.small.muted', t('Everything your school records about you, plus whatever you want to add yourself: how a week went, work you are proud of, a photo.')),
        h('button.btn', { onclick: () => go('/me') }, t('Open my record'))),
      mine);
  }
  const { people } = await api('/api/people?limit=50');
  return h('div',
    h('div.card', { style: 'margin-top:14px' },
      h('h2', { style: 'margin-top:0' }, t('My kids')),
      people.length ? h('div.row', people.map((p) => h('button.btn.ghost', { onclick: () => go('/person/' + p.id) },
        `${displayName(p)} · ${Word('grade').toLowerCase()} ${gradeLabel(p.grade)}`))) : h('p.muted.small', t('No records are linked to this account yet. Ask the office to link them.'))),
    mine);
}

const personalRole = (role) => role === 'student' || role === 'family';

function outcomeCard(stats, role) {
  const total = Object.values(stats.outcomes || {}).reduce((a, b) => a + b, 0) || 1;
  const keys = OUTCOME_ORDER.filter((k) => stats.outcomes?.[k]);
  for (const k of Object.keys(stats.outcomes || {})) if (!keys.includes(k) && k !== '?') keys.push(k);
  return h('div.card',
    h('h2', { style: 'margin-top:0' }, t(personalRole(role) ? 'How students across the district are doing' : 'How students are doing')),
    h('p.small.muted', { style: 'margin-top:0' }, t('Patterns, not verdicts. Each one is a question for a person who knows the child.')),
    h('div.stack', keys.map((k) => {
      const n = stats.outcomes[k];
      return h('div.spread', { style: 'align-items:center;gap:8px' },
        h('span', outcomePill(k), h('span.small.muted', { style: 'margin-left:8px' }, OUTCOME_COPY[k] || '')),
        personalRole(role)
          ? h('span', h('strong', String(n)), h('span.small.muted', ` · ${Math.round((n / total) * 100)}%`))
          : h('button.linkish', { onclick: () => go('/people?outcome=' + k), style: 'text-decoration:none' },
            h('strong', String(n)), h('span.small.muted', ` · ${Math.round((n / total) * 100)}%`)));
    })),
  );
}

function radarCard(stats, dims) {
  if (!dims.length) return h('div.card', h('h2', t('Signals')), h('p.muted.small', t('The schema did not load.')));
  const present = dims.filter((d) => stats.dimMeans?.[d.key] != null).length;
  return h('div.card',
    h('h2', { style: 'margin-top:0' }, t('District signal shape')),
    h('p.small.muted', { style: 'margin-top:0' }, t(`Mean of each dimension across ${stats.students} students. ${present} of ${dims.length} dimensions have data.`)),
    radar(stats.dimMeans || {}, dims, { size: 320 }),
    domainLegend(),
  );
}

function schoolsCard(stats, role) {
  const schools = stats.schools || [];
  if (!schools.length) return null;
  const max = Math.max(...schools.map((s) => s.students), 1);
  return h('div.card', { style: 'margin-top:18px' },
    h('h2', { style: 'margin-top:0' }, Word('school', true)),
    bars(schools.map((s) => ({ label: s.name || s.id, value: s.students / max, note: t(`${s.students} students`) }))),
    personalRole(role) ? null : h('div.row', { style: 'margin-top:12px' }, schools.map((s) =>
      h('button.btn.ghost.small', { onclick: () => go('/people?schoolId=' + encodeURIComponent(s.id)) }, `${s.name || s.id}${s.level ? ' · ' + s.level : ''}`))),
  );
}

/** Admin nudge: an empty district is a wizard waiting to happen. */
function setUpCard(stats) {
  if (!feature('onboarding')) return null;
  const empty = !stats.students;
  if (!empty) {
    return h('p.small.muted', { style: 'margin:0 0 8px' },
      h('button.linkish', { onclick: () => go('/onboard') }, t('Set up: add people, paperwork and invites')));
  }
  return h('div.card', { style: 'margin-top:14px;border-left:3px solid var(--accent)' },
    h('h2', { style: 'margin-top:0' }, t('Nothing is on the record yet')),
    h('p.small.muted', { style: 'margin-top:0' },
      say(['onboarding_intro', 'onboardingIntro'], `Start with your ${edition().vocabulary.school}, add the people in it, put your paperwork where you can find it, and invite everyone to their own account.`)),
    h('div.row',
      h('button.btn', { onclick: () => go('/onboard') }, t('Set it up')),
      feature('import') ? h('button.btn.ghost', { onclick: () => go('/import') }, t('Import a vendor export')) : null));
}

/** Families and students see what the school is still waiting for. */
async function myRecords() {
  try { const { myRecordsCard } = await import('/js/compliance.js'); return await myRecordsCard(); }
  catch { return null; }
}
