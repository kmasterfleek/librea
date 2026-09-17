// The Design → Data surface. Step one asks a model (or an offline layout) for
// a design package that knows nothing about the data. Step two binds each
// slot to a query, at home, and previews the real rows before anything is
// saved. Registered from routes.js.
import { HttpError, sendJson } from '../api/router.js';
import { requireUser } from '../api/context.js';
import { narrowScope } from '../core/auth.js';
import { slugify, uniqueSlug, isValidSlug, defaultScopeFor, scopeBadge } from './apps.js';
import { getProvider, providerInfo } from './providers.js';
import { extractHtml } from './prompt.js';
import { buildDesignSystemPrompt, buildDesignMessages, whatLeavesDesign } from './design-prompt.js';
import { parseDesign, auditDesign, DesignError, unboundSlots, publicManifest } from './design.js';
import { renderDesignTemplate } from './design-templates.js';
import { normalizeBinding, runBinding, proposeBinding } from './bind.js';
import { runQuery } from './query.js';
import { schemaFor } from '../sql/query.js';
import { titleFrom } from './routes.js';

export function registerDesign(router, { apps, store, sql }) {
  const deps = { sql };
  /** The caller, inside this app: the same narrowing a reader gets. */
  const inApp = (ctx, app) => ({ ...ctx, app, scope: narrowScope(ctx.scope, app.scope) });

  router.get('/api/vibe/design/provider', () => {
    const info = providerInfo();
    return { provider: info, whatLeaves: whatLeavesDesign(info.offline) };
  });

  // ---- step one: design (Server-Sent Events, same shape as /api/vibe/generate) ----
  router.post('/api/vibe/design', async (ctx) => {
    const user = requireUser(ctx);
    const body = ctx.body || {};
    const prompt = String(body.prompt || '').trim();
    if (!prompt) throw new HttpError(400, 'prompt required');
    if (prompt.length > 8000) throw new HttpError(400, 'prompt too long (8000 chars max)');

    let prior = null;
    let slug;
    if (body.slug != null && body.slug !== '') {
      slug = String(body.slug);
      if (!isValidSlug(slug)) throw new HttpError(400, 'bad slug');
      prior = apps.get(slug);
      if (!prior) throw new HttpError(404, 'no such app');
      if (!apps.canEdit(prior, user)) throw new HttpError(403, 'not your app');
      if (prior.mode !== 'design') throw new HttpError(400, 'that app was written as code; remix it on the Build page');
    } else {
      slug = uniqueSlug(slugify(body.title || prompt), new Set(store.apps.keys()));
    }
    const title = String(body.title || prior?.title || titleFrom(prompt)).trim().slice(0, 120);
    const scope = prior?.scope || defaultScopeFor(user, ctx.scope, { includePii: !!body.includePii });
    const priorHtml = prior ? safeRead(apps, prior) : null;

    const { send, close } = openStream(ctx.res);
    try {
      const provider = getProvider();
      const info = provider.info;
      send('start', { slug, title, provider: info.name, model: info.model, offline: info.offline, remix: !!prior, scope, scopeBadge: scopeBadge(scope) });
      let text = '';
      if (provider.template) {
        text = renderDesignTemplate(prompt, title).html;
        for (let i = 0; i < text.length; i += 900) { send('chunk', { text: text.slice(i, i + 900) }); await new Promise((r) => setImmediate(r)); }
      } else {
        const system = buildDesignSystemPrompt({ appTitle: title });
        for await (const chunk of provider.generate({ system, messages: buildDesignMessages(prompt, priorHtml), title })) { text += chunk; send('chunk', { text: chunk }); }
      }
      const html = extractHtml(text);
      const design = parseDesign(html);
      const warnings = auditDesign(html, design);
      if (warnings.length) throw new DesignError('The design is off-contract: ' + warnings.join(' '));
      // Bindings survive a revision wherever the slot id and kind still match.
      const bindings = {};
      for (const s of design.slots) {
        const old = prior?.bindings?.[s.id];
        const oldSlot = prior?.design?.slots.find((x) => x.id === s.id);
        if (old && oldSlot && oldSlot.kind === s.kind) bindings[s.id] = old;
      }
      const app = apps.save({ slug, title, prompt, html, provider: info.name, model: info.model, scope, user, warnings, templateGenerated: !!provider.template, design, bindings });
      const unbound = unboundSlots(design, bindings);
      if (unbound.length && app.published) apps.update(slug, { published: false }, user);
      send('done', { slug: app.slug, version: app.version, title: app.title, provider: info.name, model: info.model, published: app.published && !unbound.length, url: `/a/${app.slug}`, scopeBadge: scopeBadge(app.scope), warnings, slots: design.slots.map((s) => ({ id: s.id, kind: s.kind, label: s.label })), unbound });
    } catch (err) {
      send('error', { error: err.message || 'design failed' });
    } finally { close(); }
  });

  // ---- the gallery: designs anyone here may reuse, zero external calls ----
  router.get('/api/designs', (ctx) => ({
    designs: apps.listFor(ctx.user).filter((a) => a.mode === 'design').map((a) => ({
      slug: a.slug, title: a.title, prompt: a.prompt, author: a.author, updatedAt: a.updatedAt, published: a.published, provider: a.provider,
      slots: a.design.slots.map((s) => ({ id: s.id, kind: s.kind, label: s.label })),
      bound: a.design.slots.length - unboundSlots(a.design, a.bindings).length,
    })),
  }));

  router.post('/api/vibe/design/reuse', (ctx) => {
    const user = requireUser(ctx);
    const b = ctx.body || {};
    const from = apps.get(String(b.from || ''));
    if (!from || from.mode !== 'design' || !apps.canView(from, user)) throw new HttpError(404, 'no such design');
    const title = String(b.title || from.title).trim().slice(0, 120);
    const slug = uniqueSlug(slugify(title), new Set(store.apps.keys()));
    const html = apps.readHtml(from.slug, from.version);
    const scope = defaultScopeFor(user, ctx.scope, { includePii: !!b.includePii });
    const app = apps.save({ slug, title, prompt: from.prompt, html, provider: 'gallery', model: from.slug, scope, user, design: from.design, bindings: {} });
    return { app: { ...app, url: `/a/${app.slug}`, scopeBadge: scopeBadge(app.scope) }, from: from.slug };
  });

  // ---- step two: bind ----
  router.get('/api/apps/:slug/bindings', (ctx) => {
    const user = requireUser(ctx);
    const app = designApp(apps, ctx.params.slug, user);
    const scope = narrowScope(ctx.scope, app.scope);
    const proposals = {};
    for (const s of app.design.slots) { const p = proposeBinding(s, scope); if (p) proposals[s.id] = p; }
    return {
      slug: app.slug, title: app.title, published: app.published, version: app.version, scope: app.scope, scopeBadge: scopeBadge(app.scope),
      slots: app.design.slots, bindings: app.bindings || {}, proposals, unbound: unboundSlots(app.design, app.bindings), schema: schemaFor(scope), url: `/a/${app.slug}`,
    };
  });

  /** Body { slotId, binding }. Runs it under the app's scope; returns rows, shape problems, or the error. */
  router.post('/api/apps/:slug/bindings/preview', async (ctx) => {
    const user = requireUser(ctx);
    const app = designApp(apps, ctx.params.slug, user);
    const b = ctx.body || {};
    const slot = app.design.slots.find((s) => s.id === b.slotId);
    if (!slot) throw new HttpError(404, 'no such slot');
    let binding;
    try { binding = normalizeBinding(b.binding, slot); } catch (e) { return { slotId: slot.id, error: e.message, problems: [e.message], rows: [] }; }
    const r = await runBinding(binding, slot, inApp(ctx, app), store, deps, runQuery);
    return { slotId: slot.id, binding, ...r };
  });

  /** Body { bindings: { slotId: binding } }. Every binding is run before it is saved. */
  router.put('/api/apps/:slug/bindings', async (ctx) => {
    const user = requireUser(ctx);
    const app = designApp(apps, ctx.params.slug, user);
    const raw = (ctx.body || {}).bindings;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, 'bindings must be an object keyed by slot id');
    const next = {};
    const problems = {};
    for (const [id, val] of Object.entries(raw)) {
      const slot = app.design.slots.find((s) => s.id === id);
      if (!slot) throw new HttpError(400, `no such slot: ${id}`);
      if (val == null) continue;
      const binding = normalizeBinding(val, slot);
      const r = await runBinding(binding, slot, inApp(ctx, app), store, deps, runQuery);
      if (r.error) { problems[id] = [r.error]; continue; }
      if (r.problems.length) { problems[id] = r.problems; continue; }
      next[id] = binding;
    }
    if (Object.keys(problems).length) { sendJson(ctx.res, 400, { error: 'some bindings do not fit their slots', problems }); return undefined; }
    const merged = { ...(app.bindings || {}), ...next };
    for (const [id, val] of Object.entries(raw)) if (val == null) delete merged[id];
    const saved = apps.update(app.slug, { bindings: merged }, user);
    return { slug: saved.slug, bindings: saved.bindings, unbound: unboundSlots(saved.design, saved.bindings) };
  });
}

/** Publishing a design requires every slot to have a data source. */
export function assertPublishable(app) {
  if (app.mode !== 'design') return;
  const unbound = unboundSlots(app.design, app.bindings);
  if (unbound.length) throw new HttpError(400, `bind every section before publishing; still empty: ${unbound.join(', ')}`);
}

/** What a reader may know about a design: the manifest without samples. */
export function designSummary(app) {
  return app.mode === 'design' ? { design: publicManifest(app.design), unbound: unboundSlots(app.design, app.bindings) } : {};
}

function designApp(apps, slug, user) {
  const app = apps.get(slug);
  if (!app || !apps.canEdit(app, user)) throw new HttpError(404, 'no such app');
  if (app.mode !== 'design') throw new HttpError(400, 'that app was written as code and has no slots');
  return app;
}

function safeRead(apps, app) {
  try { return apps.readHtml(app.slug, app.version); } catch { return null; }
}

function openStream(res) {
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  const send = (event, data) => { if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
  const keepalive = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, 15000);
  keepalive.unref?.();
  return { send, close: () => { clearInterval(keepalive); if (!res.writableEnded) res.end(); } };
}
