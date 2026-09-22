// Build: describe the thing you want, watch it get written, then try it.
import { api, apiOptional, h, clear, render, state, status, panelMissing, go } from '/app.js';
import { t } from '/js/edition.js';

const CHIPS = {
  admin: ['A board of attendance by school this month', 'Which students have nobody writing about them?', 'A one-page summary I can bring to the board meeting'],
  staff: ['A seating chart helper for my class', 'Show me my students who are quietly slipping', 'A conference prep sheet for each family'],
  student: ['A page showing my progress this year', 'A place to collect the projects I am proud of', 'A study streak tracker'],
  family: ['A simple summary of how my kid is doing', 'A page I can show at parent-teacher night'],
};

export async function show({ query }) {
  const info = await apiOptional('/api/vibe/provider');
  if (!info) {
    render(h('div', h('h1', t('Build')), panelMissing(t('Building apps is not available yet'), t('The vibe module is not installed on this server. Once it is, you will be able to describe a tool in plain language and have it written here, on this machine.'))));
    return;
  }
  const provider = info.provider || info;
  const whatLeaves = info.whatLeaves;
  let remix = null;
  if (query.remix) remix = await apiOptional('/api/apps/' + encodeURIComponent(query.remix));

  const prompt = h('textarea', { id: 'prompt', rows: '5', placeholder: 'Describe the tool you want. Plain language is fine.' });
  if (remix?.app) prompt.value = remix.app.prompt || '';
  const title = h('input', { type: 'text', id: 'title', placeholder: 'Give it a name', value: remix?.app?.title || '' });
  const includePii = h('input', { type: 'checkbox', id: 'pii' });
  const err = h('p.err', { role: 'alert' });
  const out = h('div');
  const code = h('pre.stream', { id: 'code', tabindex: '0' });
  const codeBox = h('details', { open: true }, h('summary', 'Code as it is written'), code);
  const generate = h('button.btn', { onclick: run }, t(remix?.app ? 'Remix it' : 'Generate'));
  const canPii = ['admin', 'staff'].includes(state.user?.role);

  render(h('div',
    h('h1', remix?.app ? t('Remix ') + (remix.app.title || remix.app.slug) : t('Build something')),
    h('p.lede', 'Describe a tool the way you would describe it to a colleague. Librea writes it against your own data and keeps it here.'),
    h('div.card',
      h('div.field', h('label', { for: 'prompt' }, t('What do you want?')), prompt),
      h('div.chips', (CHIPS[state.user?.role] || CHIPS.staff).map((c) => h('button', { type: 'button', onclick: () => { prompt.value = c; prompt.focus(); } }, c))),
      h('div.inline-form', { style: 'margin-top:14px' },
        h('div', h('label', { for: 'title' }, t('Name')), title),
        canPii ? h('label.check', { style: 'flex:0 1 auto' }, includePii, 'Include names') : null,
        generate),
      h('p.small.muted', { style: 'margin-bottom:0' }, providerLine(provider, whatLeaves)),
      neverSends(whatLeaves),
      err),
    out,
  ));

  async function run() {
    if (!prompt.value.trim()) { err.textContent = 'Write a sentence about what you want first.'; prompt.focus(); return; }
    err.textContent = '';
    generate.disabled = true;
    code.textContent = '';
    clear(out).append(h('div.card', { style: 'margin-top:18px' }, h('h2', { style: 'margin-top:0' }, t('Writing it')), codeBox));
    status('Generating…');
    try {
      const done = await stream({
        prompt: prompt.value,
        title: title.value || undefined,
        slug: remix?.app?.slug || query.slug || undefined,
        includePii: canPii && includePii.checked,
      }, (text) => { code.textContent += text; code.scrollTop = code.scrollHeight; });
      status('Done.');
      out.appendChild(result(done));
    } catch (ex) { err.textContent = ex.message; status('', false); }
    generate.disabled = false;
  }
}

function providerLine(p, wl) {
  const who = p.offline ? 'Offline: apps are written from local templates.' : `Written by ${p.name}${p.model ? ' (' + p.model + ')' : ''}.`;
  const leaves = statementOf(wl) || (p.offline ? 'Nothing leaves this machine.' : 'Your prompt and a redacted description of the data shape leave the building. Names do not.');
  return `${who} ${leaves}`;
}

/** whatLeaves is an object on this server and a sentence on older ones. */
export function statementOf(wl) {
  if (!wl) return '';
  if (typeof wl === 'string') return wl;
  return wl.statement || (wl.leaves ? `What leaves: ${wl.leaves}.` : '');
}

function neverSends(wl) {
  const never = (wl && typeof wl === 'object' && wl.neverSends) || [];
  if (!never.length) return null;
  return h('p.small.muted', { style: 'margin:4px 0 0' }, 'Never sent: ' + never.join(', ') + '.');
}

/** POST + read the SSE body as a stream. EventSource cannot POST, so we parse it ourselves. */
async function stream(body, onChunk, onStart) {
  const res = await fetch('/api/vibe/generate', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    let msg = `${res.status} ${res.statusText}`;
    try { msg = (await res.json()).error || msg; } catch { /* not json */ }
    throw new Error(msg);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let done = null;
  let failure = null;
  for (;;) {
    const { value, done: finished } = await reader.read();
    if (finished) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const raw = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const event = /^event:\s*(.+)$/m.exec(raw)?.[1]?.trim() || 'message';
      const dataLines = raw.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim());
      if (!dataLines.length) continue;
      let data = {};
      try { data = JSON.parse(dataLines.join('\n')); } catch { data = { text: dataLines.join('\n') }; }
      if (event === 'chunk') onChunk(data.text || '');
      else if (event === 'start') onStart?.(data);
      else if (event === 'done') done = data;
      else if (event === 'error') failure = data.error || data.message || 'generation failed';
    }
  }
  if (failure) throw new Error(failure);
  if (!done) throw new Error('the stream ended before the app was finished');
  return done;
}

function result(done) {
  const url = done.url || '/a/' + done.slug;
  const published = h('input', { type: 'checkbox', id: 'pub', checked: !!done.published, onchange: async (e) => {
    try { await api('/api/apps/' + encodeURIComponent(done.slug) + '/publish', { method: 'POST', body: { published: e.target.checked } }); status(e.target.checked ? 'Published to your district.' : 'Unpublished.'); }
    catch (ex) { status(ex.message, true); e.target.checked = !e.target.checked; }
  } });
  return h('div.card', { style: 'margin-top:18px' },
    h('div.spread', h('h2', { style: 'margin-top:0' }, done.title || done.slug),
      h('span', done.scopeBadge ? h('span.chip', { style: 'margin-right:6px' }, done.scopeBadge) : null, h('span.chip', 'v' + (done.version ?? 1)))),
    (done.warnings || []).map((w) => h('p.notice', typeof w === 'string' ? w : w.message)),
    h('iframe.preview', { src: url, title: 'Preview of ' + (done.title || done.slug), loading: 'lazy' }),
    h('div.row', { style: 'margin-top:12px' },
      h('a.btn.ghost.small', { href: url, target: '_blank', rel: 'noopener' }, 'Open full page'),
      h('button.btn.ghost.small', { onclick: () => copy(window.location.origin + url) }, 'Copy link'),
      h('button.btn.ghost.small', { onclick: () => go('/build?remix=' + done.slug) }, 'Remix'),
      h('label.check', { style: 'margin-left:auto' }, published, 'Published')),
    h('p.small.muted', { style: 'margin-bottom:0' }, 'Published apps are visible to other people in this district, on this server. They still do not reach the internet.'),
  );
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); status('Link copied.'); }
  catch { window.prompt('Copy this link', text); }
}
