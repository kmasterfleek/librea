// Design → Data. Step one: describe a page and get a design that knows nothing
// about the district's data. Step two: bind each region to a query, here,
// with the real rows in view before anything is saved.
import { api, apiOptional, h, clear, render, state, status, panelMissing, go } from '/app.js';
import { statementOf } from '/js/build.js';

const CHIPS = {
  admin: ['A board attendance report by school this month', 'A one-page district overview for the board meeting', 'A page tracking which services students receive'],
  staff: ['A picture of attendance in my building', 'A conference prep sheet layout for families', 'Where my students stand this term'],
  student: ['A page showing my progress this year', 'My attendance and recent work'],
  family: ['A simple summary of how my kid is doing'],
};
const KIND_WORDS = { stat: 'one number', bar: 'bar chart', line: 'line over time', table: 'table', list: 'list', text: 'paragraph' };

export async function show({ query }) {
  const info = await apiOptional('/api/vibe/design/provider');
  if (!info) { render(h('div', h('h1', 'Design'), panelMissing('Designing pages is not available yet', 'The vibe module is not installed on this server.'))); return; }
  if (query.slug) { await bindPage(query.slug); return; }
  await designPage(info, query);
}

// ------------------------------------------------------------------ step one

async function designPage(info, query) {
  const provider = info.provider;
  const revise = query.revise ? await apiOptional('/api/apps/' + encodeURIComponent(query.revise)) : null;
  const prompt = h('textarea', { id: 'prompt', rows: '5', placeholder: 'Describe the page you want to see. Plain language is fine.' });
  if (revise?.app) prompt.value = '';
  const title = h('input', { type: 'text', id: 'title', placeholder: 'Give it a name', value: revise?.app?.title || '' });
  const includePii = h('input', { type: 'checkbox', id: 'pii' });
  const canPii = ['admin', 'staff'].includes(state.user?.role);
  const err = h('p.err', { role: 'alert' });
  const out = h('div');
  const code = h('pre.stream', { id: 'code', tabindex: '0' });
  const button = h('button.btn', { onclick: run }, revise?.app ? 'Revise the design' : 'Design it');
  const gallery = h('div');

  render(h('div',
    h('h1', revise?.app ? 'Revise ' + (revise.app.title || revise.app.slug) : 'Design a page'),
    h('p.lede', 'Two steps. First a design: layout, type, color, with placeholder regions. Then you bind each region to your own data, here, and see the real rows before anyone else does.'),
    h('div.card',
      h('div.field', h('label', { for: 'prompt' }, revise?.app ? 'What should change?' : 'What do you want to see?'), prompt),
      h('div.chips', (CHIPS[state.user?.role] || CHIPS.staff).map((c) => h('button', { type: 'button', onclick: () => { prompt.value = c; prompt.focus(); } }, c))),
      h('div.inline-form', { style: 'margin-top:14px' },
        h('div', h('label', { for: 'title' }, 'Name'), title),
        canPii ? h('label.check', { style: 'flex:0 1 auto' }, includePii, 'Include names') : null,
        button),
      h('p.small.muted', { style: 'margin-bottom:0' }, providerLine(provider, info.whatLeaves)),
      neverSends(info.whatLeaves),
      err),
    out,
    gallery,
  ));
  loadGallery(gallery);

  async function run() {
    if (!prompt.value.trim()) { err.textContent = 'Write a sentence about what you want first.'; prompt.focus(); return; }
    err.textContent = ''; button.disabled = true; code.textContent = '';
    clear(out).append(h('div.card', { style: 'margin-top:18px' }, h('h2', { style: 'margin-top:0' }, 'Designing it'), h('details', { open: true }, h('summary', 'The design as it is written'), code)));
    status('Designing…');
    try {
      const done = await stream('/api/vibe/design', { prompt: prompt.value, title: title.value || undefined, slug: revise?.app?.slug || undefined, includePii: canPii && includePii.checked },
        (text) => { code.textContent += text; code.scrollTop = code.scrollHeight; });
      status('Design saved. Now bind the data.');
      go('/design?slug=' + done.slug);
    } catch (ex) { err.textContent = ex.message; status('', false); }
    button.disabled = false;
  }
}

async function loadGallery(root) {
  const data = await apiOptional('/api/designs');
  const designs = data?.designs || [];
  if (!designs.length) return;
  clear(root).append(h('div.card', { style: 'margin-top:18px' },
    h('h2', { style: 'margin-top:0' }, 'Or start from a design already here'),
    h('p.small.muted', 'Reusing a design makes no outside call at all. You get the layout with every region empty, then bind your own data.'),
    h('div.grid.two', designs.map((d) => h('div.card',
      h('div.spread', h('strong', d.title), h('span.chip', `${d.slots.length} regions`)),
      h('p.small.muted', { style: 'margin:4px 0 8px' }, `${d.author?.username || 'someone'} · ${d.provider === 'gallery' ? 'reused' : d.provider}`),
      h('p.small', { style: 'margin:0 0 10px' }, d.slots.map((s) => s.label).join(' · ')),
      h('button.btn.ghost.small', { onclick: async (e) => {
        e.target.disabled = true;
        try { const r = await api('/api/vibe/design/reuse', { method: 'POST', body: { from: d.slug } }); go('/design?slug=' + r.app.slug); }
        catch (ex) { status(ex.message, true); e.target.disabled = false; }
      } }, 'Use this design'),
    ))),
  ));
}

// ------------------------------------------------------------------ step two

async function bindPage(slug) {
  const data = await api('/api/apps/' + encodeURIComponent(slug) + '/bindings');
  const drafts = {};
  for (const s of data.slots) drafts[s.id] = data.bindings[s.id] || data.proposals[s.id]?.binding || null;
  const preview = h('iframe.preview', { src: data.url + '?v=' + data.version, title: 'Preview of ' + data.title });
  const err = h('p.err', { role: 'alert' });
  const published = h('input', { type: 'checkbox', id: 'pub', checked: !!data.published, onchange: publish });
  const save = h('button.btn', { onclick: saveAll }, 'Save data sources');
  const rows = data.slots.map((s) => slotRow(s, data, drafts));

  render(h('div',
    h('div.spread', h('h1', data.title), h('span', h('span.chip', { style: 'margin-right:6px' }, data.scopeBadge), h('span.chip', 'v' + data.version))),
    h('p.lede', 'Each region below needs a data source. Suggested queries come from a fixed catalog on this machine; edit them, preview the real rows, then save. Nothing on this page reaches a model provider.'),
    h('div.card', h('h2', { style: 'margin-top:0' }, 'The design, with sample data'), preview,
      h('p.small.muted', 'Sample rows are shown only to you, only while a region is unbound. A published page never shows them.')),
    h('div.stack', rows.map((r) => r.node)),
    h('div.card', { style: 'margin-top:18px' },
      h('div.row', save,
        h('a.btn.ghost.small', { href: data.url, target: '_blank', rel: 'noopener' }, 'Open full page'),
        h('button.btn.ghost.small', { onclick: () => go('/design?revise=' + data.slug) }, 'Revise the design'),
        h('label.check', { style: 'margin-left:auto' }, published, 'Published')),
      h('p.small.muted', { style: 'margin-bottom:0' }, 'A page can be published once every region has a data source. Published pages are visible to people in this district, on this server only.'),
      err),
    schemaPanel(data.schema),
  ));

  async function saveAll() {
    err.textContent = ''; save.disabled = true;
    const bindings = {};
    for (const r of rows) { const b = r.read(); if (b) bindings[r.slot.id] = b; }
    try {
      const res = await fetch('/api/apps/' + encodeURIComponent(slug) + '/bindings', { method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bindings }) });
      const j = await res.json();
      if (!res.ok) {
        for (const r of rows) r.problems(j.problems?.[r.slot.id] || []);
        throw new Error(j.error || 'could not save');
      }
      for (const r of rows) r.problems([]);
      status(j.unbound.length ? `Saved. Still empty: ${j.unbound.join(', ')}.` : 'Saved. Every region has a data source.');
      preview.src = data.url + '?v=' + data.version + '&t=' + Date.now();
    } catch (ex) { err.textContent = ex.message; }
    save.disabled = false;
  }

  async function publish(e) {
    try { await api('/api/apps/' + encodeURIComponent(slug) + '/publish', { method: 'POST', body: { published: e.target.checked } }); status(e.target.checked ? 'Published to your district.' : 'Unpublished.'); }
    catch (ex) { err.textContent = ex.message; e.target.checked = !e.target.checked; }
  }
}

function slotRow(slot, data, drafts) {
  const draft = drafts[slot.id];
  const proposal = data.proposals[slot.id];
  const bound = !!data.bindings[slot.id];
  const mode = draft?.aggregate ? 'aggregate' : draft?.text != null ? 'text' : 'sql';
  const sqlBox = h('textarea', { rows: '4', style: 'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.85rem', placeholder: 'SELECT … one read-only query. Name the columns the region expects.' });
  if (mode === 'sql' && draft?.sql) sqlBox.value = draft.sql;
  const textBox = h('textarea', { rows: '3', placeholder: 'Write the paragraph that belongs here.' });
  if (mode === 'text') textBox.value = draft.text;
  const aggNote = mode === 'aggregate' ? h('p.notice', `Group students by ${draft.aggregate.groupBy}, ${draft.aggregate.metric === 'count' ? 'counting them' : 'averaging ' + draft.aggregate.metric}. Groups smaller than five are withheld. `, h('button.linkish', { type: 'button', onclick: () => { aggNote.hidden = true; sqlBox.hidden = false; state_.mode = 'sql'; } }, 'Write SQL instead')) : null;
  const state_ = { mode };
  sqlBox.hidden = mode !== 'sql';
  textBox.hidden = mode !== 'text';
  const result = h('div');
  const problems = h('div');
  const expects = slot.kind === 'table' ? 'columns ' + slot.columns.map((c) => c.key).join(', ') : slot.kind === 'stat' ? 'one row with a value' : slot.kind === 'text' ? 'rows with text' : slot.kind === 'list' ? 'title, subtitle, meta' : 'label and value';

  const node = h('div.card',
    h('div.spread', h('h2', { style: 'margin:0;font-size:1.05rem' }, slot.label),
      h('span', h('span.chip', KIND_WORDS[slot.kind] || slot.kind), ' ', h('span.chip', bound ? 'bound' : proposal ? 'suggested' : 'needs a source'))),
    slot.hint ? h('p.small.muted', { style: 'margin:4px 0 8px' }, '“' + slot.hint + '” · expects ' + expects) : h('p.small.muted', 'Expects ' + expects),
    proposal && !bound ? h('p.small', { style: 'margin:0 0 8px' }, 'Suggested: ' + proposal.why + '.') : null,
    aggNote, sqlBox, textBox,
    h('div.row', { style: 'margin-top:8px' },
      slot.kind === 'text' && state_.mode !== 'text' ? h('button.btn.ghost.small', { onclick: () => { state_.mode = 'text'; sqlBox.hidden = true; textBox.hidden = false; } }, 'Use plain text') : null,
      h('button.btn.ghost.small', { onclick: run }, 'Preview real rows')),
    problems, result,
  );

  function read() {
    if (state_.mode === 'aggregate') return { aggregate: draft.aggregate };
    if (state_.mode === 'text') return textBox.value.trim() ? { text: textBox.value } : null;
    return sqlBox.value.trim() ? { sql: sqlBox.value } : null;
  }
  function showProblems(list) {
    clear(problems);
    for (const p of list) problems.appendChild(h('p.notice.bad', p));
  }
  async function run() {
    const binding = read();
    if (!binding) { showProblems(['Write a query first.']); return; }
    clear(result).append(h('p.small.muted', 'Running…'));
    try {
      const r = await api('/api/apps/' + encodeURIComponent(data.slug) + '/bindings/preview', { method: 'POST', body: { slotId: slot.id, binding } });
      showProblems(r.problems || []);
      clear(result);
      if (r.error) return;
      const shown = (r.rows || []).slice(0, 8);
      const cols = shown.length ? Object.keys(shown[0]) : (r.columns || []);
      result.appendChild(h('p.small.muted', `${r.rowCount ?? r.rows.length} row${r.rowCount === 1 ? '' : 's'}${r.truncated ? ' (truncated)' : ''}${r.ms != null ? ' · ' + r.ms + ' ms' : ''}${r.note ? ' · ' + r.note : ''}`));
      if (shown.length) result.appendChild(h('div.tablewrap', h('table', h('thead', h('tr', cols.map((c) => h('th', c)))), h('tbody', shown.map((row) => h('tr', cols.map((c) => h('td', String(row[c] ?? '')))))))));
      else result.appendChild(h('p.empty', 'No rows in your scope. The region will show its empty state.'));
    } catch (ex) { clear(result); showProblems([ex.message]); }
  }
  return { slot, node, read, problems: showProblems };
}

function schemaPanel(schema) {
  if (!schema) return null;
  return h('details.card', { style: 'margin-top:18px' }, h('summary', 'Tables you can query (' + schema.dialect + ')'),
    h('p.small.muted', schema.notes.join(' ')),
    h('div.stack', schema.tables.map((t) => h('div', h('strong', t.name), h('span.small.muted', ' — ' + t.doc), h('p.small', { style: 'margin:2px 0 0;font-family:ui-monospace,monospace' }, t.columns.join(', '))))));
}

// ------------------------------------------------------------------ helpers

function providerLine(p, wl) {
  const who = p.offline ? 'Offline: designs come from built-in layouts.' : `Designed by ${p.name}${p.model ? ' (' + p.model + ')' : ''}.`;
  return `${who} ${statementOf(wl)}`;
}
function neverSends(wl) {
  const never = wl?.neverSends || [];
  return never.length ? h('p.small.muted', { style: 'margin:4px 0 0' }, 'Never sent: ' + never.join(', ') + '.') : null;
}

async function stream(url, body, onChunk) {
  const res = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify(body) });
  if (!res.ok || !res.body) { let msg = `${res.status} ${res.statusText}`; try { msg = (await res.json()).error || msg; } catch { /* not json */ } throw new Error(msg); }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '', done = null, failure = null;
  for (;;) {
    const { value, done: finished } = await reader.read();
    if (finished) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const raw = buf.slice(0, i); buf = buf.slice(i + 2);
      const event = /^event:\s*(.+)$/m.exec(raw)?.[1]?.trim() || 'message';
      const lines = raw.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim());
      if (!lines.length) continue;
      let d = {}; try { d = JSON.parse(lines.join('\n')); } catch { d = { text: lines.join('\n') }; }
      if (event === 'chunk') onChunk(d.text || '');
      else if (event === 'done') done = d;
      else if (event === 'error') failure = d.error || 'design failed';
    }
  }
  if (failure) throw new Error(failure);
  if (!done) throw new Error('the stream ended before the design was finished');
  return done;
}
