// Wizard screens that create entities: the school, the students, the staff,
// the families. Everything here goes through POST /api/people.
import { api, h, clear, status, go, displayName, gradeLabel } from '/app.js';
import { t, Word, word, edition, feature, say } from '/js/edition.js';
import { field, input, select, labelled, debounce, table } from '/js/ui.js';

const post = (body) => api('/api/people', { method: 'POST', body });

// ---------- the organization ----------

export async function organization() {
  const list = h('div');
  const name = input({ required: true, placeholder: t('The name on the sign') });
  const level = select([['', '—'], 'elementary', 'middle', 'high', 'mixed', 'other'], '');
  const identifier = input({ placeholder: t('Any state or district code you already have') });
  const address = input(); const city = input(); const region = input(); const postal = input(); const phone = input();
  const err = h('p.err', { role: 'alert' });

  const form = h('form', { onsubmit: submit },
    h('div.formgrid',
      h('div', { style: 'grid-column:1/-1' }, field('Name', name)),
      h('div', field('Level', level)),
      h('div', field('Identifier', identifier)),
      h('div', { style: 'grid-column:1/-1' }, field('Address', address)),
      h('div', field('Town or city', city)),
      h('div', field('State or region', region)),
      h('div', field('Postcode', postal)),
      h('div', field('Phone', phone)),
    ),
    err,
    h('button.btn', { type: 'submit' }, t('Add this school')),
  );

  async function submit(e) {
    e.preventDefault();
    err.textContent = '';
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await post({ type: 'school', name: name.value.trim(), level: level.value || undefined, identifier: identifier.value.trim() || undefined, address: address.value.trim() || undefined, city: city.value.trim() || undefined, region: region.value.trim() || undefined, postalCode: postal.value.trim() || undefined, phone: phone.value.trim() || undefined });
      status(t(`${name.value.trim()} is on the record.`));
      form.reset();
      await refreshList();
    } catch (ex) { err.textContent = ex.message; }
    btn.disabled = false;
  }

  async function refreshList() {
    const { people } = await api('/api/people?type=school&limit=100');
    clear(list).appendChild(people.length
      ? table([['name', 'Name'], ['level', 'Level'], ['id', 'Id', (v) => h('span.mono.small', v)]], people)
      : h('p.empty', t('No schools yet. The first one is the one you are standing in.')));
  }
  await refreshList();

  return h('div',
    h('p.lede', say(['onboarding_organization', 'onboardingOrganization'], 'One row for the place itself. Everything else hangs off it.')),
    h('div.card', form),
    h('h3', t('Schools on the record')), list);
}

// ---------- students ----------

export async function people() {
  const box = h('div');
  const importFirst = edition().onboarding?.mode === 'import-or-manual' && feature('import');
  return h('div',
    h('p.lede', say(['onboarding_people', 'onboardingPeople'], 'A name and a birthday is enough to start. Everything else can arrive later.')),
    importFirst ? importCard() : null,
    h('div', { style: 'margin-top:14px' }, await personSection('student', box)),
  );
}

function importCard() {
  return h('div.card', { style: 'border-left:3px solid var(--accent)' },
    h('h3', { style: 'margin-top:0' }, t('Import a vendor export')),
    h('p.small.muted', { style: 'margin-top:0' }, t('If you are leaving another system, bring the CSV. Librea guesses the mapping and shows you what it guessed before writing anything.')),
    h('div.row',
      h('button.btn', { onclick: () => go('/import') }, t('Open import')),
      h('span.small.muted', t('or add students by hand below.'))));
}

export async function staff() {
  return h('div',
    h('p.lede', say(['onboarding_staff', 'onboardingStaff'], 'The adults. Each one can have their own account, and their own credentials on file.')),
    await personSection('staff', h('div')));
}

const STAFF_ROLES = ['teacher', 'aide', 'counselor', 'administrator', 'principal', 'nurse', 'other'];

/** One "add by hand + paste a list" section for students or staff. */
async function personSection(type, listBox) {
  // An edition may rename staff to a plural word ("guides"), so the singular
  // comes from its word for one teacher.
  const one = type === 'staff' ? word('teacher') : word('student');
  const many = type === 'staff' ? word('staff', true) : word('student', true);
  const schools = await api('/api/people?type=school&limit=200').then((r) => r.people).catch(() => []);
  const schoolOptions = [['', t('No school yet')], ...schools.map((s) => [s.id, s.name || s.id])];

  const first = input({ required: true });
  const last = input();
  const preferred = input();
  const dob = input({ type: 'date' });
  const grade = select([['', '—'], ...gradeOptions()], '');
  const email = input();
  const role = select(STAFF_ROLES, 'teacher');
  const school = select(schoolOptions, schools[0]?.id || '');
  const err = h('p.err', { role: 'alert' });

  if (type === 'student') dob.addEventListener('change', () => { if (!grade.value) grade.value = String(gradeFromBirthdate(dob.value) ?? ''); });

  const form = h('form', { onsubmit: submitOne },
    h('div.formgrid',
      h('div', field('First name', first)),
      h('div', field('Last name', last)),
      type === 'student' ? h('div', field('Goes by', preferred)) : h('div', field('Email', email)),
      type === 'student' ? h('div', field('Birthdate', dob, t('We can work out a grade from this.'))) : h('div', field('Role', role)),
      type === 'student' ? h('div', field('Grade', grade)) : null,
      h('div', field('School', school)),
    ),
    err,
    h('button.btn', { type: 'submit' }, `${t('Add this')} ${one}`),
  );

  const paste = h('textarea', { rows: '5', placeholder: 'Ada Lovelace\nGrace Hopper\nAlan Turing' });
  const bulkErr = h('p.err', { role: 'alert' });
  const bulk = h('form', { onsubmit: submitMany },
    labelled('One name per line', paste),
    h('p.small.muted', { style: 'margin:6px 0' }, t('First name, then last name. They all land in the school and grade picked above; fix anyone who is different afterwards.')),
    bulkErr,
    h('button.btn.ghost', { type: 'submit' }, t('Add them all')),
  );

  async function submitOne(e) {
    e.preventDefault();
    err.textContent = '';
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await post(personBody(type, first.value.trim(), last.value.trim(), { preferred: preferred.value.trim(), dob: dob.value, grade: grade.value, email: email.value.trim(), role: role.value, schoolId: school.value }));
      status(t(`${first.value} ${last.value} is on the record.`));
      first.value = last.value = preferred.value = email.value = '';
      await refresh();
      first.focus();
    } catch (ex) { err.textContent = ex.message; }
    btn.disabled = false;
  }

  async function submitMany(e) {
    e.preventDefault();
    bulkErr.textContent = '';
    const names = paste.value.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!names.length) { bulkErr.textContent = t('Nothing to add yet.'); return; }
    const btn = bulk.querySelector('button[type=submit]');
    btn.disabled = true;
    let added = 0; const failed = [];
    for (const line of names) {
      const parts = line.split(/\s+/);
      const fn = parts.shift();
      try { await post(personBody(type, fn, parts.join(' '), { grade: grade.value, role: role.value, schoolId: school.value })); added++; }
      catch (ex) { failed.push(`${line}: ${ex.message}`); }
    }
    paste.value = failed.length ? failed.map((f) => f.split(':')[0]).join('\n') : '';
    bulkErr.textContent = failed.length ? t(`Added ${added}. These did not go in: `) + failed.join('; ') : '';
    status(`${t('Added')} ${added} ${added === 1 ? one : many}.`);
    await refresh();
    btn.disabled = false;
  }

  async function refresh() {
    const { people: rows, total } = await api(`/api/people?type=${type}&limit=25`);
    clear(listBox).append(
      h('p.small.muted', total ? `${total} ${total === 1 ? one : many} ${t('on the record.')}` : ''),
      rows.length
        ? table(type === 'student'
          ? [[(p) => displayName(p), 'Name'], ['grade', 'Grade', gradeLabel], ['schoolId', 'School'], ['id', 'Id', (v) => h('span.mono.small', v)]]
          : [[(p) => displayName(p), 'Name'], ['role', 'Role'], ['email', 'Email'], ['id', 'Id', (v) => h('span.mono.small', v)]],
        rows, (p) => go('/person/' + p.id))
        : h('p.empty', type === 'student' ? say(['empty_students', 'emptyStudents', 'emptyLearners'], `No ${many} yet.`) : `${t('No')} ${many} ${t('yet.')}`),
    );
  }
  await refresh();

  return h('div.grid.two',
    h('div.card', h('h3', { style: 'margin-top:0' }, `${t('Add a')} ${one}`), form),
    h('div.card', h('h3', { style: 'margin-top:0' }, t('Paste a list')), bulk),
    h('div', { style: 'grid-column:1/-1' }, listBox),
  );
}

function personBody(type, firstName, lastName, extra) {
  const body = { type, firstName, lastName };
  if (extra.schoolId) body.schoolId = extra.schoolId;
  if (type === 'student') {
    if (extra.preferred) body.preferredName = extra.preferred;
    if (extra.dob) body.dob = extra.dob;
    const g = extra.grade !== '' && extra.grade != null ? Number(extra.grade) : gradeFromBirthdate(extra.dob);
    if (g != null && Number.isFinite(g)) body.grade = g;
  } else {
    if (extra.email) body.email = extra.email;
    if (extra.role) body.role = extra.role;
  }
  return body;
}

const gradeOptions = () => [...Array(15).keys()].map((i) => [String(i - 1), gradeLabel(i - 1)]);

/** Rough US convention: a child who turns 5 by the autumn starts kindergarten. */
export function gradeFromBirthdate(dob) {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const schoolYearStart = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  let age = schoolYearStart - d.getFullYear();
  if (d.getMonth() > 8) age -= 1;
  const g = age - 5;
  return g < -1 ? -1 : g > 13 ? 13 : g;
}

// ---------- families ----------

export async function families() {
  const listBox = h('div');
  const famName = input({ placeholder: t('The Lovelace family') });
  const members = h('div.stack');
  const picked = [];
  const chosen = h('div.chips');
  const found = h('div.chips', { style: 'margin-top:8px' });
  const err = h('p.err', { role: 'alert' });
  addMemberRow();

  const form = h('form', { onsubmit: submit },
    field('Family name', famName),
    h('label', t('Grown-ups in this family')),
    members,
    h('button.btn.ghost.small', { type: 'button', onclick: () => addMemberRow() }, t('Add another grown-up')),
    h('div', { style: 'margin-top:14px' }, studentPicker()),
    err,
    h('div.row', { style: 'margin-top:12px' }, h('button.btn', { type: 'submit' }, t('Create this family'))),
  );

  function addMemberRow() {
    const name = input({ placeholder: t('Name') });
    const relation = select([['', t('Relation')], 'mother', 'father', 'guardian', 'grandparent', 'other'], '');
    const email = input({ placeholder: 'email' });
    const phone = input({ placeholder: 'phone' });
    members.appendChild(h('div.inline-form', { 'data-member': '1' }, name, relation, email, phone));
  }

  function studentPicker() {
    const search = input({ type: 'search', placeholder: t('Search students by name or id') });
    const results = found;
    search.addEventListener('input', debounce(async () => {
      const q = search.value.trim();
      if (!q) { clear(results); return; }
      const { people: rows } = await api(`/api/people?type=student&q=${encodeURIComponent(q)}&limit=8`);
      clear(results).append(...rows.map((p) => h('button', { type: 'button', onclick: () => { if (!picked.includes(p.id)) { picked.push(p.id); drawChosen(); } } },
        `${displayName(p)} · ${gradeLabel(p.grade)} · ${p.id}`)));
      if (!rows.length) results.appendChild(h('span.small.muted', t('No students match that.')));
    }, 300));
    return h('div', labelled('Children in this family', search), results, chosen);
  }

  function drawChosen() {
    clear(chosen);
    for (const id of picked) chosen.appendChild(h('button', { type: 'button', title: t('Remove'), onclick: () => { picked.splice(picked.indexOf(id), 1); drawChosen(); } }, id + ' ✕'));
  }

  async function submit(e) {
    e.preventDefault();
    err.textContent = '';
    const rows = [...members.querySelectorAll('[data-member]')].map((row) => {
      const [name, relation, email, phone] = row.querySelectorAll('input, select');
      return { name: name.value.trim(), relation: relation.value, email: email.value.trim(), phone: phone.value.trim() };
    }).filter((m) => m.name);
    if (!rows.length && !picked.length) { err.textContent = t('Add at least one grown-up or one child.'); return; }
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const { person } = await post({ type: 'family', name: famName.value.trim() || rows[0]?.name || 'Family', members: rows, students: [...picked] });
      status(t(`Family ${person.id} created.`));
      famName.value = ''; picked.length = 0; drawChosen();
      const search = form.querySelector('input[type=search]');
      if (search) search.value = '';
      clear(found);
      clear(members); addMemberRow();
      await refresh();
    } catch (ex) { err.textContent = ex.message; }
    btn.disabled = false;
  }

  async function refresh() {
    const { people: rows } = await api('/api/people?type=family&limit=100');
    clear(listBox).appendChild(rows.length
      ? table([
        [(f) => f.name || f.id, 'Family'],
        [(f) => (f.members || []).map((m) => m.name).join(', '), 'Grown-ups'],
        [(f) => String((f.students || []).length), Word('student', true)],
        ['id', 'Id', (v) => h('span.mono.small', v)],
      ], rows, (f) => go('/family/' + f.id))
      : h('p.empty', t('No families yet.')));
  }
  await refresh();

  return h('div',
    h('p.lede', say(['onboarding_families', 'onboardingFamilies'], `A family is the grown-ups plus the ${word('student', true)} they belong to. Linking one links the other.`)),
    h('div.card', form),
    h('h3', t('Families')), listBox);
}
