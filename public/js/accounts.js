// Accounts: who can sign in, which record each account speaks for, and how to
// change that. Every account is local to this installation.
import { api, qs, h, clear, render, status, displayName, gradeLabel } from '/app.js';
import { t, feature } from '/js/edition.js';

const ROLES = ['staff', 'student', 'family', 'admin'];
const ROLE_COPY = {
  admin: 'Runs the district. Sees everything, including staff-only notes and the ledger.',
  staff: 'Teachers and counselors. Sees every student, writes observations and staff-only notes.',
  student: 'Sees only their own record, and writes in their own voice.',
  family: 'Sees only their own children, and writes what school does not see.',
};

let panel; let list;

export async function show() {
  panel = h('div');
  list = h('div');
  render(h('div',
    h('h1', t('Accounts')),
    h('p.lede', t('Every account is local to this installation. There is no directory to sync and no vendor holding the password file.')),
    panel,
    feature('invites') ? h('p.small.muted', { style: 'margin:0' },
      t('Or send someone a code and let them pick their own password: '),
      h('a', { href: '#/onboard/share' }, t('make an invite'))) : null,
    h('h2', t('People who can sign in')),
    list,
  ));
  showCreate();
  await refresh();
}

const showCreate = () => clear(panel).appendChild(userForm(null));
const showEdit = (user) => { clear(panel).appendChild(userForm(user)); panel.scrollIntoView?.(); };

async function refresh() {
  clear(list).appendChild(h('p.empty', 'Loading…'));
  const { users } = await api('/api/users');
  clear(list).appendChild(h('div.tablewrap', h('table',
    h('thead', h('tr', ['Username', 'Name', 'Role', 'Linked records', 'Status', ''].map((label) => h('th', { scope: 'col' }, t(label))))),
    h('tbody', users.map(row)),
  )));
}

function row(u) {
  const active = u.active !== false;
  return h('tr',
    h('td', h('strong', u.username)),
    h('td', u.displayName || '—'),
    h('td', h('span.chip', { title: t(ROLE_COPY[u.role] || '') }, u.role)),
    h('td.wrap.small.muted', linkedIds(u).join(', ') || '—'),
    h('td', h('span', { style: `color:var(${active ? '--ok' : '--ink-faint'});font-weight:600;font-size:.82rem` }, active ? t('Active') : t('Deactivated'))),
    h('td', h('div.row', { style: 'gap:6px;flex-wrap:nowrap' },
      h('button.btn.ghost.small', { onclick: () => showEdit(u) }, t('Edit')),
      h('button.' + (active ? 'btn.danger.small' : 'btn.ghost.small'), { onclick: (e) => setActive(u, !active, e.target) }, active ? t('Deactivate') : t('Reactivate')))),
  );
}

const linkedIds = (u) => [u.entityId, ...(u.entityIds || [])].filter(Boolean);

async function setActive(u, active, btn) {
  if (active === false && !window.confirm(`Deactivate ${u.username}? They stay in the record but can no longer sign in.`)) return;
  btn.disabled = true;
  try {
    await api('/api/users/' + encodeURIComponent(u.username), { method: 'PUT', body: { active } });
    status(`${u.username} is now ${active ? 'active' : 'deactivated'}.`);
    await refresh();
  } catch (e) { status(e.message, true); btn.disabled = false; }
}

/** One form for both cases: user === null means "invite someone". */
function userForm(user) {
  const editing = !!user;
  const username = h('input', { type: 'text', id: 'nu', autocomplete: 'off', required: true, value: user?.username || '', disabled: editing });
  const displayNameIn = h('input', { type: 'text', id: 'nd', autocomplete: 'off', value: user?.displayName || '' });
  const password = h('input', { type: 'password', id: 'np', autocomplete: 'new-password', minLength: 8, required: !editing });
  const role = h('select', { id: 'nr', onchange: () => syncRole() }, ROLES.map((r) => h('option', { value: r }, r)));
  role.value = user?.role || 'staff';
  const roleHint = h('p.small.muted', { style: 'margin:4px 0 0' });
  const linkBox = h('div.field');
  const err = h('p.err', { role: 'alert' });
  const chosen = h('div.chips', { style: 'margin-top:8px' });
  let picked = editing ? linkedIds(user) : [];

  const form = h('form', { onsubmit: submit },
    h('div.inline-form',
      h('div', h('label', { for: 'nu' }, t('Username')), username),
      h('div', h('label', { for: 'nd' }, t('Display name')), displayNameIn),
      h('div', h('label', { for: 'np' }, t(editing ? 'New password' : 'Password')), password),
      h('div', h('label', { for: 'nr' }, t('Role')), role)),
    editing ? h('p.small.muted', { style: 'margin:4px 0 0' }, t('Leave the password blank to keep the current one.')) : null,
    roleHint,
    linkBox,
    err,
    h('div.row', { style: 'margin-top:12px' },
      h('button.btn', { type: 'submit' }, t(editing ? 'Save changes' : 'Create account')),
      editing ? h('button.btn.ghost', { type: 'button', onclick: showCreate }, t('Cancel')) : null),
  );
  syncRole(true);

  function syncRole(first = false) {
    roleHint.textContent = t(ROLE_COPY[role.value] || '');
    if (!first) picked = [];
    drawChosen();
    clear(linkBox);
    if (role.value === 'student' || role.value === 'family') linkBox.appendChild(picker(role.value));
  }

  function picker(kind) {
    const search = h('input', { type: 'search', id: 'link', placeholder: t('Search by name or id'), oninput: debounce(run, 300) });
    const results = h('div.chips', { style: 'margin-top:8px' });
    async function run() {
      const q = search.value.trim();
      if (!q) { clear(results); return; }
      const { people } = await api('/api/people' + qs({ type: 'student', q, limit: 8 }));
      clear(results).append(...people.map((p) => h('button', {
        type: 'button',
        onclick: () => { if (!picked.includes(p.id)) { picked.push(p.id); drawChosen(); } },
      }, `${displayName(p)} · grade ${gradeLabel(p.grade)} · ${p.id}`)));
      if (!people.length) results.appendChild(h('span.small.muted', t('No students match that.')));
    }
    return h('div',
      h('label', { for: 'link' }, t(kind === 'student' ? 'Link to this student’s record' : 'Link to this family’s children')),
      search, results, chosen,
      h('p.small.muted', { style: 'margin:6px 0 0' }, t(kind === 'student'
        ? 'A student account sees exactly one record: their own.'
        : 'A family account sees only the children linked here.')));
  }

  function drawChosen() {
    clear(chosen);
    if (!picked.length) return;
    chosen.appendChild(h('span.small.muted', { style: 'align-self:center' }, t('Linked:')));
    for (const id of picked) {
      chosen.appendChild(h('button', { type: 'button', title: 'Remove', onclick: () => { picked.splice(picked.indexOf(id), 1); drawChosen(); } }, id + ' ✕'));
    }
  }

  async function submit(e) {
    e.preventDefault();
    err.textContent = '';
    const body = { role: role.value, displayName: displayNameIn.value || '' };
    if (!editing) { body.username = username.value; body.password = password.value; }
    else if (password.value) body.password = password.value;
    if (role.value === 'student') {
      if (!picked.length) { err.textContent = t('Link this account to a student record first.'); return; }
      body.entityId = picked[0];
      body.entityIds = [];
    } else if (role.value === 'family') {
      if (!picked.length) { err.textContent = t('Link this account to at least one child.'); return; }
      body.entityId = null;
      body.entityIds = [...picked];
    } else { body.entityId = null; body.entityIds = []; }
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      if (editing) await api('/api/users/' + encodeURIComponent(user.username), { method: 'PUT', body });
      else await api('/api/users', { method: 'POST', body });
      status(editing ? `Saved ${user.username}.` : `Created ${body.username}.`);
      showCreate();
      await refresh();
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
  }

  return h('div.card', { style: 'margin:18px 0' },
    h('h2', { style: 'margin-top:0' }, editing ? t('Edit ') + user.username : t('Invite someone')),
    form);
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
