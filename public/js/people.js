// People: filters, semantic search over fragments, and a paged table.
import { api, qs, h, clear, render, state, go, displayName, gradeLabel, outcomePill, when } from '/app.js';
import { t, Word } from '/js/edition.js';

const PAGE = 25;
const OUTCOMES = ['on-track', 'watch', 'high-risk', 'resilient', 'hidden-risk'];
const FLAGS = [
  ['chronicAbsent', 'Attendance below 90%'],
  ['highDiscipline', 'Discipline incidents'],
  ['decliningGrades', 'Grades trending down'],
  ['resilient', 'Doing well against headwinds'],
  ['hiddenRisk', 'Quietly slipping'],
];
const EXAMPLES = ['kids who love building things', 'families who moved recently', 'students who came back from a hard semester', 'someone who needs a mentor'];

/** Family view: just their own children, no filter bar. */
export async function mine() {
  const { people } = await api('/api/people?limit=100');
  render(h('div',
    h('h1', t('My kids')),
    h('p.lede', t('Everything the school records, and everything you and they have added.')),
    people.length ? h('div.grid.two', people.map((p) => h('div.card',
      h('div.spread', h('h2', { style: 'margin:0' }, displayName(p)), outcomePill(p.outcome)),
      h('p.small.muted', t(`Grade ${gradeLabel(p.grade)}`) + (p.schoolId ? ' · ' + p.schoolId : '')),
      h('button.btn.ghost.small', { onclick: () => go('/person/' + p.id) }, t('Open record')),
    ))) : h('p.empty', t('No records are linked to this account yet.')),
  ));
}

export async function show({ query }) {
  const tab = query?.tab === 'families' ? 'families' : 'students';
  const tabs = h('div.tabs', { role: 'tablist' },
    h('button', { role: 'tab', 'aria-selected': String(tab === 'students'), onclick: () => go('/people') }, Word('student', true)),
    h('button', { role: 'tab', 'aria-selected': String(tab === 'families'), onclick: () => go('/people?tab=families') }, t('Families')),
  );
  if (tab === 'families') { await showFamilies(tabs); return; }
  await showStudents({ query }, tabs);
}

async function showFamilies(tabs) {
  const { people } = await api('/api/people?type=family&limit=200');
  render(h('div',
    h('h1', t('People')),
    tabs,
    h('p.lede', t('Every family on the record, and how many students each one speaks for.')),
    people.length
      ? h('div.tablewrap', h('table',
        h('thead', h('tr', [t('Family'), t('Grown-ups'), Word('student', true), t('Id')].map((x) => h('th', { scope: 'col' }, x)))),
        h('tbody', people.map((f) => h('tr.clickable', {
          tabindex: '0',
          onclick: () => go('/family/' + f.id),
          onkeydown: (e) => { if (e.key === 'Enter') go('/family/' + f.id); },
        },
          h('td', h('strong', f.name || f.id)),
          h('td.wrap', (f.members || []).map((m) => m.name).filter(Boolean).join(', ') || '—'),
          h('td', String((f.students || []).length)),
          h('td', h('span.mono.small', f.id)))))))
      : h('p.empty', t('No families yet. Create one in the setup wizard.')),
  ));
}

async function showStudents({ query }, tabs) {
  const stats = await api('/api/stats').catch(() => ({ schools: [] }));
  const f = { schoolId: '', grade: '', outcome: '', flag: '', q: '', ...query };
  delete f.tab;
  let offset = 0;

  const results = h('div');
  const searchResults = h('div');
  const countLine = h('p.small.muted');

  const search = searchBox(f, (rows, q) => renderSearch(searchResults, rows, q, f));
  const controls = filterBar(stats, f, () => { offset = 0; loadTable(); search.rerun(); });

  render(h('div',
    h('h1', t('People')),
    tabs,
    h('p.lede', t('Filter by the structured record, or ask in plain language and search what people have actually written.')),
    search.node,
    searchResults,
    controls,
    countLine,
    results,
  ));
  loadTable();

  async function loadTable() {
    syncHash(f);
    clear(results).appendChild(h('p.empty', 'Loading…'));
    const data = await api('/api/people' + qs({ type: 'student', ...f, limit: PAGE, offset }));
    countLine.textContent = data.total
      ? t(`${data.total} student${data.total === 1 ? '' : 's'}`) + ` · ${t('showing')} ${offset + 1}–${Math.min(offset + PAGE, data.total)}`
      : t('No students match these filters.');
    clear(results);
    if (!data.people.length) { results.appendChild(h('p.empty', t('Nothing here. Try widening the filters.'))); return; }
    results.appendChild(table(data.people));
    results.appendChild(pager(data.total));
  }

  function pager(total) {
    const back = h('button.btn.ghost.small', { disabled: offset === 0, onclick: () => { offset = Math.max(0, offset - PAGE); loadTable(); } }, t('Previous'));
    const next = h('button.btn.ghost.small', { disabled: offset + PAGE >= total, onclick: () => { offset += PAGE; loadTable(); } }, t('Next'));
    return h('div.row', { style: 'margin-top:12px;justify-content:flex-end' }, back, next);
  }
}

function syncHash(f) {
  const s = qs(f);
  const target = '#/people' + s;
  if (window.location.hash !== target) history.replaceState(null, '', target);
}

function filterBar(stats, f, onChange) {
  const bind = (key) => (e) => { f[key] = e.target.value; onChange(); };
  const schools = stats.schools || [];
  const grades = [...Array(15).keys()].map((i) => i - 1);
  return h('div.card', { style: 'margin:18px 0' },
    h('div.inline-form',
      labelled(t('Name or id'), h('input', { type: 'search', id: 'f-q', value: f.q, placeholder: t('Search the roster'), oninput: debounce(bind('q'), 300) })),
      labelled(Word('school'), select('f-school', [['', t('Any school')], ...schools.map((s) => [s.id, s.name || s.id])], f.schoolId, bind('schoolId'))),
      labelled(Word('grade'), select('f-grade', [['', t('Any grade')], ...grades.map((g) => [String(g), gradeLabel(g)])], f.grade, bind('grade'))),
      labelled(t('Pattern'), select('f-outcome', [['', t('Any pattern')], ...OUTCOMES.map((o) => [o, o.replace('-', ' ')])], f.outcome, bind('outcome'))),
      labelled(t('Flag'), select('f-flag', [['', t('Any flag')], ...FLAGS], f.flag, bind('flag'))),
      h('button.btn.ghost.small', {
        onclick: () => { for (const k of Object.keys(f)) f[k] = ''; for (const el of document.querySelectorAll('.inline-form select, .inline-form input')) el.value = ''; onChange(); },
      }, t('Clear')),
    ));
}

const labelled = (text, input) => h('div', h('label', { for: input.id }, text), input);

function select(id, options, value, onchange) {
  const el = h('select', { id, onchange }, options.map(([v, label]) => h('option', { value: v }, label)));
  el.value = value || '';
  return el;
}

function searchBox(filters, onResults) {
  const input = h('input', { type: 'search', id: 'sem-q', placeholder: t('kids who love building things'), 'aria-label': 'Search what people have written' });
  const out = h('div');
  const run = async (q) => {
    input.value = q;
    if (!q.trim()) return onResults(null);
    out.replaceChildren(h('p.small.muted', 'Searching…'));
    try {
      // The filter bar narrows the search too: same school, grade, pattern, flag.
      const { results } = await api('/api/search' + qs({
        q, k: 12, type: 'student',
        schoolId: filters.schoolId, grade: filters.grade, outcome: filters.outcome, flag: filters.flag,
      }));
      out.replaceChildren();
      onResults(results, q);
    } catch (e) { out.replaceChildren(h('p.err', e.message)); }
  };
  const form = h('form', { onsubmit: (e) => { e.preventDefault(); run(input.value); } },
    h('div.inline-form', h('div', { style: 'flex:3 1 260px' }, h('label', { for: 'sem-q' }, t('Ask in plain language')), input), h('button.btn', { type: 'submit' }, t('Search'))),
    h('div.chips', { style: 'margin-top:10px' }, EXAMPLES.map((ex) => h('button', { type: 'button', onclick: () => run(t(ex)) }, t(ex)))),
    out,
  );
  return { node: h('div.card', form), rerun: () => { if (input.value.trim()) run(input.value); } };
}

function renderSearch(container, results, q, filters) {
  clear(container);
  if (!results) return;
  const narrowing = narrowedBy(filters);
  if (!results.length) {
    container.appendChild(h('p.empty', `Nothing written matches “${q}”${narrowing ? ' ' + narrowing : ''} yet.`));
    return;
  }
  container.appendChild(h('div', { style: 'margin-top:16px' },
    h('h2', t('Written about') + ` “${q}”`),
    narrowing ? h('p.small.muted', { style: 'margin-top:-6px' }, t('Narrowed to ') + narrowing.replace(/^in /, '') + '. Clear the filters to search everyone.') : null,
    h('div.stack', results.map((r) => h('div.card',
      h('div.spread',
        h('button.linkish', { onclick: () => go('/person/' + r.person.id), style: 'text-decoration:none;font-weight:650;font-size:1rem;color:var(--ink)' },
          displayName(r.person)),
        h('span.small.muted', `match ${r.score.toFixed(2)}`)),
      h('p.small.muted', { style: 'margin:0' }, `Grade ${gradeLabel(r.person.grade)}${r.person.schoolId ? ' · ' + r.person.schoolId : ''}`),
      (r.fragments || []).slice(0, 2).map((fr) => h('div.snippet',
        h('span.chip', fr.kind), ' ',
        h('span.small.muted', `${fr.author?.name || fr.author?.id || 'unknown'} · ${when(fr.createdAt)} · ${fr.score != null ? fr.score.toFixed(2) : ''}`),
        h('p', { style: 'margin:4px 0 0' }, snippet(fr.text)))),
    ))),
  ));
}

function narrowedBy(f) {
  if (!f) return '';
  const bits = [];
  if (f.schoolId) bits.push(f.schoolId);
  if (f.grade !== '' && f.grade != null) bits.push('grade ' + gradeLabel(Number(f.grade)));
  if (f.outcome) bits.push(f.outcome.replace('-', ' '));
  if (f.flag) bits.push('flag ' + f.flag);
  return bits.length ? 'in ' + bits.join(', ') : '';
}

const snippet = (text) => (text || '').length > 260 ? text.slice(0, 260).trimEnd() + '…' : text || '';

function table(people) {
  const showNames = state.scope?.pii;
  return h('div.tablewrap', h('table',
    h('thead', h('tr', [showNames ? 'Name' : Word('student'), Word('grade'), Word('school'), 'Pattern', 'Questions', 'Coverage'].map((label) => h('th', { scope: 'col' }, t(label))))),
    h('tbody', people.map((p) => h('tr.clickable', {
      tabindex: '0',
      onclick: () => go('/person/' + p.id),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go('/person/' + p.id); } },
    },
      h('td', h('strong', showNames ? displayName(p) : p.id), showNames ? h('span.small.muted', { style: 'display:block' }, p.id) : null),
      h('td', gradeLabel(p.grade)),
      h('td', p.schoolId || '—'),
      h('td', outcomePill(p.outcome) || '—'),
      h('td', String((p.flags || []).length || '—')),
      h('td', p.coverage != null ? Math.round(p.coverage * 100) + '%' : '—'),
    ))),
  ));
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
