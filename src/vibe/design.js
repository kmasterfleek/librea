// Design-first generation. A frontier model (Sonnet by default) designs the
// page: layout, style, and named data slots chosen from the recipe menu. It
// receives the prompt, the edition's look, and the menu. It never receives the
// schema, a table name, or a record. The server then binds each slot to scoped
// SQL here and injects the bindings; the page fills itself at view time.
import { menuFor, recipeSql, RECIPES } from './recipes.js';
import { RUNTIME_BIND_JS } from './runtime-bind.js';
import { runScoped } from '../sql/query.js';
import { extractHtml } from './prompt.js';

export const DEFAULT_DESIGN_MODEL = 'claude-sonnet-5';
export const designModel = () => process.env.LIBREA_DESIGN_MODEL || DEFAULT_DESIGN_MODEL;
export const designAvailable = () => !!process.env.ANTHROPIC_API_KEY;

export function designWhatLeaves() {
  return {
    leaves: 'your prompt, the edition look, and the recipe menu',
    statement: `The design model (${designModel()}) receives your description, the edition's colors and wording, and a menu of data recipes by name ("attendance rate by school"). It does not receive table names, columns, or any record. The data is bound on this machine after the design comes back.`,
    sends: ['your prompt', 'edition name, colors, logo text', 'the recipe menu: ids and one-line descriptions', 'the prior design when you remix it'],
    neverSends: ['the database schema', 'student names or ids', 'grades, metrics, or flags', 'anything a student, family, or teacher wrote'],
  };
}

export function designSystemPrompt({ edition = {}, scope = {}, viewerRole = 'staff', schools = [] } = {}) {
  const menu = menuFor(scope);
  const theme = edition.theme || {};
  return `You are a senior product designer producing a finished, single-file web page for ${edition.name || 'Librea'}, a school's own information system. You design the structure and the look. You do not have, and must not invent, any data: every number, chart, table, or list of records is a DATA SLOT that the school's own server fills in later from its own records.

## Output
Exactly one complete HTML document (<!doctype html> … </html>) and nothing else: no explanation, no code fences.
- Inline CSS only. No external stylesheets, fonts, images, scripts, or fetch. No <script> at all: the server injects the data runtime.
- Responsive, accessible, warm and clear. Use the edition palette: accent ${theme.accent || '#3d6b8e'}, accent2 ${theme.accent2 || '#c97b4a'}${theme.gold ? `, gold ${theme.gold}` : ''}${theme.blue ? `, blue ${theme.blue}` : ''}${theme.magenta ? `, magenta ${theme.magenta}` : ''}. Wordmark text: ${theme.logoText || edition.name || 'Librea'}. Do not reference image files.
- Write real headings, section copy, captions, and callouts in plain language. Static prose is yours; data is not.

## Data slots
Where data belongs, place an empty element:
  <div data-slot="UNIQUE_ID" data-recipe="RECIPE_ID" data-params='{"param":"value"}' data-label="Short caption" data-height="260"></div>
Choose RECIPE_ID only from this menu. Each recipe has a fixed kind that decides how it renders (stat = one big number, bar/line = chart, table = rows, list = text items). Do not put children inside a slot; size and style the slot's container as you like.

${menu.map((m) => `- ${m.id}  [${m.kind}]  ${m.describe}${m.params ? `  params: ${m.params}` : ''}`).join('\n')}

${schools.length ? `Schools in this ${edition.vocabulary?.district || 'district'} (use these exact names for a school param): ${schools.join('; ')}.\n\n` : ''}Rules: at least one slot per section that claims to show data; never write placeholder numbers or fake names into the HTML; a caption may say what the chart shows but not what it says. Viewer role: ${viewerRole}${['student', 'family'].includes(scope.role) ? ' (sees only their own records; use me.* recipes)' : ''}.`;
}

export function designMessages(prompt, priorHtml) {
  const content = priorHtml
    ? `Revise the design below to satisfy this request, keeping what already works. Return the full document.\n\nRequest: ${prompt}\n\nCurrent design:\n${priorHtml}`
    : prompt;
  return [{ role: 'user', content }];
}

/** Stream the design from Anthropic. Yields text chunks. */
export async function* streamDesign({ prompt, priorHtml, edition, scope, viewerRole, schools = [] }) {
  if (!designAvailable()) throw new Error('ANTHROPIC_API_KEY is not set; the design step needs it.');
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();
  const stream = client.messages.stream({
    model: designModel(),
    max_tokens: 32000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium' },
    system: [{ type: 'text', text: designSystemPrompt({ edition, scope, viewerRole, schools }), cache_control: { type: 'ephemeral' } }],
    messages: designMessages(prompt, priorHtml),
  });
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') yield event.delta.text;
  }
  const final = await stream.finalMessage();
  if (final.stop_reason === 'refusal') throw new Error('The design model declined this request. Rephrase it.');
  if (final.stop_reason === 'max_tokens') throw new Error('The design was cut off at the length limit. Ask for something smaller.');
}

const SLOT_RE = /<([a-z][a-z0-9]*)\b([^>]*\bdata-slot\s*=\s*"([^"]+)"[^>]*)>/gi;
const attr = (attrs, name) => { const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i')); return m ? (m[1] ?? m[2]) : null; };

/** Parse data slots out of a design. */
export function parseSlots(html) {
  const out = [];
  let m;
  while ((m = SLOT_RE.exec(html))) {
    const attrs = m[2];
    let params = {};
    try { params = JSON.parse(attr(attrs, 'data-params') || '{}'); } catch { params = {}; }
    out.push({ slot: m[3], recipe: attr(attrs, 'data-recipe'), params, label: attr(attrs, 'data-label') || '', height: attr(attrs, 'data-height') });
  }
  return out;
}

/**
 * Bind slots: resolve every recipe to SQL, prove each query runs under the
 * app's scope (LIMIT 3), and inject the bindings plus the bind runtime. The
 * bindings name a recipe and its params; the SQL is rebuilt server-side on
 * every view, so apps never go stale and no SQL lives in the page.
 * Returns { html, bindings, warnings }.
 */
export function bindSlots(html, { db, scope }) {
  const warnings = [];
  const bindings = [];
  for (const s of parseSlots(html)) {
    if (!s.recipe || !RECIPES[s.recipe]) { warnings.push(`slot ${s.slot}: unknown recipe "${s.recipe}"`); continue; }
    let sql, kind;
    try { ({ sql, kind } = recipeSql(s.recipe, s.params)); } catch (e) { warnings.push(`slot ${s.slot}: ${e.message}`); continue; }
    try { runScoped(db, sql, scope, { limit: 3 }); } catch (e) { warnings.push(`slot ${s.slot}: query failed (${e.message})`); continue; }
    bindings.push({ slot: s.slot, recipe: s.recipe, params: s.params, kind, label: s.label });
  }
  if (!bindings.length) warnings.push('the design declared no usable data slots');
  const inject = `\n<script id="librea-bindings" type="application/json">${JSON.stringify(bindings).replace(/</g, '\\u003c')}</script>\n<script>${RUNTIME_BIND_JS}</script>\n`;
  const cleaned = extractHtml(html).replace(/<script\b[\s\S]*?<\/script>/gi, '');
  const out = /<\/body>/i.test(cleaned) ? cleaned.replace(/<\/body>/i, inject + '</body>') : cleaned + inject;
  return { html: out, bindings, warnings };
}
