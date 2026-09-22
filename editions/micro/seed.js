// Seed Willow Creek Learning Community: a 22-learner microschool with mixed
// ages, five guides, fifteen families, and the paperwork a pod actually has to
// keep. Everything here is synthetic and deterministic — the only thing that
// moves between runs is "today", which the date offsets hang off so that the
// expiring credential is always about to expire and the overdue plan reviews
// are always overdue.
//
//   LIBREA_DATA=/tmp/pod LIBREA_EDITION=micro node editions/micro/seed.js
//
// Flags mirror scripts/seed.js: --keep leaves the data dir alone.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../../src/core/store.js';
import { Auth } from '../../src/core/auth.js';
import { SqlProjection } from '../../src/sql/projection.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const dataDir = process.env.LIBREA_DATA || path.join(ROOT, 'data');
const keep = process.argv.includes('--keep');
const t0 = Date.now();

// ---------------------------------------------------------------- dates
const DAY = 86400000;
const TODAY = new Date(new Date().toISOString().slice(0, 10) + 'T12:00:00Z');
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const ago = (days) => iso(TODAY.getTime() - days * DAY);
const ahead = (days) => iso(TODAY.getTime() + days * DAY);
/** July 1 of the school year today falls in. Compliance dates the affidavit against it. */
const SCHOOL_YEAR_START = `${TODAY.getUTCMonth() >= 6 ? TODAY.getUTCFullYear() : TODAY.getUTCFullYear() - 1}-07-01`;
const sinceSchoolYear = (days) => (ago(days) >= SCHOOL_YEAR_START ? ago(days) : SCHOOL_YEAR_START);
/** The last `n` weekdays, oldest first, ending yesterday. */
function schoolDays(n) {
  const out = [];
  for (let i = 1; out.length < n; i++) {
    const d = new Date(TODAY.getTime() - i * DAY);
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) out.push(iso(d));
  }
  return out.reverse();
}
/** Deterministic scatter: same index always yields the same number. */
const hash = (i) => ((i * 2654435761) >>> 0) / 4294967296;
const pick = (arr, i) => arr[Math.floor(hash(i) * arr.length) % arr.length];
const r2 = (n) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------- the pod
const POD = {
  id: 'POD-WILLOW', name: 'Willow Creek Learning Community', level: 'mixed',
  // Synthetic, but shaped like the real thing: a state affidavit asks for the
  // site address, and the checklist can only verify what is written down.
  address: '4120 Willow Creek Road', city: 'Rivenholt', state: 'CA', postalCode: '95492',
  phone: '555-0100', email: 'hello@willowcreek.example.org',
};

// [surname, guardian one, relation, guardian two|null, relation, language]
const FAMILIES = [
  ['Okonkwo', 'Adaeze Okonkwo', 'mother', 'Chidi Okonkwo', 'father', 'Igbo'],
  ['Reyes-Hall', 'Marisol Reyes', 'mother', 'Peter Hall', 'father', 'Spanish'],
  ['Bergstrom', 'Ingrid Bergstrom', 'mother', null, null, 'English'],
  ['Ferrante', 'Lucia Ferrante', 'mother', 'Tomas Ferrante', 'father', 'Italian'],
  ['Nakamura', 'Yuki Nakamura', 'mother', 'Sam Nakamura', 'father', 'Japanese'],
  ['Quiroga', 'Elena Quiroga', 'grandmother', null, null, 'Spanish'],
  ['Whitfield', 'Dana Whitfield', 'mother', 'Ross Whitfield', 'father', 'English'],
  ['Adeyemi', 'Folake Adeyemi', 'mother', null, null, 'Yoruba'],
  ['Maslova', 'Irina Maslova', 'mother', 'Pavel Maslov', 'father', 'Russian'],
  ['Thorne', 'Beatrix Thorne', 'mother', 'June Thorne', 'mother', 'English'],
  ['Castellanos', 'Rosa Castellanos', 'mother', 'Hector Castellanos', 'father', 'Spanish'],
  ['Achterberg', 'Willem Achterberg', 'father', null, null, 'Dutch'],
  ['Sandoval', 'Pilar Sandoval', 'mother', 'Nico Sandoval', 'father', 'Spanish'],
  ['Brightwater', 'Leona Brightwater', 'mother', 'Arne Brightwater', 'father', 'English'],
  ['Osei', 'Kwabena Osei', 'father', 'Ama Osei', 'mother', 'Twi'],
];

// [first name, family index, age, what they are into, a true thing about them]
const LEARNERS = [
  ['Nneka', 0, 12, 'river ecology', 'keeps a field notebook nobody asked her to keep'],
  ['Obi', 0, 8, 'bridges', 'will not leave a broken thing alone'],
  ['Mateo', 1, 10, 'bike repair', 'rebuilt a coaster brake from a diagram'],
  ['Sofia', 1, 6, 'drawing horses', 'draws the same horse until it is right'],
  ['Annika', 2, 14, 'printmaking', 'runs the print table and teaches the little ones'],
  ['Gio', 3, 9, 'fossils', 'can name every rock in the creek bed'],
  ['Rosa', 3, 5, 'mud', 'narrates everything she does, out loud, all day'],
  ['Haru', 4, 13, 'game design', 'playtests on the five-year-olds and takes notes'],
  ['Mika', 4, 7, 'birds', 'knows six calls and is working on a seventh'],
  ['Valentina', 5, 11, 'baking', 'doubles recipes in her head to practice fractions'],
  ['Cormac', 6, 13, 'welding', 'measures twice, out of principle'],
  ['Juniper', 6, 9, 'weaving', 'taught herself a four-shaft pattern from a library book'],
  ['Tobi', 7, 10, 'astronomy', 'stays up for meteor showers and pays for it Tuesday'],
  ['Sasha', 8, 12, 'chess', 'plays the guides and is starting to win'],
  ['Leo', 8, 6, 'dinosaurs', 'corrects adults about dinosaurs, politely'],
  ['Wren', 9, 8, 'the chicken coop', 'named every hen and can tell them apart'],
  ['Diego', 10, 14, 'sound recording', 'built a parabolic mic out of a salad bowl'],
  ['Paloma', 10, 11, 'sewing', 'altered her brother’s coat so it fit her'],
  ['Pieter', 11, 7, 'marble runs', 'iterates without being told that is what it is called'],
  ['Cruz', 12, 12, 'skateboard ramps', 'does the math because the ramp demands it'],
  ['Fenna', 13, 9, 'mushrooms', 'carries a spore print in her pocket like a wallet photo'],
  ['Kofi', 14, 10, 'drumming', 'holds a beat for a room of twenty-two'],
];

// [first, last, role, title shown to families]
const GUIDES = [
  ['Marguerite', 'Delacroix', 'principal', 'lead guide'],
  ['Theo', 'Amaechi', 'teacher', 'guide, older band'],
  ['Hana', 'Lindqvist', 'teacher', 'guide, middle band'],
  ['Ruth', 'Okafor', 'teacher', 'guide, youngest band'],
  ['Silas', 'Ponder', 'teacher', 'guide, making and the shop'],
];

const learnerId = (i) => 'LRN-' + String(i + 1).padStart(2, '0');
const familyId = (i) => 'FAM-' + String(i + 1).padStart(2, '0');
const guideId = (i) => 'GDE-' + String(i + 1).padStart(2, '0');
const gradeFor = (age) => Math.max(-1, Math.min(13, age - 5)); // 5 -> K
const fullName = (i) => `${LEARNERS[i][0]} ${FAMILIES[LEARNERS[i][1]][0]}`;

// ---------------------------------------------------------------- open
if (!keep) {
  fs.mkdirSync(dataDir, { recursive: true });
  for (const f of ['ledger.jsonl', 'vectors.db', 'snapshot.json', 'users.json', 'invites.json', 'apps', 'librea.sqlite', 'librea.sqlite-wal', 'librea.sqlite-shm']) {
    fs.rmSync(path.join(dataDir, f), { force: true, recursive: true });
  }
}
const sql = new SqlProjection(dataDir).open();
const store = await new Store(dataDir).attach(sql).open();
const auth = new Auth(dataDir);

store.upsertEntity({ ...POD, type: 'school', capacity: 30 }, 'seed');

// ---------------------------------------------------------------- people
LEARNERS.forEach((L, i) => {
  const [fn, fam, age] = L;
  const h = hash(i * 13 + 5);
  const older = age >= 11;
  store.upsertEntity({
    id: learnerId(i), type: 'student', firstName: fn, lastName: FAMILIES[fam][0],
    grade: gradeFor(age), schoolId: POD.id, dob: ago(age * 365 + Math.floor(h * 300)),
    guardians: [{ familyId: familyId(fam) }],
    metrics: {
      attendancePct: r2(88 + h * 11),
      assignCompletionPct: r2(72 + hash(i * 7 + 2) * 27),
      selScore: r2(0.55 + hash(i * 11 + 1) * 0.42),
      peerConnected: r2(0.5 + hash(i * 17 + 3) * 0.48),
      extracurricularCount: 1 + Math.floor(hash(i * 19 + 4) * 3),
      homeStability: r2(0.6 + hash(i * 23 + 6) * 0.39),
      ses: r2(0.35 + hash(i * 29 + 7) * 0.5),
      trajectory: r2(hash(i * 31 + 8) * 0.8 - 0.2),
      counselorVisits: Math.floor(hash(i * 37 + 9) * 3),
      disciplineIncidents: i === 19 ? 1 : 0,
      courseRigor: r2(0.4 + hash(i * 41 + 10) * 0.5),
      ...(older ? { gpa: r2(2.9 + hash(i * 43 + 11) * 1.1), testPercentile: Math.round(45 + hash(i * 47 + 12) * 50) } : {}),
      ellLevel: [1, 4, 10, 12].includes(i) ? 'Advanced' : 'None',
      specialEd: i === 6 ? '504' : i === 13 ? 'IEP-partial' : 'None',
    },
  }, 'seed');
});

FAMILIES.forEach((F, fi) => {
  const kids = LEARNERS.map((L, i) => (L[1] === fi ? learnerId(i) : null)).filter(Boolean);
  const members = [{ name: F[1], relation: F[2], email: `${F[1].split(' ')[0].toLowerCase()}@example.org`, phone: `555-01${String(fi + 10).padStart(2, '0')}`, language: F[5] }];
  if (F[3]) members.push({ name: F[3], relation: F[4], email: `${F[3].split(' ')[0].toLowerCase()}.${F[0].toLowerCase().replace(/[^a-z]/g, '')}@example.org`, phone: `555-02${String(fi + 10).padStart(2, '0')}`, language: F[5] });
  store.upsertEntity({ id: familyId(fi), type: 'family', name: `${F[0]} family`, schoolId: POD.id, students: kids, members }, 'seed');
});

GUIDES.forEach((G, i) => store.upsertEntity({
  id: guideId(i), type: 'staff', firstName: G[0], lastName: G[1], role: G[2], title: G[3],
  schoolId: POD.id, email: `${G[0].toLowerCase()}@willowcreek.example.org`,
}, 'seed'));

// ---------------------------------------------------------------- voices
// Portfolio-style. Families and learners write most of it; guides write less
// than they would in a district, which is the point.
const SELF = [
  'I {v} {i} this month. {t}',
  'Me and {buddy} worked on {i} for three weeks. It did not work and then it did.',
  'I am getting better at {i}. I want to show it at the sharing circle.',
  'Today I {v} {i} outside for the whole morning and nobody made me stop.',
];
const VERBS = ['built', 'took apart', 'drew', 'measured', 'fixed', 'started over on', 'finished'];
const WORK = [
  'Built a working water wheel from a bike hub. It turns a spool that lifts a cup of creek water.',
  'Finished a 14-page comic about the chicken coop. Every hen is drawn from life.',
  'Measured the creek depth at the same spot every Monday since September. The chart is on the wall.',
  'Sewed a bag with a lining and a real zipper, second attempt. The first zipper went in backwards.',
  'Made sourdough for the whole pod. Kept a feeding log for 30 days without missing one.',
  'Wired a two-switch circuit so the shop light works from both doors.',
  'Wove a scarf on the four-shaft loom, pattern copied out of a library book by hand.',
  'Recorded the dawn chorus and identified six birds by ear from the tape.',
  'Welded a bike rack, supervised, with a bead a grown-up would sign for.',
  'Built a marble run that takes 41 seconds end to end. Version nine.',
  'Baked bread in thirds and halves all week to get fractions into her hands.',
  'Designed a card game, playtested on the little kids, cut two rules that were not fun.',
  'Carved a spoon out of green wood. Two blisters, one spoon.',
  'Mapped every mushroom in the north woodlot and made spore prints for eleven of them.',
  'Built a ramp at a 22-degree angle because that was what the math said would work.',
  'Led drumming at the harvest share. Twenty-two people, one beat, no conductor.',
];
const FAM_VOICE = [
  '{n} came home and taught the whole dinner table about {i}. We learned something.',
  'We were worried {n} would be behind. {n} is not behind. {n} is somewhere else entirely and it is working.',
  '{n} is the one who {t}. We did not teach that.',
  'Mornings are hard for us right now. {n} is trying. Please read lateness as logistics, not effort.',
  'We speak {lang} at home. {n} switches between both without noticing.',
  '{n} asked to stay an extra hour to finish. We said yes.',
  'The thing about {n} and {i} started here at home and the pod made it bigger.',
  'Grandma moved in this spring. {n} has been quieter. Nothing wrong, just full.',
];
const GUIDE_VOICE = [
  'Reads the room before speaking. When {n} finally says something, everyone stops.',
  '{n} needs the hard thing first thing in the morning. After lunch is for hands.',
  'Working on finishing. {n} starts beautifully and abandons at 80 percent. We are practicing the last 20.',
  'Teaches the younger band without being asked. Consider making it official.',
  'Numbers are lagging the rest. Not a worry yet; adding ten minutes of fluency daily.',
  'Two families moved away this year and {n} lost a friend. Watch the peer connection.',
  'Asked for a harder book and was right to.',
  'Sensory load on loud days. The loft works; {n} knows to use it.',
];

const frags = [];
LEARNERS.forEach((L, i) => {
  const [fn, fam, , interest, truth] = L;
  const n = fn;
  const buddy = LEARNERS[(i + 5) % LEARNERS.length][0];
  frags.push({
    entityId: learnerId(i), kind: 'self', visibility: 'school',
    text: pick(SELF, i * 3 + 1).replace('{v}', pick(VERBS, i * 5)).replaceAll('{i}', interest).replace('{t}', truth).replace('{buddy}', buddy),
    author: { id: learnerId(i).toLowerCase(), role: 'student', name: n }, source: 'seed',
  });
  frags.push({
    entityId: learnerId(i), kind: 'artifact', visibility: 'school',
    text: WORK[i % WORK.length], author: { id: familyId(fam).toLowerCase(), role: 'family', name: `${FAMILIES[fam][0]} family` }, source: 'seed',
  });
  frags.push({
    entityId: learnerId(i), kind: 'family', visibility: 'school',
    text: pick(FAM_VOICE, i * 7 + 2).replaceAll('{n}', n).replaceAll('{i}', interest).replace('{t}', truth).replace('{lang}', FAMILIES[fam][5]),
    author: { id: familyId(fam).toLowerCase(), role: 'family', name: `${FAMILIES[fam][0]} family` }, source: 'seed',
  });
  if (i % 2 === 0) frags.push({
    entityId: learnerId(i), kind: 'observation', visibility: i % 6 === 0 ? 'staff' : 'school',
    text: pick(GUIDE_VOICE, i * 11 + 3).replaceAll('{n}', n),
    author: { id: guideId(1 + (i % 4)).toLowerCase(), role: 'staff', name: GUIDES[1 + (i % 4)][0] }, source: 'seed',
  });
});
for (let i = 0; i < frags.length; i += 40) await store.addFragments(frags.slice(i, i + 40), 'seed');

// Six monthly snapshots per learner so the timeline and the portfolio radar
// have a shape to draw, drifting gently off the current dims.
LEARNERS.forEach((L, i) => {
  const base = store.getEntity(learnerId(i)).dims || {};
  for (let m = 5; m >= 0; m--) {
    const d = new Date(TODAY.getTime() - m * 30 * DAY);
    const at = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const drift = (5 - m) * 0.012 * (hash(i * 53 + 14) > 0.35 ? 1 : -1);
    const dims = {};
    for (const [k, v] of Object.entries(base)) dims[k] = Math.max(0, Math.min(1, v + drift + (hash(i * 59 + m * 7 + k.length) - 0.5) * 0.05));
    store.addSnapshot(learnerId(i), at, dims, 'seed');
  }
});

// ---------------------------------------------------------------- facts
const days = schoolDays(25);
const attendance = [];
LEARNERS.forEach((L, i) => {
  const rate = store.getEntity(learnerId(i)).metrics.attendancePct;
  const absences = Math.round(((100 - rate) / 100) * days.length);
  const out = new Set();
  let h = (i * 2654435761) >>> 0;
  while (out.size < absences) { h = (h * 1103515245 + 12345) >>> 0; out.add(h % days.length); }
  days.forEach((date, di) => attendance.push({
    id: `${learnerId(i)}-${date}`, studentSourcedId: learnerId(i), date,
    code: out.has(di) ? (di % 3 === 0 ? 'absent' : 'excused') : (di % 13 === i % 13 ? 'tardy' : 'present'),
    note: out.has(di) && di % 3 !== 0 ? 'family notified' : undefined,
  }));
});
store.upsertFacts('attendance', attendance, 'seed');

// The term everything is measured against, and the three homeroom groups the
// pod actually runs. Silas's shop group is not a homeroom: learners come to it
// from all three bands.
const TERM = 'TRM-AUTUMN';
store.upsertFacts('academic_sessions', [
  { sourcedId: 'SY-CURRENT', title: `School year ${SCHOOL_YEAR_START.slice(0, 4)}–${Number(SCHOOL_YEAR_START.slice(0, 4)) + 1}`, type: 'schoolYear', startDate: SCHOOL_YEAR_START, endDate: `${Number(SCHOOL_YEAR_START.slice(0, 4)) + 1}-06-30`, schoolYear: SCHOOL_YEAR_START.slice(0, 4) },
  { sourcedId: TERM, title: 'Autumn term', type: 'term', startDate: sinceSchoolYear(56), endDate: ahead(63), schoolYear: SCHOOL_YEAR_START.slice(0, 4), parentSourcedId: 'SY-CURRENT' },
], 'seed');

// [class id, title, guide index, does this grade belong here]
const GROUPS = [
  ['GRP-YOUNGEST', 'Youngest band', 3, (g) => g <= 1],
  ['GRP-MIDDLE', 'Middle band', 2, (g) => g >= 2 && g <= 4],
  ['GRP-OLDER', 'Older band', 1, (g) => g >= 5],
];
const enrollments = [];
store.upsertFacts('classes', [
  ...GROUPS.map(([id, title]) => ({ sourcedId: id, title, classCode: id, classType: 'homeroom', schoolSourcedId: POD.id, termSourcedIds: TERM, grades: 'mixed' })),
  { sourcedId: 'GRP-SHOP', title: 'Making and the shop', classCode: 'GRP-SHOP', classType: 'scheduled', schoolSourcedId: POD.id, termSourcedIds: TERM, subjects: 'making', grades: 'mixed' },
], 'seed');
GROUPS.forEach(([id, , gi, belongs]) => {
  enrollments.push({ sourcedId: `ENL-${id}-guide`, classSourcedId: id, userSourcedId: guideId(gi), role: 'teacher', isPrimary: 1, beginDate: sinceSchoolYear(56), schoolSourcedId: POD.id });
  LEARNERS.forEach((L, i) => { if (belongs(gradeFor(L[2]))) enrollments.push({ sourcedId: `ENL-${id}-${learnerId(i)}`, classSourcedId: id, userSourcedId: learnerId(i), role: 'student', isPrimary: 1, beginDate: sinceSchoolYear(56), schoolSourcedId: POD.id }); });
});
enrollments.push({ sourcedId: 'ENL-GRP-SHOP-guide', classSourcedId: 'GRP-SHOP', userSourcedId: guideId(4), role: 'teacher', isPrimary: 1, beginDate: sinceSchoolYear(40), schoolSourcedId: POD.id });
LEARNERS.forEach((L, i) => { if (gradeFor(L[2]) >= 3) enrollments.push({ sourcedId: `ENL-GRP-SHOP-${learnerId(i)}`, classSourcedId: 'GRP-SHOP', userSourcedId: learnerId(i), role: 'student', beginDate: sinceSchoolYear(40), schoolSourcedId: POD.id }); });
store.upsertFacts('enrollments', enrollments, 'seed');

// Individual learning plans. Reviews land every 90 days; five are overdue, and
// one of those five (Fenna) has not been reviewed since before this term began
// — the difference between "late" and "never got to it".
const OVERDUE = new Set([2, 6, 9, 14, 20]);
const NOT_THIS_TERM = 20;
const GOALS = [
  'Read a chapter book start to finish and tell someone about it||Write three sentences unassisted||Count a jar of beans by tens',
  'Fractions in the kitchen, fluently||Finish a project past the boring part||Explain a plan before building it',
  'Take a measurement without being reminded||Write the steps of a build so someone else could follow||Speak once at every sharing circle',
  'Algebra through the ramp and the loom||Keep a real lab notebook||Teach one skill to the younger band',
  'Read aloud to the little ones twice a week||Type faster than handwriting||Ask for help before the fourth try',
];
store.upsertFacts('learning_plans', LEARNERS.map((L, i) => ({
  id: `ILP-${learnerId(i)}`, studentSourcedId: learnerId(i),
  type: i === 13 ? 'IEP' : i === 6 ? '504' : 'ILP',
  title: `${L[0]}’s learning plan`, status: 'active',
  startDate: ago(210 + (i % 5) * 7),
  reviewDate: i === NOT_THIS_TERM ? ago(74) : OVERDUE.has(i) ? ago(12 + (i % 4) * 9) : ahead(14 + (i * 11) % 70),
  goals: pick(GOALS, i * 3 + 1), owner: guideId(1 + (i % 4)),
  note: i === NOT_THIS_TERM ? 'Not reviewed since last term. This one is the priority.' : OVERDUE.has(i) ? 'Review is past due. Book the family half hour.' : undefined,
})), 'seed');

// Immunizations: most complete, two exemptions on file, one learner with
// nothing recorded at all — which is exactly what compliance should surface.
const VACCINES = ['DTaP', 'Polio', 'MMR', 'Hepatitis B', 'Varicella'];
const NO_RECORD = 17;              // Paloma: nothing on file
const EXEMPT = { 4: 'personal', 11: 'medical' };
const immun = [];
LEARNERS.forEach((L, i) => {
  if (i === NO_RECORD) return;
  if (EXEMPT[i]) {
    immun.push({ id: `${learnerId(i)}-exempt`, studentSourcedId: learnerId(i), vaccine: 'all', exemption: EXEMPT[i], date: ago(300 + i * 3), verifiedBy: guideId(0), note: EXEMPT[i] === 'medical' ? 'Signed by treating physician; on file as a PDF.' : 'Signed statement on file.' });
    return;
  }
  VACCINES.forEach((v, k) => immun.push({
    id: `${learnerId(i)}-${v.toLowerCase().replace(/[^a-z]/g, '')}`, studentSourcedId: learnerId(i),
    vaccine: v, doseNumber: v === 'MMR' ? 2 : 1, exemption: 'none',
    date: ago(365 + i * 11 + k * 30), verifiedBy: guideId(0),
  }));
});
store.upsertFacts('immunizations', immun, 'seed');

// Paperwork. A few gaps and two expiries so the checklist is not all green.
const DOC_TYPES = [
  ['enrollment', 'Enrollment agreement'],
  ['emergency-card', 'Emergency card'],
  ['custody', 'Custody / release authorization'],
  ['consent', 'Photo and field-trip consent'],
  ['residency', 'Proof of residency'],
];
const docs = [];
LEARNERS.forEach((L, i) => DOC_TYPES.forEach(([type, title], k) => {
  const miss = (i + k) % 17 === 3;                 // a handful never came back
  const expired = type === 'consent' && (i % 9 === 4); // consent lapses yearly
  docs.push({
    id: `DOC-${learnerId(i)}-${type}`, subjectType: 'student', subjectSourcedId: learnerId(i),
    type, title, status: miss ? 'missing' : expired ? 'expired' : 'on-file',
    issuedDate: miss ? undefined : ago(200 + i * 4 + k * 9),
    expiresDate: type === 'consent' ? (expired ? ago(20 + i) : ahead(120 + i * 3)) : undefined,
    path: miss ? undefined : `documents/${learnerId(i)}/${type}.pdf`,
    note: miss ? 'Asked at pickup twice. Send the form home again.' : undefined,
  });
}));
docs.push({
  id: 'DOC-POD-affidavit', subjectType: 'organization', subjectSourcedId: POD.id,
  type: 'private-school-affidavit', title: 'Private school affidavit (state filing)', status: 'on-file',
  issuedDate: sinceSchoolYear(45), expiresDate: ahead(320), path: `documents/pod/affidavit-${SCHOOL_YEAR_START.slice(0, 4)}.pdf`,
  note: 'Filed annually. In California this is the R-4 window in October; check your own state.',
});
docs.push({
  id: 'DOC-POD-insurance', subjectType: 'organization', subjectSourcedId: POD.id,
  type: 'insurance', title: 'General liability certificate', status: 'on-file', issuedDate: ago(160), expiresDate: ahead(205), path: 'documents/pod/coi.pdf',
});
docs.push({
  id: 'DOC-POD-firemarshal', subjectType: 'organization', subjectSourcedId: POD.id,
  type: 'facility-inspection', title: 'Fire marshal walkthrough', status: 'missing',
  note: 'Never scheduled. The barn conversion is the reason to do this.',
});
store.upsertFacts('documents', docs, 'seed');

// Adults: background checks, CPR, mandated reporter. One CPR card is about to
// lapse, one background check for the newest guide is still pending.
const creds = [];
GUIDES.forEach((G, i) => {
  creds.push({ id: `CRD-${guideId(i)}-bg`, staffSourcedId: guideId(i), type: 'background-check', status: i === 4 ? 'pending' : 'valid', issuedDate: i === 4 ? undefined : ago(300 + i * 20), expiresDate: i === 4 ? undefined : ahead(430 - i * 20), issuer: 'State DOJ / FBI', note: i === 4 ? 'Submitted; prints taken, waiting on the state.' : undefined });
  creds.push({ id: `CRD-${guideId(i)}-print`, staffSourcedId: guideId(i), type: 'fingerprinting', status: 'valid', issuedDate: ago(305 + i * 20), issuer: 'Live Scan' });
  creds.push({ id: `CRD-${guideId(i)}-cpr`, staffSourcedId: guideId(i), type: 'cpr', status: 'valid', issuedDate: ago(700 - i * 30), expiresDate: i === 2 ? ahead(21) : ahead(300 + i * 40), issuer: 'Red Cross', note: i === 2 ? 'Expires in three weeks. Two other guides can recertify the same morning.' : undefined });
  creds.push({ id: `CRD-${guideId(i)}-mr`, staffSourcedId: guideId(i), type: 'mandated-reporter', status: i === 3 ? 'expired' : 'valid', issuedDate: ago(i === 3 ? 800 : 200 + i * 15), expiresDate: i === 3 ? ago(70) : ahead(160 + i * 25), issuer: 'State online training' });
});
// Teaching credentials. Marguerite, Hana, and Ruth hold one; Silas is mid-
// certification; Theo does not have one at all, which is ordinary in a
// microschool and is exactly the kind of thing the checklist should say out
// loud rather than leave to a conversation nobody has.
[
  { i: 0, type: 'teaching-credential', status: 'valid', issuer: 'State multiple-subject', expires: ahead(900) },
  { i: 2, type: 'montessori-credential', status: 'valid', issuer: 'AMI 6–12', expires: null },
  { i: 3, type: 'early-childhood-credential', status: 'valid', issuer: 'State ECE permit', expires: ahead(540) },
  { i: 4, type: 'guide-certification', status: 'pending', issuer: 'Pod internal, in progress', expires: null },
].forEach((c) => creds.push({
  id: `CRD-${guideId(c.i)}-cred`, staffSourcedId: guideId(c.i), type: c.type, status: c.status,
  issuedDate: c.status === 'valid' ? ago(400 + c.i * 60) : undefined, expiresDate: c.expires || undefined, issuer: c.issuer,
  note: c.status === 'pending' ? 'Started in the spring; two observations left.' : undefined,
}));
store.upsertFacts('staff_credentials', creds, 'seed');

// Drills: fire practiced recently, and drop-cover-hold six weeks ago. There is
// no drill labelled "lockdown" and that is on purpose — a pod this size is more
// likely to have practised an earthquake than an intruder, and the checks count
// any practised non-fire emergency, so the honest answer here is a pass.
store.upsertFacts('drills', [
  { id: 'DRL-fire-1', orgSourcedId: POD.id, type: 'fire', date: ago(18), durationMinutes: 4, participants: 27, ledBy: guideId(0), note: 'Everyone out to the oak in 3:50. Two of the youngest needed a hand.' },
  { id: 'DRL-fire-2', orgSourcedId: POD.id, type: 'fire', date: ago(128), durationMinutes: 6, participants: 25, ledBy: guideId(0) },
  { id: 'DRL-earthquake-1', orgSourcedId: POD.id, type: 'earthquake', date: ago(40), durationMinutes: 8, participants: 26, ledBy: guideId(1), note: 'Drop-cover-hold under the long tables. The loft plan needs work.' },
], 'seed');

// One incident, resolved the way a pod resolves things. Recorded not because
// it was grave but because "we wrote down what happened and what we did" is
// the whole point — an unrecorded incident is the one that becomes a problem.
store.upsertFacts('discipline_incidents', [{
  id: 'INC-001', studentSourcedId: learnerId(19), date: ago(27), type: 'conflict',
  description: 'Shoved another learner off the ramp during a disagreement about whose turn it was.',
  action: 'Restorative conversation with both learners and both families the same afternoon; ramp turn-taking rules written by the older band and posted.',
  reportedBy: guideId(4), schoolSourcedId: POD.id,
}], 'seed');

store.upsertFacts('enrollment_events', LEARNERS.map((L, i) => ({
  id: `ENR-${learnerId(i)}`, studentSourcedId: learnerId(i), orgSourcedId: POD.id,
  event: 're-enrolled', date: ago(i < 16 ? 220 : 40 + i),
  reason: i < 16 ? 'Returning family' : 'Joined mid-year',
})), 'seed');

const contacts = [];
FAMILIES.forEach((F, fi) => {
  const kids = LEARNERS.map((L, i) => (L[1] === fi ? i : -1)).filter((i) => i >= 0);
  kids.forEach((i) => {
    contacts.push({ id: `CON-${learnerId(i)}-1`, studentSourcedId: learnerId(i), name: F[1], relation: F[2], email: `${F[1].split(' ')[0].toLowerCase()}@example.org`, phone: `555-01${String(fi + 10).padStart(2, '0')}`, language: F[5], isPrimary: 1 });
    if (F[3]) contacts.push({ id: `CON-${learnerId(i)}-2`, studentSourcedId: learnerId(i), name: F[3], relation: F[4], phone: `555-02${String(fi + 10).padStart(2, '0')}`, language: F[5], isPrimary: 0 });
    contacts.push({ id: `CON-${learnerId(i)}-3`, studentSourcedId: learnerId(i), name: pick(['Aunt Berthe', 'Uncle Samir', 'Neighbor: the Alvarez house', 'Grandpa Ned', 'Ms. Odili next door'], i + fi), relation: 'emergency', phone: `555-03${String(fi + 10).padStart(2, '0')}`, isPrimary: 0 });
  });
});
store.upsertFacts('contacts', contacts, 'seed');

// ---------------------------------------------------------------- apps
const manifest = JSON.parse(fs.readFileSync(path.join(HERE, 'apps/manifest.json'), 'utf8'));
const now = new Date().toISOString();
for (const a of manifest.apps) {
  const html = fs.readFileSync(path.join(HERE, 'apps', a.file), 'utf8');
  fs.mkdirSync(path.join(dataDir, 'apps', a.slug), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'apps', a.slug, 'v1.html'), html);
  store.upsertApp({
    slug: a.slug, title: a.title, prompt: a.prompt, provider: 'edition', model: 'micro-starter',
    scope: a.scope, author: { username: 'admin', role: 'admin', displayName: 'Lead guide' },
    createdAt: now, updatedAt: now, version: 1, published: true, templateGenerated: true,
    warnings: [], history: [{ version: 1, prompt: a.prompt, createdAt: now, by: 'admin' }],
  }, 'seed');
}

// ---------------------------------------------------------------- accounts
const logins = [];
if (!keep && !auth.bootstrapped) {
  auth.createUser({ username: 'admin', password: 'librea-admin', role: 'admin', entityId: guideId(0), displayName: 'Marguerite Delacroix (lead guide)' });
  logins.push('admin / librea-admin');
  GUIDES.slice(1).forEach((G, k) => {
    const u = G[0].toLowerCase();
    auth.createUser({ username: u, password: 'librea-guide', role: 'staff', entityId: guideId(k + 1), displayName: `${G[0]} ${G[1]}` });
    if (k === 0) logins.push(`${u} / librea-guide`);
  });
  auth.createUser({ username: 'nneka', password: 'librea-learner', role: 'student', entityId: learnerId(0), displayName: 'Nneka Okonkwo' });
  logins.push('nneka / librea-learner');
  const okonkwoKids = LEARNERS.map((L, i) => (L[1] === 0 ? learnerId(i) : null)).filter(Boolean);
  auth.createUser({ username: 'okonkwo.family', password: 'librea-family', role: 'family', entityIds: okonkwoKids, displayName: 'Okonkwo family' });
  logins.push('okonkwo.family / librea-family');
}

const invites = keep ? [] : [
  auth.createInvite({ role: 'family', displayName: 'New family', days: 30, createdBy: 'admin' }),
  auth.createInvite({ role: 'family', displayName: 'New family', days: 30, createdBy: 'admin' }),
  auth.createInvite({ role: 'staff', displayName: 'New guide', days: 30, createdBy: 'admin' }),
];

sql.close();
store.snapshot();
const s = store.stats();
console.log(`\n${POD.name}: ${s.students} learners, ${s.families} families, ${s.staff} guides, ${s.fragments} voices, ${s.apps} starter apps.`);
console.log(`Facts: ${attendance.length} attendance rows over ${days.length} days, ${enrollments.length} enrollments in 4 groups, ${immun.length} immunization rows, ${docs.length} documents, ${creds.length} credentials, ${contacts.length} contacts.`);
console.log(`Ledger head: ${store.ledger.verify().head.slice(0, 12)} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (logins.length) console.log(`Demo logins: ${logins.join(', ')}`);
if (invites.length) console.log(`Open invite codes: ${invites.map((i) => `${i.code} (${i.role})`).join(', ')}`);
console.log(`Full roster: ${LEARNERS.map((L, i) => fullName(i)).slice(0, 3).join(', ')}, ... (${LEARNERS.length} total)\n`);
