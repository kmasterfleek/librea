// Apps: everything anyone in this district has built, on this machine.
import { api, apiOptional, h, render, state, status, go, when, panelMissing } from '/app.js';

export async function show() {
  const data = await apiOptional('/api/apps');
  if (!data) {
    render(h('div', h('h1', 'Apps'), panelMissing('The app gallery is not available yet', 'The vibe module is not installed on this server. Once it is, everything built here will be listed on this page.')));
    return;
  }
  const apps = data.apps || [];
  render(h('div',
    h('div.spread', h('h1', 'Apps'), h('button.btn', { onclick: () => go('/build') }, 'Build something')),
    h('p.lede', 'Tools people here have made for themselves. Each one runs on this server, against this district’s data, under the scope it declared.'),
    apps.length ? h('div.grid.two', apps.map(card)) : h('p.empty', 'Nothing built yet. The first one usually takes a sentence.'),
  ));
}

function card(app) {
  const canDelete = app.editable ?? (app.author?.username === state.user?.username || state.user?.role === 'admin');
  const url = app.url || '/a/' + app.slug;
  return h('div.card',
    h('div.spread',
      h('h2', { style: 'margin:0;font-size:1.05rem' }, app.title || app.slug),
      h('span', app.mode === 'design' ? h('span.chip', { style: 'margin-right:6px', title: 'Designed without seeing the data, then bound to queries here' }, 'Design') : null, h('span.chip', app.published ? 'Published' : 'Draft'))),
    h('p.small.muted', { style: 'margin:2px 0 8px' },
      `${app.author?.username || 'someone'} · ${app.author?.role || ''} · updated ${when(app.updatedAt || app.createdAt)} · v${app.version ?? 1}`),
    h('p.small', { style: 'margin:0 0 10px' }, app.prompt ? truncate(app.prompt, 180) : ''),
    h('div.row', app.scopeBadge ? [h('span.chip', { title: 'What this app is allowed to see' }, app.scopeBadge), ...scopeBadges(app.scope)] : scopeBadges(app.scope)),
    h('div.row', { style: 'margin-top:12px' },
      h('a.btn.ghost.small', { href: url, target: '_blank', rel: 'noopener' }, 'Open'),
      app.mode === 'design'
        ? (canDelete ? h('button.btn.ghost.small', { onclick: () => go('/design?slug=' + app.slug) }, app.unbound?.length ? 'Bind data' : 'Data sources') : h('button.btn.ghost.small', { onclick: () => go('/design') }, 'Reuse design'))
        : h('button.btn.ghost.small', { onclick: () => go('/build?remix=' + app.slug) }, 'Remix'),
      canDelete ? h('button.btn.danger.small', { onclick: (e) => remove(app, e.target) }, 'Delete') : null),
  );
}

function scopeBadges(scope) {
  const s = scope || {};
  const out = [];
  if (s.aggregatesOnly) out.push(['Aggregates only', 'This app never sees an individual record.']);
  if (s.pii === false) out.push(['No names', 'Identifiers are stripped before this app sees anything.']);
  if (Array.isArray(s.visibility) && s.visibility.length) out.push([s.visibility.join(', '), 'Fragment audiences this app may read.']);
  if (Array.isArray(s.entityIds) && s.entityIds.length) out.push([`${s.entityIds.length} specific students`, 'This app is limited to these records.']);
  if (!out.length) out.push(['Viewer’s own scope', 'This app sees exactly what the person opening it may see, and never more.']);
  return out.map(([label, title]) => h('span.chip', { title }, label));
}

const truncate = (s, n) => (s.length > n ? s.slice(0, n).trimEnd() + '…' : s);

async function remove(app, btn) {
  if (!window.confirm(`Delete “${app.title || app.slug}”? The link stops working for everyone here.`)) return;
  btn.disabled = true;
  try {
    await api('/api/apps/' + encodeURIComponent(app.slug), { method: 'DELETE' });
    status('Deleted.');
    await show();
  } catch (e) { status(e.message, true); btn.disabled = false; }
}
