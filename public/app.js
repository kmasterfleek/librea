// Librea shell: tiny hash router, API helper, shared state and DOM helpers.
// Everything here is vanilla and local. No bundler, no CDN, no telemetry.

import { loadEdition, edition, feature, t } from '/js/edition.js';

export const state = { user: null, scope: null, schema: null, ready: false };
export { edition, feature, t };

// ---------- DOM ----------

/** h('div.card', {onclick}, 'text', node) — the only templating we need. */
export function h(spec, attrs, ...kids) {
  const [tag, ...classes] = String(spec).split('.');
  const node = document.createElement(tag || 'div');
  if (classes.length) node.className = classes.join(' ');
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className += (node.className ? ' ' : '') + v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k in node && k !== 'list' && k !== 'form' && k !== 'type' && k !== 'size') node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  add(node, kids);
  return node;
}
function add(node, kids) {
  for (const kid of kids.flat(4)) {
    if (kid == null || kid === false) continue;
    node.appendChild(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
}
export const frag = (...kids) => { const f = document.createDocumentFragment(); add(f, kids); return f; };
export const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); return node; };

/** aria-live status line at the top of the page. */
export function status(msg, isError = false) {
  const el = document.getElementById('status');
  el.textContent = msg || '';
  el.classList.toggle('err', !!isError);
  if (msg && !isError) setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 5000);
}

// ---------- API ----------

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function api(path, { method = 'GET', body, raw = false } = {}) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(path, opts);
  if (raw) return res;
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new ApiError(res.status, data?.error || `${res.status} ${res.statusText}`);
  return data;
}

/** GET that tolerates a module that is not installed yet (sibling still building). */
export async function apiOptional(path) {
  try { return await api(path); } catch (e) { if (e.status === 404) return null; throw e; }
}

export const qs = (obj) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v != null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? '?' + s : '';
};

// ---------- formatting ----------

export const gradeLabel = (g) => (g == null ? '—' : g === 0 ? 'K' : g === -1 ? 'PK' : String(g));
export const displayName = (p) => {
  if (!p) return '';
  const n = [p.preferredName || p.firstName, p.lastName].filter(Boolean).join(' ').trim();
  return n || p.id;
};
export const pct = (v, digits = 0) => (v == null ? '—' : (v * 100).toFixed(digits) + '%');
export const num = (v, digits = 2) => (v == null ? '—' : typeof v === 'number' ? String(+v.toFixed(digits)) : String(v));
export function when(iso) {
  if (!iso) return '';
  // A bare YYYY-MM-DD is a calendar date, not an instant: parse it locally so a
  // form filled in on the 15th does not read back as the 14th.
  const plain = /^\d{4}-\d{2}-\d{2}$/.test(String(iso));
  const d = plain ? new Date(`${iso}T00:00:00`) : new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
export const outcomePill = (o) => (o ? h('span.pill.' + o, o.replace('-', ' ')) : null);

/** Flags are questions for a person, never verdicts. */
const QUESTIONS = {
  chronicAbsent: 'Attendance is below 90% — worth a conversation?',
  highDiscipline: 'Several discipline incidents on record — what is going on around them?',
  decliningGrades: 'Grades have been trending down — has something changed?',
  resilient: 'Doing well against real headwinds — who should hear about that?',
  hiddenRisk: 'Grades look fine, but wellness signals are slipping — is anyone checking in?',
};
export const questionFor = (flag) => QUESTIONS[flag.key] || `${flag.reason} — worth a look?`;

// ---------- pages ----------

const view = () => document.getElementById('view');

export function render(node) {
  const v = clear(view());
  v.appendChild(node);
  window.scrollTo(0, 0);
}

export function loading(label = 'Loading…') {
  render(h('p.empty', label));
}

export function panelMissing(title, detail) {
  return h('div.card', h('h3', title), h('p.muted.small', detail));
}

// ---------- routing ----------

const ROUTES = [
  { path: 'home', load: () => import('/js/home.js'), nav: 'Home', roles: '*' },
  { path: 'people', load: () => import('/js/people.js'), nav: 'People', roles: ['admin', 'staff'] },
  { path: 'mine', load: () => import('/js/people.js'), fn: 'mine', nav: 'My kids', roles: ['family'] },
  { path: 'person', load: () => import('/js/person.js') },
  { path: 'family', load: () => import('/js/family.js') },
  { path: 'me', load: () => import('/js/person.js'), fn: 'me', nav: 'Me', roles: ['student'] },
  { path: 'onboard', load: () => import('/js/onboard.js'), nav: 'Set up', roles: ['admin'], feature: 'onboarding' },
  { path: 'compliance', load: () => import('/js/compliance.js'), nav: 'Compliance', roles: ['admin', 'staff'], feature: 'compliance' },
  { path: 'data', load: () => import('/js/data.js'), nav: 'Data', roles: '*', feature: 'sql' },
  { path: 'import', load: () => import('/js/import.js'), nav: 'Import', roles: ['admin'], feature: 'import' },
  { path: 'build', load: () => import('/js/build.js'), nav: 'Build', roles: '*', feature: 'vibe' },
  { path: 'apps', load: () => import('/js/apps.js'), nav: 'Apps', roles: '*', feature: 'vibe' },
  { path: 'accounts', load: () => import('/js/accounts.js'), nav: 'Accounts', roles: ['admin'] },
  { path: 'join', load: () => import('/js/join.js'), public: true },
];

const allowed = (r) => r.nav && (r.roles === '*' || r.roles.includes(state.user?.role)) && (!r.feature || feature(r.feature));

export const go = (hash) => { window.location.hash = hash.startsWith('#') ? hash : '#' + hash; };

function parseHash() {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [pathPart, queryPart] = raw.split('?');
  const segs = pathPart.split('/').filter(Boolean);
  return { name: segs[0] || 'home', args: segs.slice(1).map(decodeURIComponent), query: Object.fromEntries(new URLSearchParams(queryPart || '')) };
}

let token = 0;
async function route() {
  const mine = ++token;
  const { name, args, query } = parseHash();
  const r = ROUTES.find((x) => x.path === name) || ROUTES[0];
  // A join link works before anyone has an account: that is the whole point of it.
  if (!state.user && !r.public) { (await import('/js/auth.js')).show(); return; }
  if (state.user && r.roles && r.roles !== '*' && !r.roles.includes(state.user.role) && r.path !== 'person') {
    render(h('div.card', h('h2', 'Not your page'), h('p.muted', `This page is for ${[].concat(r.roles).join(' and ')} accounts.`)));
    return;
  }
  if (r.feature && !feature(r.feature)) {
    render(h('div.card', h('h2', 'Not part of this edition'), h('p.muted', `${edition().name} does not include this page.`)));
    return;
  }
  markNav(r.path);
  loading();
  try {
    const mod = await r.load();
    if (mine !== token) return;
    await (mod[r.fn || 'show'] || mod.show)({ args, query });
  } catch (e) {
    if (mine !== token) return;
    if (e.status === 401) { state.user = null; (await import('/js/auth.js')).show(); return; }
    render(h('div.card', h('h2', 'That did not load'), h('p.err', e.message), h('button.btn.ghost', { onclick: () => route() }, 'Try again')));
  }
}

function markNav(path) {
  for (const a of document.querySelectorAll('#mainnav a')) {
    const target = a.getAttribute('href').replace(/^#\//, '').split('/')[0];
    if (target === path) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  document.getElementById('mainnav').classList.remove('open');
}

export function chrome() {
  const signedIn = !!state.user;
  document.getElementById('topbar').hidden = !signedIn;
  document.getElementById('foot').hidden = !signedIn;
  if (!signedIn) return;
  const nav = clear(document.getElementById('mainnav'));
  for (const r of ROUTES.filter(allowed)) nav.appendChild(h('a', { href: '#/' + r.path }, t(r.nav)));
  document.getElementById('whoami').textContent = `${state.user.displayName || state.user.username} · ${state.user.role}`;
}

/** Re-read the session, then draw. Called at boot and after sign in/out. */
export async function refreshUser() {
  try {
    const me = await api('/api/auth/me');
    state.user = me.user;
    state.scope = me.scope;
  } catch { state.user = null; state.scope = null; }
  if (state.user && !state.schema) { try { state.schema = await api('/api/schema'); } catch { /* optional */ } }
  chrome();
}

export async function boot() {
  await loadEdition();
  await refreshUser();
  await route();
}

window.addEventListener('hashchange', route);
document.getElementById('navtoggle').addEventListener('click', (e) => {
  const nav = document.getElementById('mainnav');
  nav.classList.toggle('open');
  e.target.setAttribute('aria-expanded', String(nav.classList.contains('open')));
});
document.getElementById('signout').addEventListener('click', async () => {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* already gone */ }
  state.user = null; state.scope = null; state.schema = null;
  chrome();
  window.location.hash = '#/';
  (await import('/js/auth.js')).show();
});

boot();
