// Join: the page an invite code points at. Public — a person with a code has no
// account yet, so nothing here needs a session.
import { api, h, render, status, refreshUser, state, when } from '/app.js';
import { t, edition } from '/js/edition.js';
import { field, input } from '/js/ui.js';

const ROLE_COPY = {
  family: 'You will see your own children: everything the school records, and everything you and they add.',
  student: 'You will see your own record, and you can write in it in your own words.',
  staff: 'You will see every student here, and you can write observations on the record.',
  admin: 'You will run this installation.',
};

export async function show({ args }) {
  const code = (args[0] || '').trim().toUpperCase();
  render(shell(h('p.small.muted', 'Checking…')));
  if (!code) { render(shell(codeForm())); focusFirst(); return; }
  let invite = null;
  try { ({ invite } = await api('/api/invites/' + encodeURIComponent(code))); }
  catch { render(shell(badCode(code))); focusFirst(); return; }
  render(shell(accountForm(invite)));
  focusFirst();
}

const focusFirst = () => document.querySelector('#view input:not([disabled])')?.focus();

function shell(...kids) {
  const ed = edition();
  return h('div.centered',
    h('div.row', { style: 'gap:10px;margin-bottom:18px' },
      h('span.mark', { style: 'width:22px;height:22px' }),
      h('span', { style: 'font-size:1.3rem;font-weight:650' }, ed.theme?.logoText || ed.name)),
    h('div.card', ...kids),
    h('p.small.muted', { style: 'margin-top:14px' },
      t('This runs on a computer the school owns. Your records never leave the building unless someone there chooses to send them.')),
  );
}

function codeForm() {
  const code = input({ placeholder: 'ABCD-1234', autocomplete: 'off', required: true, style: 'text-transform:uppercase' });
  const form = h('form', { onsubmit: (e) => { e.preventDefault(); window.location.hash = '#/join/' + encodeURIComponent(code.value.trim().toUpperCase()); } },
    field('Your invite code', code, 'Whoever invited you sent this with a link.'),
    h('button.btn', { type: 'submit' }, t('Continue')),
  );
  return h('div', h('h1', t('Join')), h('p.lede', t('Someone at your school made you an invite. Enter the code and pick a login.')), form);
}

function badCode(code) {
  return h('div',
    h('h1', t('That code does not work')),
    h('p.lede', t('It may have been used already, revoked, or expired. Ask whoever sent it for a fresh one.')),
    h('p.small.muted.mono', code),
    h('a.btn.ghost', { href: '#/join' }, t('Try another code')),
  );
}

function accountForm(invite) {
  const username = input({ autocomplete: 'username', required: true, placeholder: 'something you will remember' });
  const password = h('input', { type: 'password', autocomplete: 'new-password', required: true, minLength: 8, id: 'jp' });
  const displayName = input({ value: invite.displayName || '', autocomplete: 'name' });
  const err = h('p.err', { role: 'alert' });

  const form = h('form', { onsubmit: submit },
    field('Pick a username', username),
    field('Pick a password', password, 'At least 8 characters. It is stored as a hash on the school’s machine.'),
    field('Your name', displayName, 'What other people here will see beside anything you write.'),
    err,
    h('button.btn', { type: 'submit' }, t('Make my account')),
  );

  async function submit(e) {
    e.preventDefault();
    err.textContent = '';
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await api('/api/invites/redeem', { method: 'POST', body: { code: invite.code, username: username.value.trim(), password: password.value, displayName: displayName.value.trim() } });
      await api('/api/auth/login', { method: 'POST', body: { username: username.value.trim(), password: password.value } });
      await refreshUser();
      status(t(`Welcome. You are signed in as ${state.user?.username}.`));
      window.location.hash = '#/';
      const { boot } = await import('/app.js');
      await boot();
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
  }

  return h('div',
    h('h1', t('Make your account')),
    h('p.lede', invite.displayName
      ? t(`This invite is for ${invite.displayName}.`)
      : t('This invite is waiting for you.')),
    h('p.notice', { style: 'margin-bottom:14px' },
      h('strong', t(String(invite.role))), ' · ', t(ROLE_COPY[invite.role] || 'You will see the part of the record that belongs to you.'),
      invite.expiresAt ? h('span.small.muted', { style: 'display:block;margin-top:4px' }, t('This code is good until ') + when(invite.expiresAt) + '.') : null),
    form,
  );
}
