// Offline design packages. No model, no key, no network: the Design → Data
// flow works on a laptop with the cable unplugged. Each layout is a complete
// design document with a manifest, empty data-slot regions, and CSS for the
// binder's markup. Samples are generic placeholders, never a person.
import { DESIGN_VERSION } from './design.js';

const CSS = `
:root{--bg:#faf7f2;--card:#fff;--ink:#23201c;--mut:#6d6559;--line:#e7e0d5;--accent:#3d6b8e;--warm:#c97b4a;--radius:14px}
@media (prefers-color-scheme:dark){:root{--bg:#1a1815;--card:#232019;--ink:#f0ebe3;--mut:#a79c8d;--line:#3a352c;--accent:#7fa8c9;--warm:#e0a077}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:1040px;margin:0 auto;padding:28px 20px 40px}
h1{font-size:clamp(22px,4vw,30px);margin:0 0 6px;letter-spacing:-.01em}
h2{font-size:17px;margin:0 0 12px;letter-spacing:-.005em}
.sub{color:var(--mut);margin:0 0 24px;max-width:62ch}
.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(min(240px,100%),1fr));margin-bottom:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:18px;position:relative}
.chart{min-height:260px}
.lb-stat-value{font-size:30px;font-weight:650;letter-spacing:-.02em;margin:2px 0 0}
.lb-stat-label{color:var(--mut);font-size:13px;text-transform:uppercase;letter-spacing:.06em}
.lb-stat-note{color:var(--mut);font-size:13px;margin-top:4px}
.lb-chart{width:100%;display:block}
.lb-table{width:100%;border-collapse:collapse;font-size:14.5px}
.lb-table th,.lb-table td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line)}
.lb-table th{color:var(--mut);font-weight:600;font-size:12.5px;text-transform:uppercase;letter-spacing:.05em}
.lb-table tbody tr:hover{background:rgba(0,0,0,.025)}
.lb-list{list-style:none;margin:0;padding:0}
.lb-list li{padding:10px 0;border-bottom:1px solid var(--line);display:flex;gap:10px;flex-wrap:wrap;align-items:baseline}
.lb-list-title{font-weight:600}
.lb-list-sub{color:var(--mut)}
.lb-list-meta{margin-left:auto;color:var(--mut);font-size:13px}
.lb-text{margin:0 0 10px;max-width:70ch}
.lb-empty{color:var(--mut);padding:22px;text-align:center;border:1px dashed var(--line);border-radius:var(--radius);margin:0}
.lb-error{color:#b4585f;padding:12px;border:1px solid #b4585f33;border-radius:10px;background:#b4585f0d;margin:0}
.lb-note{color:var(--mut);font-size:13px;margin:8px 0 0}
.lb-sample-tag{position:absolute;top:10px;right:12px;font-size:11px;padding:2px 8px;border-radius:999px;background:rgba(201,123,74,.16);color:#a8622f;letter-spacing:.04em;text-transform:uppercase}
.scroll{overflow-x:auto}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`.trim();

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const stat = (id, label, hint, sample) => ({ id, kind: 'stat', label, hint, sample: [{ value: sample, label }] });
const bar = (id, label, hint, labels, values) => ({ id, kind: 'bar', label, hint, sample: labels.map((l, i) => ({ label: l, value: values[i] })) });
const line = (id, label, hint, labels, values) => ({ id, kind: 'line', label, hint, sample: labels.map((l, i) => ({ label: l, value: values[i] })) });
const table = (id, label, hint, columns, sample, empty) => ({ id, kind: 'table', label, hint, columns, sample, empty });

const SCHOOLS = ['School A', 'School B', 'School C', 'School D'];
const WEEKS = ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5', 'Week 6'];

function region(slot, cls = '') {
  const inner = slot.kind === 'bar' || slot.kind === 'line' ? 'chart' : slot.kind === 'table' ? 'scroll' : '';
  return `<section class="card ${cls}">${slot.kind === 'stat' ? '' : `<h2>${esc(slot.label)}</h2>`}<div class="${inner}" data-slot="${slot.id}"></div></section>`;
}

function document_(title, sub, manifestSlots, body) {
  const manifest = { librea: DESIGN_VERSION, title, slots: manifestSlots };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${CSS}</style>
<script id="librea-design" type="application/json">${JSON.stringify(manifest, null, 1).replace(/<\//g, '<\\/')}</script>
</head>
<body>
<main class="wrap">
<h1>${esc(title)}</h1>
<p class="sub">${esc(sub)}</p>
${body}
</main>
</body>
</html>`;
}

// ------------------------------------------------------------------ layouts

function attendance(title) {
  const slots = [
    stat('students-total', 'Students', 'how many students are enrolled', 1240),
    stat('absence-rate', 'Absence rate', 'percent of student-days marked absent or excused, all schools', 5.2),
    stat('chronic-absent', 'Chronically absent', 'how many students have attendance below 90 percent', 61),
    bar('absence-by-school', 'Absence rate by school', 'percent of days absent, one bar per school', SCHOOLS, [6.1, 4.4, 8.0, 3.7]),
    line('absence-over-time', 'Absences over time', 'number of absences per week, in order', WEEKS, [40, 52, 38, 61, 47, 44]),
    table('watch-list', 'Worth a conversation', 'students whose attendance is slipping, with grade, school, and how many absences',
      [{ key: 'grade', label: 'Grade' }, { key: 'school', label: 'School' }, { key: 'absences', label: 'Absences' }],
      [{ grade: 5, school: 'School A', absences: 7 }, { grade: 8, school: 'School C', absences: 5 }, { grade: 3, school: 'School B', absences: 4 }],
      'Nobody is on this list right now.'),
  ];
  const body = `<div class="grid">${region(slots[0])}${region(slots[1])}${region(slots[2])}</div>
<div class="grid">${region(slots[3])}${region(slots[4])}</div>
${region(slots[5])}`;
  return { name: 'attendance', html: document_(title, 'Where attendance stands, and who might need a conversation. Patterns are questions for a person, not verdicts.', slots, body) };
}

function overview(title) {
  const slots = [
    stat('students-total', 'Students', 'how many students are enrolled', 1240),
    stat('schools-total', 'Schools', 'how many schools are in the district', 4),
    stat('on-track', 'On track', 'how many students are currently on track', 980),
    bar('students-by-grade', 'Students by grade', 'number of students in each grade, in grade order', ['K', '1', '2', '3', '4', '5'], [190, 205, 210, 198, 220, 217]),
    bar('students-by-outcome', 'Where students stand', 'number of students in each standing (on track, watch, and so on)', ['on track', 'watch', 'resilient'], [980, 150, 60]),
    table('by-school', 'By school', 'one row per school with student count and average attendance',
      [{ key: 'school', label: 'School' }, { key: 'students', label: 'Students' }, { key: 'attendance', label: 'Attendance %' }],
      SCHOOLS.map((s, i) => ({ school: s, students: 300 + i * 20, attendance: 94 - i })),
      'No schools yet.'),
  ];
  const body = `<div class="grid">${region(slots[0])}${region(slots[1])}${region(slots[2])}</div>
<div class="grid">${region(slots[3])}${region(slots[4])}</div>
${region(slots[5])}`;
  return { name: 'overview', html: document_(title, 'A one-page picture of the district, on the district’s own machine.', slots, body) };
}

function personal(title) {
  const slots = [
    stat('my-attendance', 'My attendance', 'my attendance percentage this year', 93),
    stat('my-gpa', 'My GPA', 'my grade point average', 3.4),
    line('my-attendance-over-time', 'My attendance by week', 'my attendance each week, in order', WEEKS, [100, 80, 100, 100, 60, 100]),
    table('my-recent-work', 'Recent work', 'my most recent graded assignments with title, due date, and score',
      [{ key: 'title', label: 'Assignment' }, { key: 'dueDate', label: 'Due' }, { key: 'score', label: 'Score' }],
      [{ title: 'Fractions quiz', dueDate: '2025-01-10', score: 18 }, { title: 'Reading response', dueDate: '2025-01-08', score: 9 }],
      'No graded work yet.'),
  ];
  const body = `<div class="grid">${region(slots[0])}${region(slots[1])}</div>
${region(slots[2])}
${region(slots[3])}`;
  return { name: 'personal', html: document_(title, 'My year so far. This page shows only my own record.', slots, body) };
}

const MATCHERS = [
  { name: 'personal', re: /\b(my|me|mine|myself|i am|i'm)\b/i, fn: personal },
  { name: 'attendance', re: /\b(attend|absen|absence|absent|tardy|chronic)/i, fn: attendance },
];

export function chooseDesignTemplate(prompt) {
  const p = String(prompt || '');
  for (const m of MATCHERS) if (m.re.test(p)) return m.name;
  return 'overview';
}

export function renderDesignTemplate(prompt, title) {
  const name = chooseDesignTemplate(prompt);
  const fn = MATCHERS.find((m) => m.name === name)?.fn || overview;
  const t = String(title || 'Librea page').slice(0, 120);
  return { template: name, html: fn(t).html };
}

export const DESIGN_TEMPLATE_NAMES = MATCHERS.map((m) => m.name).concat('overview');
