// Import: paste, pick or try a sample CSV, check the mapping Librea guessed,
// then apply it. Nothing is written until you have looked at it.
import { api, apiOptional, h, clear, render, status, panelMissing } from '/app.js';
import { t } from '/js/edition.js';

let csv = '';
let preview = null;
let presets = null;

const KIND_LABEL = { students: 'Students', staff: 'Staff', attendance: 'Attendance', grades: 'Grades', discipline: 'Discipline', orgs: 'Schools and orgs' };

export async function show() {
  presets = await apiOptional('/api/import/presets');
  const stage = h('div');
  render(h('div',
    h('h1', t('Import')),
    h('p.lede', t('Bring a roster or an export from your old system. Librea guesses the mapping, shows you what it guessed, and never writes anything you have not looked at.')),
    presets ? sourceCard(stage) : panelMissing(t('Import is not available yet'), t('The import module is not installed on this server. Once it is, this page will read a CSV, show you the mapping and apply it.')),
    stage,
  ));
}

function sourceCard(stage) {
  const paste = h('textarea', { id: 'csv', rows: '8', placeholder: 'student_id,first_name,last_name,grade,gpa\n…', oninput: (e) => { csv = e.target.value; } });
  const setCsv = (text, label) => {
    csv = text;
    paste.value = text.length > 40000 ? text.slice(0, 40000) + '\n… (truncated for display; the whole file is still imported)' : text;
    status(`${label} — ${Math.max(0, text.split(/\r?\n/).filter(Boolean).length - 1)} data rows.`);
  };
  const file = h('input', {
    type: 'file', id: 'csvfile', accept: '.csv,text/csv,text/plain',
    onchange: async (e) => { const f = e.target.files?.[0]; if (f) setCsv(await f.text(), 'Read ' + f.name); },
  });
  const presetSel = h('select', { id: 'preset' },
    h('option', { value: '' }, 'Detect automatically'),
    (presets.presets || []).map((p) => h('option', { value: p.id }, p.label || p.name || p.id)));
  const kinds = (presets.kinds || ['students']).filter((k) => k !== 'unknown');
  const kindSel = h('select', { id: 'kind' }, h('option', { value: '' }, 'Detect automatically'), kinds.map((k) => h('option', { value: k }, KIND_LABEL[k] || k)));
  const err = h('p.err', { role: 'alert' });
  const samples = h('div.chips', { style: 'margin-top:8px' });

  apiOptional('/api/import/samples').then((s) => {
    if (!s?.samples?.length) return;
    samples.append(h('span.small.muted', { style: 'align-self:center' }, 'Or try a sample:'), ...s.samples.map((sm) =>
      h('button', { type: 'button', onclick: async () => { const got = await api('/api/import/samples/' + encodeURIComponent(sm.name)); setCsv(got.csv, 'Loaded ' + sm.name); } }, sm.name)));
  }).catch(() => {});

  const go = h('button.btn', {
    onclick: async () => {
      err.textContent = '';
      if (!csv.trim()) { err.textContent = 'Choose a file, paste some CSV, or try a sample first.'; return; }
      go.disabled = true;
      clear(stage).appendChild(h('p.empty', 'Reading the file…'));
      try {
        preview = await api('/api/import/preview', { method: 'POST', body: { csv, preset: presetSel.value || undefined, kind: kindSel.value || undefined } });
        clear(stage).appendChild(previewCard(stage));
      } catch (ex) { clear(stage); err.textContent = ex.message; }
      go.disabled = false;
    },
  }, 'Preview');

  return h('div.card',
    h('h2', { style: 'margin-top:0' }, '1 · The file'),
    h('div.field', h('label', { for: 'csvfile' }, 'Choose a CSV'), file, samples),
    h('div.field', h('label', { for: 'csv' }, 'Or paste it here'), paste),
    h('div.inline-form',
      h('div', h('label', { for: 'preset' }, 'Source system'), presetSel),
      h('div', h('label', { for: 'kind' }, 'These rows are'), kindSel),
      go),
    err,
  );
}

function previewCard(stage) {
  const p = preview;
  const fields = p.fields || Object.keys(p.mapping || {});
  const headers = p.headers || [];
  const mapping = { ...(p.mapping || {}) };

  const mapRows = fields.map((field) => {
    const sel = h('select', {
      'aria-label': `Source column for ${field}`,
      onchange: (e) => { mapping[field] = e.target.value || null; },
    }, h('option', { value: '' }, '— not imported —'), headers.map((hd) => h('option', { value: hd }, hd)));
    sel.value = mapping[field] || '';
    return h('tr', h('td', h('strong', labelize(field))), h('td', sel), h('td.small.muted', sampleOf(p, field)));
  });

  const dryRun = h('input', { type: 'checkbox', id: 'dry', checked: true });
  const result = h('div');
  const apply = h('button.btn', {
    onclick: async () => {
      apply.disabled = true;
      clear(result).appendChild(h('p.empty', 'Working…'));
      try {
        const out = await api('/api/import/apply', { method: 'POST', body: { csv, mapping, kind: p.kind, preset: p.preset, dryRun: dryRun.checked } });
        clear(result).appendChild(applyResult(out));
        if (out.jobId) trackJob(out.jobId, result);
      } catch (ex) { clear(result).appendChild(h('p.err', ex.message)); }
      apply.disabled = false;
    },
  }, 'Apply');

  return h('div', { style: 'margin-top:18px' },
    h('div.card',
      h('h2', { style: 'margin-top:0' }, '2 · What Librea read'),
      h('p.small.muted',
        `Detected ${p.preset ? `“${p.preset}”` : 'no known source'}${p.confidence != null ? ` (confidence ${Math.round(p.confidence * 100)}%)` : ''} · ${p.rowCount ?? '?'} rows · these look like ${KIND_LABEL[p.kind]?.toLowerCase() || p.kind} records.`),
      (p.warnings || []).length ? h('div.stack', p.warnings.map((w) => h('p.notice', typeof w === 'string' ? w : w.message))) : null,
      (p.unmapped || []).length ? h('p.small.muted', 'Columns Librea did not recognise, which will be ignored: ' + p.unmapped.join(', ')) : null,
      h('h3', 'Mapping'),
      h('p.small.muted', { style: 'margin-top:0' }, 'Change anything that looks wrong. Fields left unmapped are not imported.'),
      h('div.tablewrap', h('table',
        h('thead', h('tr', h('th', { scope: 'col' }, 'Librea field'), h('th', { scope: 'col' }, 'Your column'), h('th', { scope: 'col' }, 'First value'))),
        h('tbody', mapRows))),
      sampleTable(p, fields),
    ),
    h('div.card', { style: 'margin-top:18px' },
      h('h2', { style: 'margin-top:0' }, '3 · Apply'),
      h('label.check', dryRun, 'Dry run — count everything, change nothing'),
      h('div.row', { style: 'margin-top:12px' }, apply, h('button.btn.ghost', { onclick: () => { preview = null; clear(stage); } }, 'Start over')),
      result,
    ),
  );
}

const labelize = (k) => k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).replace(/ Pct$/, ' %');

function sampleOf(p, field) {
  const row = (p.sampleRows || [])[0];
  const v = row?.[field];
  return v == null || v === '' ? '' : String(v).slice(0, 40);
}

function sampleTable(p, fields) {
  const rows = p.sampleRows || [];
  if (!rows.length) return null;
  const cols = fields.filter((f) => rows.some((r) => r[f] != null && r[f] !== ''));
  return h('details', { style: 'margin-top:14px' },
    h('summary', `Show the first ${rows.length} rows as Librea would read them`),
    h('div.tablewrap', { style: 'margin-top:8px' }, h('table',
      h('thead', h('tr', cols.map((c) => h('th', { scope: 'col' }, labelize(c))))),
      h('tbody', rows.map((r) => h('tr', cols.map((c) => h('td', String(r[c] ?? '')))))))),
  );
}

function applyResult(out) {
  const errors = out.errors || [];
  return h('div', { style: 'margin-top:14px' },
    h('p.notice', out.dryRun ? 'Dry run — nothing was written.' : 'Applied to your records.'),
    (out.warnings || []).map((w) => h('p.small.muted', typeof w === 'string' ? w : w.message)),
    h('div.grid.three', { style: 'margin-top:10px' },
      h('div.stat', h('span.n', String(out.created ?? 0)), h('span.k', 'Created')),
      h('div.stat', h('span.n', String(out.updated ?? 0)), h('span.k', 'Updated')),
      h('div.stat', h('span.n', String(out.skipped ?? 0)), h('span.k', 'Skipped'))),
    errors.length ? h('div', { style: 'margin-top:12px' },
      h('h3', `${errors.length} row${errors.length === 1 ? '' : 's'} could not be read`),
      h('div.tablewrap', h('table',
        h('thead', h('tr', h('th', { scope: 'col' }, 'Row'), h('th', { scope: 'col' }, 'Why'))),
        h('tbody', errors.slice(0, 50).map((e) => h('tr', h('td', String(e.row ?? e.entityId ?? '—')), h('td.wrap', e.message))))))) : null,
  );
}

/** After a real import the slow semantic work runs as a job; watch it finish. */
function trackJob(jobId, container) {
  const bar = h('progress', { id: 'jobbar', max: 1, value: 0 });
  const line = h('p.small.muted', 'Writing a record fragment for each student…');
  container.appendChild(h('div', { style: 'margin-top:14px' }, h('label', { for: 'jobbar' }, 'Understanding the new records'), bar, line));
  const tick = async () => {
    try {
      const { job } = await api('/api/import/jobs/' + encodeURIComponent(jobId));
      const total = job.total || 1;
      bar.value = Math.min(1, (job.done || 0) / total);
      const errs = (job.errors || []).length;
      line.textContent = `${job.done || 0} of ${total} students · ${job.status || 'running'}${errs ? ` · ${errs} could not be described` : ''}`;
      if (['done', 'failed'].includes(job.status)) { status('Import ' + job.status + '.'); return; }
    } catch (e) { line.textContent = 'Lost track of the job: ' + e.message; return; }
    setTimeout(tick, 700);
  };
  tick();
}
