// One family: the grown-ups, the children linked to them, and the invite that
// gets them their own account.
import { api, h, clear, render, state, go, status, displayName, gradeLabel, outcomePill } from '/app.js';
import { t, Word, feature } from '/js/edition.js';
import { input, debounce, table } from '/js/ui.js';

export async function show({ args }) {
  const id = args[0];
  if (!id) { go('/people'); return; }
  const data = await api('/api/families/' + encodeURIComponent(id));
  const isStaff = ['admin', 'staff'].includes(state.user?.role);
  const kids = h('div');
  const invite = h('div');

  render(h('div',
    h('h1', data.family.name || t('Family')),
    h('p.lede', h('span.mono.small', { style: 'color:var(--ink-faint)' }, data.family.id)),
    membersCard(data.family),
    h('h2', Word('student', true)),
    kids,
    isStaff ? h('div.card', { style: 'margin-top:18px' },
      h('h3', { style: 'margin-top:0' }, t('Link another student')),
      linker(data.family.id, reload)) : null,
    isStaff && feature('invites') ? h('div', { style: 'margin-top:18px' },
      h('h3', t('Give this family an account')),
      h('button.btn.ghost', { onclick: () => makeInvite(data.family, invite, data.students) }, t('Make an invite')),
      invite) : null,
  ));
  paint(data.students);

  function paint(students) {
    clear(kids).appendChild(students.length
      ? table([
        [(p) => displayName(p), 'Name'],
        ['grade', 'Grade', gradeLabel],
        ['schoolId', 'School'],
        [(p) => outcomePill(p.outcome) || '—', 'Pattern'],
      ], students, (p) => go('/person/' + p.id))
      : h('p.empty', t('No students are linked to this family yet.')));
  }

  async function reload() {
    const fresh = await api('/api/families/' + encodeURIComponent(id));
    data.family = fresh.family;
    paint(fresh.students);
  }
}

function membersCard(family) {
  const members = family.members || [];
  return h('div.card',
    h('h2', { style: 'margin-top:0' }, t('Grown-ups')),
    members.length
      ? table([['name', 'Name'], ['relation', 'Relation'], ['email', 'Email'], ['phone', 'Phone'], ['language', 'Language']], members)
      : h('p.empty', t('No grown-ups are recorded on this family yet.')));
}

/** Search students and link one to this family; the server links both ways. */
function linker(familyId, onLinked) {
  const search = input({ type: 'search', placeholder: t('Search students by name or id') });
  const results = h('div.chips', { style: 'margin-top:8px' });
  search.addEventListener('input', debounce(async () => {
    const q = search.value.trim();
    if (!q) { clear(results); return; }
    const { people } = await api(`/api/people?type=student&q=${encodeURIComponent(q)}&limit=8`);
    clear(results).append(...people.map((p) => h('button', { type: 'button', onclick: () => link(p) },
      `${displayName(p)} · ${gradeLabel(p.grade)} · ${p.id}`)));
    if (!people.length) results.appendChild(h('span.small.muted', t('No students match that.')));
  }, 300));

  async function link(p) {
    try {
      await api(`/api/families/${encodeURIComponent(familyId)}/students`, { method: 'POST', body: { studentId: p.id } });
      status(t(`${displayName(p)} is linked to this family.`));
      search.value = ''; clear(results);
      await onLinked();
    } catch (e) { status(e.message, true); }
  }
  return h('div', search, results);
}

async function makeInvite(family, host, students = []) {
  clear(host).appendChild(h('p.small.muted', 'Loading…'));
  try {
    const { inviteCard } = await import('/js/invites.js');
    const { inviteContext } = await import('/js/onboard-records.js');
    const ctx = await inviteContext();
    const who = family.name || (family.members || [])[0]?.name || family.id;
    const { invite } = await api('/api/invites', { method: 'POST', body: { role: 'family', entityIds: family.students?.length ? family.students : [family.id], displayName: who, days: 14 } });
    clear(host).appendChild(inviteCard(invite, { ...ctx, who, child: students.map(displayName).join(' and ') }));
  } catch (e) { clear(host).appendChild(h('p.err', e.message)); }
}
