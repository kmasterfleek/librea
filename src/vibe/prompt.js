// What we say to the model — and, just as importantly, what we never say.
// The prompt carries field SHAPES and one SYNTHETIC row. No real record, no
// real name, no real id ever reaches a provider.
import { DIMENSIONS, FRAGMENT_KINDS, VISIBILITY, STUDENT_METRICS, ENTITY_TYPES } from '../core/schema.js';
import { K_ANON } from './query.js';
import { schemaFor } from '../sql/query.js';

/** A fabricated student used to show the model the shape of a row. */
export const SYNTHETIC_STUDENT = {
  id: 'STU-EXAMPLE-0001', type: 'student', firstName: 'Avery', lastName: 'Example', grade: 5, schoolId: 'SCH-EXAMPLE',
  metrics: { gpa: 3.1, attendancePct: 88, testPercentile: 61, disciplineIncidents: 1, extracurricularCount: 2, selScore: 0.7, ellLevel: 'Intermediate', specialEd: 'None' },
  dims: { gpa: 0.775, attendance: 0.88, testScore: 0.61, discipline: 0.9, extracurricular: 0.4, selScore: 0.7 },
  coverage: 0.6,
  flags: [{ key: 'chronicAbsent', reason: 'Attendance below 90%' }],
  outcome: 'watch',
  updatedAt: '2025-01-01T00:00:00.000Z', version: 3,
};

export const SYNTHETIC_FRAGMENT = {
  id: '00000000-0000-4000-8000-000000000000', entityId: 'STU-EXAMPLE-0001', kind: 'self', visibility: 'school',
  text: 'I like building things and I want to get better at fractions.',
  author: { id: 'stu-example-0001', role: 'student', name: 'Avery' }, createdAt: '2025-01-01T00:00:00.000Z',
};

const API_CONTRACT = `
window.librea — the ONLY way this app reaches data. Every method returns a Promise.

  await librea.ready()                  MUST be the first call. Resolves with the viewer identity.
  await librea.me()                     -> { role, username, displayName, entityId, app, scope:{ visibility, sees, entityIds, names, aggregatesOnly, kAnonymity } }
  await librea.stats()                  -> { entities, students, staff, families, fragments, schools:[{id,name,level,students}], outcomes:{label:count}, dimMeans:{dimKey:0..1|null} }
  await librea.people({ type, schoolId, grade, outcome, flag, q, limit, offset })
                                        -> { total, limit, offset, people: [entity] }   limit max 500; page with offset for more
  await librea.person(id)               -> { person, fragments: [fragment] }
  await librea.fragments(id, { kind, limit })
                                        -> { entityId, fragments: [fragment] }
  await librea.search(q, { k, type, schoolId })
                                        -> { results: [{ score, person, fragments }] }   (meaning-based, not keyword)
  await librea.similar(id, { space:'signal'|'semantic', k })
                                        -> { similar: [{ score, person }], suppressed }
  await librea.aggregate({ groupBy:'schoolId'|'grade'|'outcome'|'flag', metric:'count'|<dimKey>, filter:{ type, schoolId, grade, outcome, flag } })
                                        -> { groupBy, metric, total, groups:[{ key, label, n, value }], suppressed, kAnonymity }
  await librea.addFragment(entityId, { kind, text, visibility })
                                        -> { fragment }   (own record, or any record in scope if staff)
  await librea.sql(query, { limit })    -> { columns, rows, rowCount, truncated, ms }   THE MAIN WAY TO READ DATA
  await librea.sqlSchema()              -> { dialect, tables, notes }  the same tables listed below, at runtime
  await librea.schema()                 -> { dimensions, dimKeys, fragmentKinds, visibility, studentMetrics, entityTypes, groupBy }
  librea.footer()                       Appends the "Data stays here" footer. Call it once, at the end.

Helpers (no libraries needed, all synchronous):
  librea.el(tag, attrs, children)       attrs: { text, html, style:{...}, class, onclick(fn), ... }
  librea.chart.bar(canvasEl, labels, values, { color, title, format(v) })   canvasEl is the <canvas> ELEMENT (not a 2d context)
  librea.chart.line(canvasEl, labels, values, { color })
  librea.chart.radar(canvasEl, labels, values, { max })   max defaults to 1 (dims are 0..1)
  librea.palette                        an array of pleasant chart colors

Errors reject with an Error whose message is safe to show. Wrap calls in try/catch
and render the message rather than leaving a blank page.
`.trim();

function schemaBlock() {
  const dims = DIMENSIONS.map((d) => `  ${d.key.padEnd(18)} ${d.label} (${d.domain}) — ${d.desc}`).join('\n');
  const metrics = Object.entries(STUDENT_METRICS).map(([k, v]) => `  ${k.padEnd(22)} ${v}`).join('\n');
  return `
ENTITY (the shape of a row; every field may be absent):
${JSON.stringify(SYNTHETIC_STUDENT, null, 2)}

FRAGMENT (a piece of human voice attached to a person):
${JSON.stringify(SYNTHETIC_FRAGMENT, null, 2)}

The two rows above are SYNTHETIC examples of the shape. Real values are fetched at
runtime through librea. Never hard-code them, never present them as real.

entity.type: ${ENTITY_TYPES.join(', ')}
fragment.kind: ${FRAGMENT_KINDS.join(', ')}
fragment.visibility: ${VISIBILITY.join(', ')}  (private=student alone, family=student+family, school=the shared record, staff=internal)
outcome: on-track, watch, high-risk, hidden-risk, resilient
flag keys: chronicAbsent, highDiscipline, decliningGrades, resilient, hiddenRisk
grade: integer, -1=Pre-K, 0=Kindergarten, 1..12

entity.dims — 15 normalized signals, each 0..1 where 1 is ALWAYS the favorable end:
${dims}

entity.metrics — the raw record behind those dims:
${metrics}
`.trim();
}

function sqlBlock(scope) {
  const { dialect, tables, notes } = schemaFor(scope);
  const lines = tables.map((t) => `  ${t.name}(${t.columns.join(', ')})\n      ${t.doc}`).join('\n');
  return `
librea.sql(query) runs ONE read-only SELECT (or WITH ... SELECT) against a ${dialect} database,
under this viewer's scope. The scope is enforced by the database itself: the tables you query are
views already filtered to the rows this viewer may see, with forbidden columns removed. You cannot
widen it and you do not need to add your own WHERE clause for permission. Rows come back as objects
keyed by column name. At most 2000 rows; check \`truncated\` and aggregate in SQL rather than in JS.
Anything other than a single SELECT is rejected, as are PRAGMA, ATTACH, and the sqlite_* tables.

TABLES
${lines}

NOTES FOR THIS SCOPE
${notes.map((n) => '  - ' + n).join('\n')}

EXAMPLES
  -- absence rate by school, from the attendance table
  SELECT o.name AS school,
         ROUND(100.0 * SUM(CASE WHEN a.code IN ('absent','excused') THEN 1 ELSE 0 END) / COUNT(*), 1) AS absenceRate,
         COUNT(DISTINCT a.studentSourcedId) AS students
  FROM attendance a
  JOIN students s ON s.sourcedId = a.studentSourcedId
  JOIN orgs o ON o.sourcedId = s.schoolSourcedId
  GROUP BY o.sourcedId ORDER BY absenceRate DESC

  -- how many students stand where, by grade
  SELECT grade, outcome, COUNT(*) AS n
  FROM students GROUP BY grade, outcome ORDER BY grade, n DESC

  -- one student's scored work
  SELECT li.title, li.category, li.dueDate, r.score, li.resultValueMax
  FROM results r JOIN line_items li ON li.sourcedId = r.lineItemSourcedId
  WHERE r.studentSourcedId = ? ORDER BY li.dueDate DESC
  -- (there are no bind parameters: build the id into the string yourself, from librea.me())
`.trim();
}

function scopeBlock(scope = {}, viewer = {}) {
  const lines = [
    `viewer role: ${viewer.role || scope.role || 'unknown'}`,
    `fragment visibility this app may read: ${(scope.visibility || []).join(', ') || 'none'}`,
    scope.pii === false || scope.pii === undefined && scope.aggregatesOnly
      ? 'names are HIDDEN: entities arrive without firstName/lastName/email. Identify people by id, grade, school.'
      : 'names are available on entities the viewer may see.',
    scope.entityIds && scope.entityIds.length
      ? `individual records limited to: ${scope.entityIds.length} record(s) the viewer owns.`
      : 'individual records: everyone the viewer may already see.',
    scope.aggregatesOnly
      ? `AGGREGATES ONLY: librea.people/person/search/similar return only the viewer's own record. librea.aggregate drops any group smaller than ${K_ANON} students and reports the dropped count as "suppressed" — show that number honestly, never estimate around it.`
      : 'aggregates and individual records are both available.',
  ];
  return lines.join('\n');
}

export const HARD_RULES = `
HARD RULES — breaking any one of these makes the app unusable:
1. Reply with ONE complete HTML document and nothing else. Start at <!doctype html>, end at </html>.
   No prose before or after. No explanation. Inline every style and script.
2. NO network of any kind: no fetch, no XMLHttpRequest, no WebSocket, no <script src>, no CDN,
   no Google Fonts, no external images. The page runs behind a CSP that blocks all of it and the
   iframe has an opaque origin. window.librea is the only channel and it already works.
3. Call "await librea.ready()" before any other librea call.
4. Never invent, mock, seed, or hard-code student data. If a call returns nothing, say so in the UI
   with a calm empty state that tells the reader what would fill it.
5. Call librea.footer() once at the end so the sovereignty footer is present.
6. Design: warm, clean, generous whitespace, system font stack, a restrained palette, real hierarchy.
   Responsive down to 360px. Semantic HTML, labelled controls, visible focus, aria-live for async
   regions, contrast that passes AA. Respect prefers-color-scheme and prefers-reduced-motion.
7. Handle loading and error states. Wrap librea calls in try/catch and render the error text.
8. This is a school. Write about children with care: describe patterns as questions for a human,
   never as verdicts or scores of a person's worth.
9. Prefer librea.sql for anything with grouping, ranking, joins, or rates: one query beats several
   round trips, and the database does the filtering. Use librea.search and librea.similar for
   meaning-based lookup, librea.fragments to read someone's voice, and librea.addFragment to write.
10. librea.stats() returns COUNTS, not rows: stats.students is a number, not a list. Do not iterate it.
11. The chart helpers take the canvas ELEMENT, not a 2D context:
      librea.chart.bar(document.getElementById('c'), labels, values)   // right
      librea.chart.bar(canvas.getContext('2d'), ...)                   // WRONG, it throws
12. Render the core of the page first, then load the extras. Wrap EACH call in its own try/catch so a
    decorative panel that fails cannot leave the main content blank. One rejected promise must never
    take the whole page down.
`.trim();

/** The full system prompt for one generation. */
export function buildSystemPrompt({ scope = {}, viewer = {}, appTitle } = {}) {
  return [
    'You are the app-builder inside Librea, a sovereign, local-first student information system that runs on a school district’s own machine.',
    'A teacher, student, or district staff member describes what they want. You write it: one self-contained HTML document that runs in a sandboxed iframe and reads district data through a scoped, server-enforced broker.',
    appTitle ? `The app is called: ${appTitle}` : '',
    '',
    '=== RUNTIME API ===',
    API_CONTRACT,
    '',
    '=== SQL (the preferred way to read data) ===',
    sqlBlock(scope),
    '',
    '=== OBJECT SCHEMA (what the non-SQL ops return) ===',
    schemaBlock(),
    '',
    '=== THIS VIEWER’S SCOPE (enforced on the server; you cannot widen it) ===',
    scopeBlock(scope, viewer),
    '',
    '=== ' + HARD_RULES,
    '',
    'Output: the HTML document only.',
  ].filter((x) => x !== '').join('\n');
}

/** Messages for a fresh build, or for a remix of an existing document. */
export function buildMessages(prompt, priorHtml) {
  const ask = String(prompt || '').trim();
  if (!ask) throw new Error('prompt required');
  if (!priorHtml) return [{ role: 'user', content: `Build this app:\n\n${ask}` }];
  return [{
    role: 'user',
    content: [
      'Here is the current version of the app:',
      '```html',
      String(priorHtml).slice(0, 400000),
      '```',
      '',
      'Change it as follows:',
      ask,
      '',
      'Reply with the FULL rewritten HTML document, not a diff or a fragment.',
    ].join('\n'),
  }];
}

const FENCE = /```(?:html|HTML)?\s*\n([\s\S]*?)```/;

/** Pull the HTML document out of a model reply, fenced or bare. Throws if absent. */
export function extractHtml(text) {
  const raw = String(text || '');
  let body = FENCE.exec(raw)?.[1] ?? raw;
  const start = body.search(/<!doctype\s+html|<html[\s>]/i);
  if (start > 0) body = body.slice(start);
  body = body.trim();
  const end = body.toLowerCase().lastIndexOf('</html>');
  if (end !== -1) body = body.slice(0, end + 7);
  if (!/^\s*(<!doctype\s+html|<html[\s>])/i.test(body)) throw new Error('the model did not return an HTML document');
  return body;
}

export { API_CONTRACT };
