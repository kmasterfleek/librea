// The from-scratch wizard. Which screens appear, and in what order, is the
// edition's business; this file only knows how to walk through them.
import { h, clear, render, go } from '/app.js';
import { t, edition, say } from '/js/edition.js';
import * as PEOPLE from '/js/onboard-people.js';
import * as MORE from '/js/onboard-records.js';

/** Canonical screens, and the words an edition might use for each. */
const SYNONYMS = {
  organization: ['organization', 'organisation', 'org', 'school', 'district', 'community', 'pod', 'site', 'program', 'campus', 'centre', 'center'],
  people: ['people', 'person', 'student', 'learner', 'kid', 'child', 'youth', 'roster', 'enrollment', 'enrolment', 'member'],
  staff: ['staff', 'guide', 'teacher', 'adult', 'team', 'educator', 'mentor', 'facilitator'],
  families: ['family', 'guardian', 'parent', 'household', 'caregiver'],
  records: ['record', 'paperwork', 'document', 'file', 'health', 'immunization', 'immunisation', 'credential', 'plan'],
  drills: ['drill', 'safety', 'emergency'],
  compliance: ['compliance', 'legit', 'requirement', 'audit', 'checklist'],
  share: ['share', 'invite', 'account', 'login', 'people-in'],
  apps: ['app', 'build', 'tool'],
};

const SCREENS = {
  organization: PEOPLE.organization,
  people: PEOPLE.people,
  staff: PEOPLE.staff,
  families: PEOPLE.families,
  records: MORE.records,
  drills: MORE.drills,
  compliance: MORE.compliance,
  share: MORE.share,
  apps: MORE.apps,
};

const HEADINGS = {
  organization: 'Your school',
  people: 'Your students',
  staff: 'Your staff',
  families: 'Families',
  records: 'Records on file',
  drills: 'Safety drills',
  compliance: 'What you have to be able to show',
  share: 'Bring everyone in',
  apps: 'Build something',
};

const singular = (s) => String(s).toLowerCase().replace(/ies$/, 'y').replace(/s$/, '');

/** Build word -> canonical once, including whatever this edition renamed things to. */
function resolver() {
  const map = new Map();
  for (const [canon, words] of Object.entries(SYNONYMS)) for (const w of words) map.set(singular(w), canon);
  for (const [base, to] of Object.entries(edition().vocabulary || {})) {
    const canon = map.get(singular(base));
    if (canon && !map.has(singular(to))) map.set(singular(to), canon);
  }
  return (name) => {
    const s = singular(name);
    if (map.has(s)) return map.get(s);
    for (const [wordKey, canon] of map) if (s.includes(wordKey) || wordKey.includes(s)) return canon;
    return 'records';
  };
}

/** The ordered list of steps for this edition: { key, canon, label }. */
export function steps() {
  const resolve = resolver();
  const raw = edition().onboarding?.steps || ['organization', 'people', 'families', 'compliance', 'apps'];
  const seen = new Set();
  const out = [];
  for (const name of raw) {
    let canon = resolve(name);
    while (seen.has(canon)) canon = canon + '+'; // two steps that resolve the same still each get a screen
    const real = canon.replace(/\+$/, '');
    seen.add(canon);
    out.push({ key: name, canon: real, label: t(titleCase(String(name))) });
  }
  return out.filter((s) => SCREENS[s.canon]);
}

const titleCase = (s) => s.replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase());

export async function show({ args }) {
  const list = steps();
  const wanted = (args[0] || '').toLowerCase();
  let index = list.findIndex((s) => s.canon === wanted || s.key.toLowerCase() === wanted);
  if (index < 0) index = 0;

  const body = h('div');
  const nav = h('ol.steps');
  const page = h('div',
    h('h1', say(['onboarding_title', 'onboardingTitle'], 'Set up')),
    h('p.lede', say(['onboarding_intro', 'onboardingIntro'], 'Start with your school, add the people in it, put your paperwork where you can find it, and invite everyone to their own account. Nothing here needs an IT department.')),
    nav, body);
  render(page);
  draw();

  function draw() {
    clear(nav);
    list.forEach((s, i) => nav.appendChild(h('li', { class: i === index ? 'now' : (i < index ? 'done' : '') },
      h('button.linkish', { onclick: () => { index = i; draw(); } }, `${i + 1}. ${s.label}`))));
    clear(body).appendChild(h('p.small.muted', 'Loading…'));
    const step = list[index];
    Promise.resolve(SCREENS[step.canon]())
      .then((node) => {
        clear(body).append(
          h('h2', { style: 'margin-top:1em' }, t(HEADINGS[step.canon] || step.label)),
          node,
          footer(),
        );
      })
      .catch((e) => clear(body).appendChild(h('p.err', e.message)));
  }

  function footer() {
    const last = index >= list.length - 1;
    return h('div.row', { style: 'margin-top:22px;justify-content:space-between' },
      h('button.btn.ghost', { disabled: index === 0, onclick: () => { index--; draw(); } }, t('Back')),
      last
        ? h('button.btn', { onclick: () => go('/') }, t('Done — take me home'))
        : h('button.btn', { onclick: () => { index++; draw(); } }, t('Next: ') + list[index + 1].label),
    );
  }
}
