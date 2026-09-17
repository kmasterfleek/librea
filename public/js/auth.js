// Sign in, and first-run bootstrap of the district admin.
import { api, h, render, status, refreshUser, state } from '/app.js';

export async function show() {
  let bootstrapped = true;
  try { ({ bootstrapped } = await api('/api/auth/status')); } catch { /* server not ready */ }
  render(bootstrapped ? signInCard() : bootstrapCard());
  document.querySelector('#view input')?.focus();
}

function shell(title, lede, ...kids) {
  return h('div.centered',
    h('div.row', { style: 'gap:10px;margin-bottom:18px' }, h('span.mark', { style: 'width:22px;height:22px' }), h('span', { style: 'font-size:1.3rem;font-weight:650' }, 'Librea')),
    h('div.card', h('h1', title), h('p.lede', lede), ...kids),
    h('p.small.muted', { style: 'margin-top:14px' }, 'This is running on your machine. Your records never leave the building unless you choose to send them.'),
  );
}

function signInCard() {
  const err = h('p.err', { role: 'alert' });
  const form = h('form', { onsubmit: onSubmit },
    field('Username', h('input', { type: 'text', id: 'u', name: 'username', autocomplete: 'username', required: true })),
    field('Password', h('input', { type: 'password', id: 'p', name: 'password', autocomplete: 'current-password', required: true })),
    err,
    h('button.btn', { type: 'submit' }, 'Sign in'),
  );
  async function onSubmit(e) {
    e.preventDefault();
    err.textContent = '';
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      await api('/api/auth/login', { method: 'POST', body: { username: form.username.value, password: form.password.value } });
      await refreshUser();
      status(`Signed in as ${state.user?.username}.`);
      window.location.hash = '#/';
      const { boot } = await import('/app.js');
      await boot();
    } catch (ex) {
      err.textContent = ex.status === 401 ? 'That username and password do not match.' : ex.message;
      btn.disabled = false;
    }
  }
  return shell('Sign in', 'Students, families, teachers and administrators each see a different slice of the same record.', form);
}

function bootstrapCard() {
  const err = h('p.err', { role: 'alert' });
  const form = h('form', { onsubmit: onSubmit },
    field('Admin username', h('input', { type: 'text', id: 'u', name: 'username', autocomplete: 'username', required: true, placeholder: 'e.g. admin' })),
    field('Password', h('input', { type: 'password', id: 'p', name: 'password', autocomplete: 'new-password', required: true, minLength: 8 }), 'At least 8 characters. Stored as a scrypt hash in your data folder.'),
    err,
    h('button.btn', { type: 'submit' }, 'Create the district admin'),
  );
  async function onSubmit(e) {
    e.preventDefault();
    err.textContent = '';
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      await api('/api/auth/bootstrap', { method: 'POST', body: { username: form.username.value, password: form.password.value } });
      await api('/api/auth/login', { method: 'POST', body: { username: form.username.value, password: form.password.value } });
      await refreshUser();
      status('District admin created. Welcome to Librea.');
      window.location.hash = '#/';
      const { boot } = await import('/app.js');
      await boot();
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
  }
  return shell('Create the district admin', 'Nobody has an account yet. The first account owns this installation — everyone else is invited from inside.', form);
}

function field(label, input, hint) {
  return h('div.field', h('label', { for: input.id }, label), input, hint ? h('p.small.muted', { style: 'margin:4px 0 0' }, hint) : null);
}
