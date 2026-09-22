// One generic form per fact table. The columns are known here so the labels can
// be friendly; anything unknown falls back to the SQL schema the server ships.
import { api, h, clear, status } from '/app.js';
import { t } from '/js/edition.js';
import { field, input, select, uid } from '/js/ui.js';

const S = 'studentSourcedId', O = 'orgSourcedId';

/** table -> { title, note, subject, fields: [name, label, type, options?] }. */
export const FORMS = {
  documents: {
    title: 'Document on file', note: 'Enrollment forms, emergency cards, consents, custody papers, residency proof.',
    subject: 'subjectSourcedId',
    fields: [
      ['subjectType', 'This is about a', 'select', ['student', 'staff', 'organization']],
      ['subjectSourcedId', 'Student or staff id', 'text'],
      ['type', 'Kind of document', 'suggest', ['enrollment-form', 'emergency-card', 'consent', 'custody', 'residency', 'photo-release', 'health-plan', 'handbook-signature', 'affidavit', 'insurance']],
      ['title', 'Title', 'text'],
      ['status', 'Status', 'select', ['on-file', 'missing', 'expired', 'waived']],
      ['issuedDate', 'Signed or issued', 'date'],
      ['expiresDate', 'Expires', 'date'],
      ['path', 'Where the paper or scan lives', 'text'],
      ['note', 'Note', 'textarea'],
    ],
  },
  immunizations: {
    title: 'Immunization', note: 'A shot on record, or the exemption that stands in for it.',
    subject: S,
    fields: [
      [S, 'Student id', 'text'],
      ['vaccine', 'Vaccine', 'suggest', ['DTaP', 'Polio', 'MMR', 'Varicella', 'Hepatitis B', 'Hepatitis A', 'Tdap', 'Meningococcal', 'HPV', 'Influenza']],
      ['date', 'Date given', 'date'],
      ['doseNumber', 'Dose number', 'number'],
      ['exemption', 'Exemption', 'select', ['none', 'medical', 'religious', 'personal']],
      ['verifiedBy', 'Verified by', 'text'],
      ['note', 'Note', 'textarea'],
    ],
  },
  staff_credentials: {
    title: 'Staff credential', note: 'Background checks, fingerprinting, CPR, mandated-reporter training, certificates.',
    subject: 'staffSourcedId',
    fields: [
      ['staffSourcedId', 'Staff id', 'text'],
      ['type', 'Credential', 'suggest', ['background-check', 'fingerprinting', 'CPR', 'first-aid', 'mandated-reporter', 'teaching-certificate', 'TB-clearance']],
      ['status', 'Status', 'select', ['valid', 'pending', 'expired', 'missing']],
      ['issuedDate', 'Issued', 'date'],
      ['expiresDate', 'Expires', 'date'],
      ['issuer', 'Issued by', 'text'],
      ['note', 'Note', 'textarea'],
    ],
  },
  learning_plans: {
    title: 'Learning plan', note: 'What this student is working toward, and when it gets looked at again.',
    subject: S,
    fields: [
      [S, 'Student id', 'text'],
      ['type', 'Kind of plan', 'select', ['ILP', 'IEP', '504', 'BSP', 'transition', 'credit-recovery']],
      ['title', 'Title', 'text'],
      ['status', 'Status', 'select', ['active', 'draft', 'closed']],
      ['startDate', 'Starts', 'date'],
      ['reviewDate', 'Next review', 'date'],
      ['goals', 'Goals', 'textarea'],
      ['owner', 'Who owns it', 'text'],
      ['note', 'Note', 'textarea'],
    ],
  },
  drills: {
    title: 'Safety drill', note: 'Fire, earthquake, lockdown, evacuation — the practice you have to be able to show.',
    subject: O,
    fields: [
      [O, 'School id', 'text'],
      ['type', 'Drill', 'select', ['fire', 'earthquake', 'lockdown', 'evacuation', 'shelter-in-place', 'inspection']],
      ['date', 'Date', 'date'],
      ['durationMinutes', 'Minutes it took', 'number'],
      ['participants', 'People taking part', 'number'],
      ['ledBy', 'Led by', 'text'],
      ['note', 'Note', 'textarea'],
    ],
  },
  enrollment_events: {
    title: 'Enrollment event', note: 'Joining, leaving, transferring, graduating — with the reason.',
    subject: S,
    fields: [
      [S, 'Student id', 'text'],
      [O, 'School id', 'text'],
      ['event', 'What happened', 'select', ['enrolled', 'withdrawn', 'transferred', 'graduated', 're-enrolled']],
      ['date', 'Date', 'date'],
      ['reason', 'Reason', 'text'],
      ['nextSchool', 'Where they went next', 'text'],
      ['note', 'Note', 'textarea'],
    ],
  },
  contacts: {
    title: 'Contact', note: 'Guardians and emergency contacts: who may be called, and who may collect.',
    subject: S,
    fields: [
      [S, 'Student id', 'text'],
      ['name', 'Name', 'text'],
      ['relation', 'Relation', 'suggest', ['mother', 'father', 'guardian', 'grandparent', 'aunt', 'uncle', 'neighbour', 'emergency']],
      ['email', 'Email', 'text'],
      ['phone', 'Phone', 'text'],
      ['language', 'Language they prefer', 'text'],
      ['isPrimary', 'Primary contact', 'check'],
    ],
  },
  services: {
    title: 'Service', note: 'Programs and supports: IEP, 504, ELL, counselling.',
    subject: S,
    fields: [
      [S, 'Student id', 'text'],
      ['type', 'Service', 'select', ['IEP', '504', 'ELL', 'FRL', 'gifted', 'counseling', 'other']],
      ['level', 'Level', 'text'],
      ['startDate', 'From', 'date'],
      ['endDate', 'Until', 'date'],
      ['provider', 'Provider', 'text'],
      ['note', 'Note', 'textarea'],
    ],
  },
};

export const FORM_TABLES = Object.keys(FORMS);
export const formTitle = (table) => t(FORMS[table]?.title || labelize(table));
const labelize = (k) => String(k).replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim();

let schemaCache = null;
/** Columns for a table we have no hand-written spec for. */
async function generic(table) {
  if (!schemaCache) schemaCache = await api('/api/sql/schema').catch(() => ({ tables: [] }));
  const found = (schemaCache.tables || []).find((x) => x.name === table);
  if (!found) return null;
  return { title: labelize(table), note: found.doc, subject: found.columns.find((c) => /SourcedId$/.test(c)), fields: found.columns.filter((c) => c !== 'id').map((c) => [c, labelize(c), 'text']) };
}

const newRowId = (table) => `${table.slice(0, 4).replace(/_/g, '')}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`.toUpperCase();

/**
 * A form that upserts one row into a fact table.
 * opts: { prefill, onSaved, compact } — prefill keys are column names.
 */
export async function recordForm(table, { prefill = {}, onSaved, heading = true } = {}) {
  const spec = FORMS[table] || await generic(table);
  if (!spec) return h('p.err', `No form for ${table}.`);
  const controls = new Map();
  const err = h('p.err', { role: 'alert' });

  for (const [name, label, type, options] of spec.fields) {
    controls.set(name, control(name, type, options, prefill[name]));
  }

  const form = h('form', { onsubmit: submit },
    h('div.formgrid', spec.fields.map(([name, label, type]) =>
      h('div', { style: type === 'textarea' ? 'grid-column:1/-1' : null }, wrap(label, controls.get(name), type)))),
    err,
    h('div.row', { style: 'margin-top:10px' }, h('button.btn', { type: 'submit' }, t('Save ' + (spec.title || table).toLowerCase()))),
  );

  function wrap(label, ctl, type) {
    if (type === 'check') return h('div.field', h('label.check', { style: 'margin-top:22px' }, ctl, h('span', t(label))));
    const box = field(label, ctl);
    if (ctl._datalist) box.appendChild(ctl._datalist); // datalists only work in the document
    return box;
  }

  async function submit(e) {
    e.preventDefault();
    err.textContent = '';
    const row = { id: prefill.id || newRowId(table) };
    for (const [name, ctl] of controls) {
      const v = ctl.type === 'checkbox' ? (ctl.checked ? 1 : 0) : ctl.value.trim();
      if (v === '' ) continue;
      row[name] = ctl.type === 'number' ? Number(v) : v;
    }
    if (spec.subject && !row[spec.subject]) { err.textContent = t(`Say which ${spec.subject === O ? 'school' : spec.subject === 'staffSourcedId' ? 'staff member' : 'student'} this is about.`); return; }
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await api('/api/facts/' + table, { method: 'POST', body: { rows: [row] } });
      status(t(`Saved. ${spec.title} is on the record.`));
      form.reset();
      for (const [name, ctl] of controls) if (prefill[name] != null && ctl.type !== 'checkbox') ctl.value = prefill[name];
      await onSaved?.(row);
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; return; }
    btn.disabled = false;
  }

  return heading
    ? h('div', h('h3', { style: 'margin-top:0' }, t(spec.title)), h('p.small.muted', { style: 'margin-top:0' }, t(spec.note || '')), form)
    : form;
}

function control(name, type, options, value) {
  if (type === 'select') return select(['', ...options], value ?? '', { name });
  if (type === 'check') return h('input', { type: 'checkbox', name, id: uid(), checked: !!Number(value) });
  if (type === 'textarea') return h('textarea', { name, rows: '2', id: uid(), value: value ?? '' });
  if (type === 'suggest') {
    const listId = uid('dl');
    const el = input({ name, value: value ?? '', list: listId });
    el._datalist = h('datalist', { id: listId }, options.map((o) => h('option', { value: o })));
    return el;
  }
  if (type === 'number') return input({ type: 'number', name, value: value ?? '', step: 'any' });
  if (type === 'date') return input({ type: 'date', name, value: value ?? '' });
  return input({ name, value: value ?? '' });
}

/** A dialog-ish card that holds one record form, with a close button. */
export async function recordFormCard(table, opts = {}) {
  const inner = await recordForm(table, opts);
  const card = h('div.card.formcard', inner);
  if (opts.onClose) card.insertBefore(h('button.linkish', { style: 'float:right', onclick: () => opts.onClose() }, 'Close'), card.firstChild);
  return card;
}

/** Replace `host`'s contents with a record form for `table`. */
export async function openRecordForm(host, table, opts = {}) {
  clear(host).appendChild(h('p.small.muted', 'Loading…'));
  const card = await recordFormCard(table, { ...opts, onClose: () => clear(host) });
  clear(host).appendChild(card);
  host.scrollIntoView?.({ block: 'nearest' });
  card.querySelector('input, select, textarea')?.focus();
}
