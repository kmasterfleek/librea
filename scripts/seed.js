// Seed a demo district from data/seed/district.json (850 synthetic students,
// 4 schools) and give each student a few voice fragments so semantic search
// has something to find. Idempotent: wipes data/ first unless --keep.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/core/store.js';
import { Auth } from '../src/core/auth.js';
import { SqlProjection } from '../src/sql/projection.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// `npm run seed` seeds whatever edition is active: an edition whose
// edition.json names a seed script gets that script instead of the district.
{
  const { loadEdition } = await import('../src/core/edition.js');
  const ed = loadEdition();
  if (ed.id !== 'district' && typeof ed.seed === 'string' && ed.seed.endsWith('.js')) {
    const file = path.join(ROOT, ed.seed);
    if (fs.existsSync(file)) { console.log(`Seeding the ${ed.name} edition via ${ed.seed}`); await import(file); process.exit(0); }
    console.warn(`edition seed ${ed.seed} not found; seeding the district demo instead`);
  }
}
const dataDir = process.env.LIBREA_DATA || path.join(ROOT, 'data');
const limit = Number(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1]) || Infinity;
const keep = process.argv.includes('--keep');

const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/seed/district.json'), 'utf8'));
if (!keep) for (const f of ['ledger.jsonl', 'vectors.db', 'snapshot.json', 'users.json', 'librea.sqlite', 'librea.sqlite-wal', 'librea.sqlite-shm']) fs.rmSync(path.join(dataDir, f), { force: true, recursive: true });

const sql = new SqlProjection(dataDir).open();
const store = await new Store(dataDir).attach(sql).open();
const auth = new Auth(dataDir);

const schoolId = (name) => 'SCH-' + name.split(' ')[0].toUpperCase();
seed.schools.forEach((s, k) => store.upsertEntity({ id: schoolId(s.name), type: 'school', name: s.name, level: s.type, capacity: s.size, address: `${100 + k * 250} ${s.name.split(' ')[0]} Ave`, city: 'Riverbend', state: 'CA', postalCode: '9550' + k, phone: '555-020' + k }, 'seed'));

const INTERESTS = ['robotics', 'drawing comics', 'soccer', 'cooking with my grandmother', 'coding games', 'basketball', 'writing stories', 'skateboarding', 'the school garden', 'music production', 'chess', 'fixing bikes', 'theater', 'birdwatching', 'Minecraft redstone', 'dance', 'anime', 'volunteering at the shelter', 'fishing', 'building with cardboard', 'sewing', 'ham radio', 'baking', 'photography', 'track', 'origami', 'taking apart old electronics', 'poetry', 'gardening tomatoes', 'making beats', 'wrestling', 'knitting', 'sign language', 'DJing', 'drones', 'my little brother', 'hip hop', 'astronomy', 'weather', 'card games'];
const GOALS = ['get better at math this year', 'read a whole chapter book by myself', 'make a friend in my new class', 'build something that works the first time', 'speak up more in class', 'run the mile without stopping', 'learn to solder', 'finish my comic', 'get my grades up so I can play', 'teach my cousin what I learned', 'stop being scared of presentations', 'learn enough Spanish to talk to my grandpa', 'start a club', 'make the robotics team', 'figure out what I want to do after school'];
const STRENGTHS = ['I notice things other people miss.', 'I can fix almost anything with tape.', 'I am good at explaining stuff to little kids.', 'I never give up on a puzzle.', 'People say I am funny.', 'I keep my desk organized.', 'I remember everything about animals.', 'I am the fastest in my grade.', 'I can draw anything you describe.', 'I am patient with plants.', 'I like working with my hands more than reading.', 'My best subject is art.', 'I ask a lot of questions.', 'I am good at listening.'];
const WORRIES = ['Tests make my stomach hurt.', 'I do not like reading out loud.', 'Sometimes I do not understand the homework and nobody at home can help.', 'I get bored when things are too easy.', 'I wish lunch was longer.', 'I miss my old school.', 'I get in trouble for talking but I am usually helping someone.', '', '', ''];
const STAFF_OBS = [
  'Quiet in whole-group discussion but leads confidently in small groups.',
  'Asks precise questions; needs extended time on timed assessments.',
  'Helps newer students settle in without being asked.',
  'Energy dips after lunch; mornings are the best time for hard work.',
  'Strong visual thinker; sketches ideas before writing.',
  'Has been arriving late this month; family says transportation changed.',
  'Reads well above grade level; bored by the core text, thrives with choice.',
  'Struggles to start independent work but finishes strong once started.',
  'Natural mediator during conflicts at recess.',
  'Sensitive to noise; uses the quiet corner and it works.',
  'Built the best stick chart in the class; other kids could actually decode it.',
  'Missed three garden mornings in a row; check in.',
  'Turned a failed circuit into a lesson for the table. Give this kid a microphone.',
  'Writes beautifully but will not share. Small audience first.',
  'Counts on fingers still; not a problem, but the fluency work matters.',
  'Family conference went well; mom wants weekly updates by text.',
  'Two friends moved away this year. Watch peer connection.',
  'Has started coming to the makerspace at lunch. Good sign.',
];
const FAMILY = [
  'At home {n} takes care of the younger kids after school. Please keep that in mind for homework.',
  'We speak {lang} at home. {n} translates for us at appointments.',
  '{n} lights up when talking about {i}. We would love the school to build on that.',
  'We moved twice this year. {n} is still finding their footing.',
  '{n} has been anxious about tests. A heads-up before big ones helps.',
  'Our family runs a small business and {n} helps on weekends. Learning to handle money and customers.',
  '{n} reads to grandma every night. She says the voices are the best part.',
  'Dad works nights, so mornings are hard. If {n} is late it is not for lack of trying.',
  '{n} fixed our router last week. Nobody taught them that.',
  'We do not have a computer at home right now. Paper copies help.',
  '{n} has been quieter since the fall. We are not sure why yet.',
  'Church youth group on Wednesdays means no homework that night, sorry.',
];
const LANGS = ['Spanish', 'Tagalog', 'Vietnamese', 'Arabic', 'Hmong', 'Punjabi', 'Russian'];
const pick = (arr, i) => arr[Math.floor(i) % arr.length];

let n = 0;
const students = seed.students.slice(0, limit);
const t0 = Date.now();
let pending = [];
const flush = async () => { if (pending.length) { await store.addFragments(pending, 'seed'); pending = []; } };
for (const s of students) {
  const r = s.r;
  store.upsertEntity({
    id: s.id, type: 'student', firstName: s.fn, lastName: s.ln, grade: s.g, schoolId: schoolId(s.sc),
    externalIds: { powerschool: String(100000 + n) },
    metrics: { gpa: r.gpa, attendancePct: r.attendancePct, testPercentile: r.testPercentile, courseRigor: r.courseRigor, assignCompletionPct: r.assignCompletionPct, disciplineIncidents: r.disciplineIncidents, extracurricularCount: r.extracurricularCount, selScore: r.selScore, counselorVisits: r.counselorVisits, trajectory: r.trajectory, ses: r.ses, homeStability: r.homeStability, ellLevel: r.ellLevel, specialEd: r.specialEd, peerConnected: r.peerConnected },
  }, 'seed');
  const i1 = pick(INTERESTS, n), i2 = pick(INTERESTS, n * 7 + 3);
  const h = (n * 2654435761) >>> 0; // cheap deterministic scatter so templates mix
  const selfText = `I'm ${s.fn}. I'm into ${i1} and ${i2}. ${pick(STRENGTHS, h >> 3)} This year I want to ${pick(GOALS, h >> 7)}. ${pick(WORRIES, h >> 11)}`.trim();
  pending.push({ entityId: s.id, kind: 'self', visibility: 'school', text: selfText, author: { id: s.id.toLowerCase(), role: 'student', name: s.fn }, source: 'seed' });
  if (n % 2 === 0) pending.push({ entityId: s.id, kind: 'observation', visibility: n % 6 === 0 ? 'staff' : 'school', text: pick(STAFF_OBS, (n * 7919) >>> 0), author: { id: 'teacher.' + (n % 9), role: 'staff', name: 'Teacher ' + (n % 9) }, source: 'seed' });
  if (n % 3 === 0) pending.push({ entityId: s.id, kind: 'family', visibility: 'school', text: pick(FAMILY, (n * 104729) >>> 0).replaceAll('{n}', s.fn).replace('{lang}', pick(LANGS, n)).replace('{i}', i1), author: { id: 'family.' + s.id.toLowerCase(), role: 'family', name: s.ln + ' family' }, source: 'seed' });
  n++;
  if (n % 50 === 0) await flush();
  if (n % 100 === 0) console.log(`  ${n}/${students.length} students, ${store.fragments.size} fragments, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

await flush();

// Monthly signal snapshots (Sep..Jun) from the student-vectors timeline, plus
// a staff note naming the archetype for the 15 featured students.
const tlFile = path.join(ROOT, 'data/seed/timeline.json');
if (fs.existsSync(tlFile)) {
  const tl = JSON.parse(fs.readFileSync(tlFile, 'utf8'));
  const months = tl.months.map((m, i) => (i < 4 ? '2025-' : '2026-') + String(([9, 10, 11, 12, 1, 2, 3, 4, 5, 6])[i]).padStart(2, '0'));
  const ids = new Set(students.map((s) => s.id));
  let snaps = 0;
  tl.frames.forEach((frame, i) => { for (const row of frame) if (ids.has(row.id)) { store.addSnapshot(row.id, months[i], row.d, 'seed'); snaps++; } });
  const notes = [];
  for (const f of tl.featured || []) if (ids.has(f.id)) notes.push({ entityId: f.id, kind: 'note', visibility: 'staff', text: `Pattern this year: ${f.label}. Worth looking at the monthly journey before the next family conference.`, author: { id: 'counselor.7', role: 'staff', name: 'Counselor 7' }, source: 'seed' });
  if (notes.length) await store.addFragments(notes, 'seed');
  console.log(`  ${snaps} monthly snapshots, ${notes.length} archetype notes`);
}
// Relational facts: 30 school days of attendance consistent with each
// student's attendance rate, one row per discipline incident, and service
// rows for ELL / special education / free-reduced lunch.
{
  const days = []; let d = new Date('2025-09-02T12:00:00Z');
  while (days.length < 30) { if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) days.push(d.toISOString().slice(0, 10)); d = new Date(d.getTime() + 86400000); }
  const att = [], inc = [], svc = [];
  students.forEach((s, i) => {
    const r = s.r; const absences = Math.round((1 - r.attendancePct / 100) * 30);
    const absentDays = new Set(); let h = (i * 2654435761) >>> 0;
    while (absentDays.size < absences) { h = (h * 1103515245 + 12345) >>> 0; absentDays.add(h % 30); }
    days.forEach((date, di) => att.push({ id: `${s.id}-${date}`, studentSourcedId: s.id, date, code: absentDays.has(di) ? (h % 3 === 0 ? 'excused' : 'absent') : (di % 11 === i % 11 ? 'tardy' : 'present') }));
    for (let k = 0; k < r.disciplineIncidents; k++) inc.push({ id: `${s.id}-inc${k}`, studentSourcedId: s.id, date: days[(i + k * 7) % 30], type: ['disruption', 'tardiness', 'conflict', 'phone use', 'defiance'][(i + k) % 5], action: ['warning', 'parent contact', 'detention', 'counselor referral'][(i + k) % 4], schoolSourcedId: schoolId(s.sc) });
    if (r.ellLevel && r.ellLevel !== 'None') svc.push({ id: `${s.id}-ell`, studentSourcedId: s.id, type: 'ELL', level: r.ellLevel, startDate: '2025-08-15' });
    if (r.specialEd && r.specialEd !== 'None') svc.push({ id: `${s.id}-sped`, studentSourcedId: s.id, type: r.specialEd === '504' ? '504' : 'IEP', level: r.specialEd === 'IEP-full' ? 'full' : 'partial', startDate: '2025-08-15' });
    if (r.ses < 0.35) svc.push({ id: `${s.id}-frl`, studentSourcedId: s.id, type: 'FRL', level: r.ses < 0.2 ? 'free' : 'reduced', startDate: '2025-08-15' });
  });
  store.upsertFacts('attendance', att, 'seed');
  if (inc.length) store.upsertFacts('discipline_incidents', inc, 'seed');
  if (svc.length) store.upsertFacts('services', svc, 'seed');
  console.log(`  facts: ${att.length} attendance rows, ${inc.length} incidents, ${svc.length} services`);
}
// Compliance records for the district demo: immunizations, documents, plans,
// contacts, drills, staff credentials. Mostly complete, with deliberate gaps.
{
  const today = new Date(); const iso = (d) => d.toISOString().slice(0, 10);
  const daysAgo = (n) => iso(new Date(today.getTime() - n * 86400000));
  const imm = [], docs = [], plans = [], contacts = [];
  students.forEach((s, i) => {
    if (i % 97 !== 5) for (const v of ['DTaP', 'MMR', 'Polio', 'Varicella']) imm.push({ id: `${s.id}-${v}`, studentSourcedId: s.id, vaccine: v, date: '2019-08-1' + (i % 9), doseNumber: 1, exemption: i % 61 === 3 ? 'medical' : 'none' });
    for (const t of ['enrollment', 'emergency-card']) if (!(t === 'emergency-card' && i % 53 === 7)) docs.push({ id: `${s.id}-${t}`, subjectType: 'student', subjectSourcedId: s.id, type: t, title: t, status: 'on-file', issuedDate: '2025-08-1' + (i % 9) });
    contacts.push({ id: `${s.id}-c1`, studentSourcedId: s.id, name: `Guardian of ${s.fn}`, relation: i % 3 ? 'mother' : 'father', phone: '555-01' + String(i % 100).padStart(2, '0'), isPrimary: 1 });
    const r = s.r;
    if (r.specialEd && r.specialEd !== 'None') plans.push({ id: `${s.id}-plan`, studentSourcedId: s.id, type: r.specialEd === '504' ? '504' : 'IEP', title: `${r.specialEd} plan`, status: 'active', startDate: '2025-08-20', reviewDate: i % 5 === 0 ? daysAgo(20) : daysAgo(-200), owner: 'STF-' + (6 + (i % 2)) });
  });
  const creds = [];
  for (let i = 0; i < 9; i++) for (const t of ['background-check', 'mandated-reporter', 'cpr']) creds.push({ id: `STF-${i}-${t}`, staffSourcedId: 'STF-' + i, type: t, status: i === 4 && t === 'mandated-reporter' ? 'expired' : 'valid', issuedDate: '2025-08-01', expiresDate: t === 'cpr' && i === 2 ? daysAgo(-12) : daysAgo(-300) });
  const drills = [];
  seed.schools.forEach((sc, k) => { drills.push({ id: `${schoolId(sc.name)}-fire-1`, orgSourcedId: schoolId(sc.name), type: 'fire', date: daysAgo(12 + k), durationMinutes: 6, participants: sc.size }); if (k !== 1) drills.push({ id: `${schoolId(sc.name)}-lockdown-1`, orgSourcedId: schoolId(sc.name), type: 'lockdown', date: daysAgo(40 + k), durationMinutes: 15, participants: sc.size }); });
  store.upsertFacts('immunizations', imm, 'seed'); store.upsertFacts('documents', docs, 'seed'); store.upsertFacts('contacts', contacts, 'seed');
  if (plans.length) store.upsertFacts('learning_plans', plans, 'seed');
  store.upsertFacts('staff_credentials', creds, 'seed'); store.upsertFacts('drills', drills, 'seed');
  console.log(`  compliance: ${imm.length} immunizations, ${docs.length} documents, ${contacts.length} contacts, ${plans.length} plans, ${creds.length} credentials, ${drills.length} drills`);
}
// Staff
for (let i = 0; i < 9; i++) store.upsertEntity({ id: 'STF-' + i, type: 'staff', firstName: 'Teacher', lastName: String(i), role: i < 6 ? 'teacher' : i < 8 ? 'counselor' : 'principal', schoolId: schoolId(seed.schools[i % 4].name) }, 'seed');

// Accounts: admin / a teacher / one student / one family, all with demo passwords.
if (!keep && !auth.bootstrapped) {
  auth.createUser({ username: 'admin', password: 'librea-admin', role: 'admin', displayName: 'District Admin' });
  auth.createUser({ username: 'teacher.0', password: 'librea-staff', role: 'staff', entityId: 'STF-0', displayName: 'Teacher 0' });
  const s0 = students[0];
  auth.createUser({ username: s0.id.toLowerCase(), password: 'librea-student', role: 'student', entityId: s0.id, displayName: s0.fn });
  auth.createUser({ username: 'family.' + s0.id.toLowerCase(), password: 'librea-family', role: 'family', entityIds: [s0.id], displayName: s0.ln + ' family' });
}
sql.close();
store.snapshot();
console.log(`Seeded ${store.stats().students} students, ${store.fragments.size} fragments, ${store.stats().schools.length} schools in ${((Date.now() - t0) / 1000).toFixed(1)}s. Ledger head: ${store.ledger.verify().head.slice(0, 12)}`);
console.log('Demo logins: admin/librea-admin, teacher.0/librea-staff, ' + students[0].id.toLowerCase() + '/librea-student, family.' + students[0].id.toLowerCase() + '/librea-family');
