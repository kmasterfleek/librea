// One person: the record, the questions it raises, and the timeline that the
// student, their family and their teachers write together.
import { api, h, clear, render, state, go, status, displayName, gradeLabel, outcomePill, when, questionFor, num } from '/app.js';
import { radar, domainLegend } from '/js/charts.js';
import { t, Word, say } from '/js/edition.js';
import { composer } from '/js/fragments.js';
import { recordsSection } from '/js/records.js';

export async function me() {
  const id = state.user?.entityId;
  if (!id) { render(h('div.card', h('h2', t('No record linked')), h('p.muted', t('This account is not linked to a student record yet. Ask the office to link it.')))); return; }
  return show({ args: [id], self: true });
}

export async function show({ args }) {
  const id = args[0];
  if (!id) { go('/people'); return; }
  const { person, fragments } = await api('/api/people/' + encodeURIComponent(id));
  const dims = state.schema?.dimensions || [];
  const isSelf = state.user?.entityId === person.id;
  const timeline = h('div');

  const page = h('div',
    header(person, isSelf),
    questions(person),
    creditsCard(person),
    h('div.grid.two', { style: 'margin-top:18px' }, signalCard(person, dims), metricsCard(person)),
    similarCard(person),
    recordsSection(person.id),
    h('div', { style: 'margin-top:22px' },
      h('h2', t('The record, in words')),
      h('p.lede', t('Fragments are written by teachers, by families, and by students themselves. Nobody owns this page alone.')),
      composer(person.id, () => reload()),
      timeline),
  );
  render(page);
  paint(fragments);

  function paint(list) { clear(timeline).appendChild(renderTimeline(list, reload)); }
  async function reload() {
    const fresh = await api('/api/people/' + encodeURIComponent(id));
    paint(fresh.fragments);
  }
}

function header(p, isSelf) {
  const name = displayName(p);
  const named = state.scope?.pii || isSelf || (p.firstName || p.preferredName);
  return h('div',
    h('div.spread',
      h('h1', { style: 'margin-bottom:0' }, isSelf ? t('Me') : (named ? name : p.id)),
      outcomePill(p.outcome)),
    h('p.lede', [
      isSelf && named ? name : null,
      p.grade != null ? `${Word('grade')} ${gradeLabel(p.grade)}` : null,
      p.schoolId || null,
      h('span.mono.small', { style: 'color:var(--ink-faint)' }, p.id),
    ].filter(Boolean).flatMap((x, i) => (i ? [' · ', x] : [x]))),
  );
}

function questions(p) {
  const flags = p.flags || [];
  if (!flags.length) return h('p.notice', { style: 'margin-top:14px' }, t('No pattern flags right now. That is worth noticing too.'));
  return h('div.stack', { style: 'margin-top:14px' }, flags.map((f) => h('div.question',
    h('span', { 'aria-hidden': 'true' }, '?'),
    h('div', h('p.q', questionFor(f)), h('p.why', f.reason)))));
}

/** Credit progress, when the edition's records carry it. */
function creditsCard(p) {
  const c = p.credits;
  if (!c || (c.earned == null && c.needed == null)) return null;
  const goal = (c.earned || 0) + (c.needed || 0);
  return h('div.card', { style: 'margin-top:18px' },
    h('div.grid.three',
      h('div.stat', h('span.n', String(c.earned ?? '—')), h('span.k', say(['credits_label', 'creditsLabel'], 'Credits earned'))),
      h('div.stat', h('span.n', String(goal || '—')), h('span.k', say(['credits_goal_label', 'creditsGoalLabel'], 'Credits to graduate'))),
      c.behindPace != null
        ? h('div.stat', h('span.n', { style: `color:var(${c.behindPace > 0 ? '--watch' : '--ok'})` }, String(c.behindPace)),
          h('span.k', t('Behind pace')))
        : null),
    goal ? h('progress', { value: String(c.earned || 0), max: String(goal), style: 'margin-top:12px' }) : null,
  );
}

function signalCard(p, dims) {
  const present = dims.filter((d) => p.dims?.[d.key] != null).length;
  return h('div.card',
    h('h2', { style: 'margin-top:0' }, t('Signal shape')),
    h('p.small.muted', { style: 'margin-top:0' },
      t(`${present} of ${dims.length} signals present${p.coverage != null ? ` · coverage ${Math.round(p.coverage * 100)}%` : ''}. Missing signals are drawn at the centre, not guessed.`)),
    dims.length ? radar(p.dims || {}, dims, { size: 330 }) : null,
    domainLegend(),
  );
}

function metricsCard(p) {
  const specs = state.schema?.studentMetrics || {};
  const rows = Object.keys(specs).filter((k) => p.metrics?.[k] != null);
  const derived = p.metricsSource === 'derived';
  return h('div.card',
    h('div.spread', h('h2', { style: 'margin-top:0' }, t('Structured record')),
      derived ? h('span.chip', { title: t('These numbers were computed from the attendance, incident and service rows below, not typed in by hand.') }, t('computed from records')) : null),
    rows.length ? h('div.tablewrap', { style: 'box-shadow:none' }, h('table',
      h('thead', h('tr', h('th', { scope: 'col' }, t('Measure')), h('th', { scope: 'col' }, t('Value')), h('th', { scope: 'col' }, t('Units')))),
      h('tbody', rows.map((k) => h('tr',
        h('td', labelize(k)),
        h('td', h('strong', num(p.metrics[k]))),
        h('td.small.muted.wrap', specs[k])))),
    )) : h('p.empty', t('No structured metrics have been imported for this student.')),
  );
}

const labelize = (k) => k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).replace(/ Pct$/, ' %');

function similarCard(p) {
  const body = h('div', h('p.small.muted', 'Loading…'));
  let space = 'signal';
  const tab = (key, label, hint) => h('button', {
    role: 'tab', 'aria-selected': String(space === key), title: hint,
    onclick: () => { space = key; drawTabs(); load(); },
  }, label);
  const tabs = h('div.tabs', { role: 'tablist' });
  const drawTabs = () => clear(tabs).append(
    tab('signal', t('Similar signals'), t('Nearest students in the 15-dimension signal space')),
    tab('semantic', t('Similar stories'), t('Nearest students by what has been written about them')),
  );
  drawTabs();

  async function load() {
    body.replaceChildren(h('p.small.muted', 'Loading…'));
    try {
      const { similar } = await api(`/api/people/${encodeURIComponent(p.id)}/similar?space=${space}&k=8`);
      const rows = similar.filter((s) => s.person && s.person.id !== p.id);
      if (!rows.length) { body.replaceChildren(h('p.empty', t('No comparable students yet.'))); return; }
      body.replaceChildren(h('div.tablewrap', h('table',
        h('thead', h('tr', h('th', { scope: 'col' }, state.scope?.pii ? t('Name') : Word('student')), h('th', { scope: 'col' }, Word('grade')), h('th', { scope: 'col' }, t('Pattern')), h('th', { scope: 'col' }, t('Closeness')))),
        h('tbody', rows.map((s) => h('tr.clickable', { onclick: () => go('/person/' + s.person.id) },
          h('td', state.scope?.pii ? displayName(s.person) : s.person.id),
          h('td', gradeLabel(s.person.grade)),
          h('td', outcomePill(s.person.outcome) || '—'),
          h('td', s.score.toFixed(3))))),
      )));
    } catch (e) { body.replaceChildren(h('p.err', e.message)); }
  }
  load();

  return h('div.card', { style: 'margin-top:18px' },
    h('h2', { style: 'margin-top:0' }, t('Students who look like this one')),
    h('p.small.muted', { style: 'margin-top:0' }, t('Similarity is a starting point for a conversation, not a diagnosis.')),
    tabs, body);
}

function renderTimeline(fragments, onChange) {
  const list = [...(fragments || [])].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  if (!list.length) return h('p.empty', t('Nothing written yet. The first fragment is often the most important one.'));
  return h('ul.timeline', list.map((f) => h('li.frag',
    h('header',
      h('span.chip', f.kind),
      h('span.chip.vis-' + f.visibility, visLabel(f.visibility)),
      h('span.who', f.author?.name || f.author?.id || 'unknown'),
      h('span', when(f.createdAt)),
      canRemove(f) ? h('button.linkish.del', { onclick: () => remove(f, onChange) }, t('Remove')) : null),
    f.kind === 'photo' && f.media?.path ? h('img', { src: f.media.path, alt: f.text || 'Photo', loading: 'lazy' }) : null,
    h('p', f.text),
  )));
}

const VIS = { private: 'Only them', family: 'Student and family', school: 'Shared with everyone involved', staff: 'Staff only' };
const visLabel = (v) => t(VIS[v] || v);

function canRemove(f) {
  const u = state.user;
  if (!u) return false;
  if (f.author?.id === u.username) return true;
  if (u.role === 'admin') return true;
  if (u.role === 'staff') return !['self', 'family'].includes(f.kind);
  return false;
}

async function remove(f, onChange) {
  if (!window.confirm('Remove this fragment? It is removed from the record but the ledger keeps the event.')) return;
  try {
    await api('/api/fragments/' + encodeURIComponent(f.id), { method: 'DELETE' });
    status('Fragment removed.');
    await onChange();
  } catch (e) { status(e.message, true); }
}
