// What the design model is told, and what it is never told.
// This prompt carries the request, a closed slot vocabulary, and the class
// names the binder emits. It carries NO table names, NO column names, NO
// field shapes, and no example row, synthetic or otherwise. The model
// designs; it never learns what the district's data looks like.
import { SLOT_KINDS, SLOT_KIND_NAMES, BINDER_CLASSES, DESIGN_VERSION } from './design.js';

const VOCAB = SLOT_KIND_NAMES.map((k) => `  ${k.padEnd(7)} ${SLOT_KINDS[k].doc}`).join('\n');

const EXAMPLE = `
<script id="librea-design" type="application/json">
{
  "librea": ${DESIGN_VERSION},
  "title": "Attendance at a glance",
  "slots": [
    { "id": "students-total", "kind": "stat", "label": "Students", "hint": "how many students are enrolled",
      "sample": [{ "value": 1240, "label": "Students" }] },
    { "id": "absence-by-school", "kind": "bar", "label": "Absence rate by school", "hint": "percent of days absent, one bar per school",
      "sample": [{ "label": "School A", "value": 6.1 }, { "label": "School B", "value": 4.4 }, { "label": "School C", "value": 8.0 }] },
    { "id": "watch-list", "kind": "table", "label": "Worth a conversation", "hint": "students whose attendance is slipping",
      "columns": [{ "key": "grade", "label": "Grade" }, { "key": "school", "label": "School" }, { "key": "absences", "label": "Absences" }],
      "empty": "Nobody is on this list right now.",
      "sample": [{ "grade": 5, "school": "School A", "absences": 7 }, { "grade": 8, "school": "School C", "absences": 5 }] }
  ]
}
</script>

<section class="card">
  <h2>Absence rate by school</h2>
  <div class="chart" data-slot="absence-by-school"></div>
</section>
`.trim();

export const DESIGN_RULES = `
HARD RULES — breaking any one of these makes the design unusable:
1. Reply with ONE complete HTML document and nothing else. Start at <!doctype html>, end at </html>.
   No prose before or after. All CSS inline in one <style>. No <script> except the manifest.
2. The ONLY script in the document is the manifest:
     <script id="librea-design" type="application/json">{ "librea": ${DESIGN_VERSION}, "title": "...", "slots": [...] }</script>
   No other <script>, no on* attributes, no javascript: URLs, no <form>, <iframe>, <object>, <embed>.
   You are designing a page, not programming one. A binder is added afterwards on the district's machine.
3. Every data region is an element with data-slot="<id>" and is otherwise EMPTY. The binder fills it.
   Every slot in the manifest has exactly one such element, and every data-slot element is in the manifest.
4. Slot kinds come from this closed vocabulary. Do not invent kinds.
${VOCAB}
   Give each slot a short "hint": one plain sentence saying what data belongs there, in everyday words
   ("percent of days absent, one bar per school"). Someone in the district turns the hint into a query later.
5. Give each slot a "sample": 1 to 12 rows of obviously made-up placeholder data in the slot's shape, so the
   design can be previewed. Use generic labels like "School A", "Grade 5", "Week 3". NEVER a person's name,
   never anything that looks like a real record. Samples are shown only during design review and are
   never shown to a reader.
6. No network of any kind: no <link href="http...">, no @import, no url(http...), no web fonts, no remote
   images, no CDN. System font stack only. Inline SVG and data: URIs are fine. The page runs behind a CSP
   that blocks everything else.
7. Style the binder's markup with CSS. Inside a data-slot region the binder emits these classes, and only these:
     ${BINDER_CLASSES.join(', ')}
   Charts are drawn on a <canvas class="lb-chart"> that fills its region, so give bar and line regions an
   explicit height (240px or more). Tables are <table class="lb-table"> with <thead> and <tbody>. Lists are
   <ul class="lb-list">. A stat is <div class="lb-stat"> with value, label, and note children.
   .lb-empty and .lb-error are short paragraphs; .lb-sample-tag is a small badge on a previewed region.
8. Design: warm, clean, generous whitespace, a restrained palette, real typographic hierarchy, responsive
   down to 360px with no horizontal scroll. Semantic HTML, headings that read in order, contrast that passes
   AA, prefers-color-scheme and prefers-reduced-motion respected. A page a school would be proud to print.
9. This is a school. Headings and labels describe patterns as questions for a person, never as verdicts
   about a child. Leave room at the end of <body> for a footer the binder appends.
`.trim();

/** The full system prompt for a design call. Note what is absent: any description of the data. */
export function buildDesignSystemPrompt({ appTitle } = {}) {
  return [
    'You are the page designer inside Librea, a sovereign, local-first student information system that runs on a school district’s own machine.',
    'Someone at the district describes a page, dashboard, or report they want. You design it: one self-contained HTML document with a small JSON manifest declaring where data goes and what shape it has.',
    'You will not be told what data the district has, how it is named, or what any of it looks like. You design regions; the district fills them in later, on its own machine, from a query you never see.',
    appTitle ? `The page is called: ${appTitle}` : '',
    '',
    '=== EXAMPLE OF THE FORMAT (manifest plus one region) ===',
    EXAMPLE,
    '',
    '=== ' + DESIGN_RULES,
    '',
    'Output: the HTML document only.',
  ].filter((x) => x !== '').join('\n');
}

/** Messages for a fresh design, or for a revision of an existing one. */
export function buildDesignMessages(prompt, priorHtml) {
  const ask = String(prompt || '').trim();
  if (!ask) throw new Error('prompt required');
  if (!priorHtml) return [{ role: 'user', content: `Design this page:\n\n${ask}` }];
  return [{
    role: 'user',
    content: [
      'Here is the current design:',
      '```html',
      String(priorHtml).slice(0, 400000),
      '```',
      '',
      'Change it as follows:',
      ask,
      '',
      'Keep slot ids the same wherever the region means the same thing, so existing data bindings survive.',
      'Reply with the FULL rewritten HTML document, not a diff or a fragment.',
    ].join('\n'),
  }];
}

/** Plain-language statement of what a design call sends out. */
export function whatLeavesDesign(offline) {
  if (offline) {
    return { leaves: 'nothing', statement: 'Nothing leaves this machine. The design is assembled from built-in layouts.', sends: [], neverSends: NEVER };
  }
  return {
    leaves: 'your description and a list of region types',
    statement: 'Only your description of the page, its name, and the fixed list of region types (stat, bar, line, table, list, text) are sent to the model provider. Not the names of your tables or fields, not an example row, and nothing about any student.',
    sends: ['your description of the page', 'the page name', 'the fixed region vocabulary', 'the prior design when you revise it'],
    neverSends: NEVER,
  };
}

const NEVER = ['student names', 'student ids', 'grades, metrics, or flags', 'table or field names', 'the shape of any record', 'anything a student, family, or teacher wrote'];
