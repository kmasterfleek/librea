// The vibe-coding HTTP surface: describe an app, watch it stream in, open it at
// its own address. Auto-loaded by src/server.js.
import { HttpError, sendHtml } from '../api/router.js';
import { requireUser } from '../api/context.js';
import { AppStore, slugify, uniqueSlug, isValidSlug, defaultScopeFor, scopeBadge, normalizeScope } from './apps.js';
import { getProvider, providerInfo, providerName, whatLeaves } from './providers.js';
import { buildSystemPrompt, buildMessages, extractHtml } from './prompt.js';
import { runQuery } from './query.js';
import { RUNTIME_JS } from './runtime.js';
import { BINDER_JS } from './runtime-bind.js';
import { registerDesign, assertPublishable, designSummary } from './routes-design.js';
import { shellPage, signInPage } from './shell.js';

const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-ancestors 'self'";

export function register(router, { store, dataDir, sql }) {
  const apps = new AppStore(store, dataDir);
  registerDesign(router, { apps, store, sql });

  // ---- what the provider is, and what leaves the building ----
  router.get('/api/vibe/provider', () => ({ provider: providerInfo(), whatLeaves: whatLeaves() }));
  router.get('/api/vibe/runtime.js', (ctx) => {
    ctx.res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
    ctx.res.end(RUNTIME_JS);
  });

  // ---- generate (Server-Sent Events) ----
  router.post('/api/vibe/generate', async (ctx) => {
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
      if (prior.mode === 'design') throw new HttpError(400, 'that app is a design; revise it on the Design page');
    } else {
      slug = uniqueSlug(slugify(body.title || prompt), new Set(store.apps.keys()));
    }
    const title = String(body.title || prior?.title || titleFrom(prompt)).trim().slice(0, 120);
    const scope = prior?.scope || defaultScopeFor(user, ctx.scope, { includePii: !!body.includePii });
    const priorHtml = prior ? safeRead(apps, prior) : null;

    const res = ctx.res;
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    const send = (event, data) => { if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
    const keepalive = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, 15000);
    keepalive.unref?.();

    try {
      const provider = getProvider();
      const info = provider.info;
      send('start', { slug, title, provider: info.name, model: info.model, offline: info.offline, remix: !!prior, scope, scopeBadge: scopeBadge(scope) });
      const system = buildSystemPrompt({ scope: { ...ctx.scope, ...scope }, viewer: user, appTitle: title });
      const messages = buildMessages(prompt, priorHtml);
      let text = '';
      for await (const chunk of provider.generate({ system, messages, title })) {
        text += chunk;
        send('chunk', { text: chunk });
      }
      const html = extractHtml(text);
      const warnings = auditHtml(html);
      const app = apps.save({ slug, title, prompt, html, provider: info.name, model: info.model, scope, user, warnings, templateGenerated: !!provider.template });
      send('done', { slug: app.slug, version: app.version, title: app.title, provider: info.name, model: info.model, published: app.published, url: `/a/${app.slug}`, scopeBadge: scopeBadge(app.scope), warnings });
    } catch (err) {
      send('error', { error: err.message || 'generation failed' });
    } finally {
      clearInterval(keepalive);
      if (!res.writableEnded) res.end();
    }
  });

  // ---- app manifests ----
  router.get('/api/apps', (ctx) => ({
    provider: providerName(),
    apps: apps.listFor(ctx.user).map((a) => summary(a, apps, ctx.user)),
  }));

  router.get('/api/apps/:slug', (ctx) => {
    const app = apps.get(ctx.params.slug);
    if (!app || !apps.canView(app, ctx.user)) throw new HttpError(404, 'no such app');
    return { app: summary(app, apps, ctx.user), versions: apps.versions(app.slug), history: app.history || [] };
  });

  router.post('/api/apps/:slug/publish', (ctx) => {
    const user = requireUser(ctx);
    const wanted = !!(ctx.body || {}).published;
    if (wanted) { const cur = apps.get(ctx.params.slug); if (cur) assertPublishable(cur); }
    const app = apps.update(ctx.params.slug, { published: wanted }, user);
    return { app: summary(app, apps, user) };
  });

  router.put('/api/apps/:slug', (ctx) => {
    const user = requireUser(ctx);
    const b = ctx.body || {};
    const patch = {};
    if (b.title != null) patch.title = b.title;
    if (b.scope != null) patch.scope = normalizeScope(b.scope);
    const app = apps.update(ctx.params.slug, patch, user);
    return { app: summary(app, apps, user) };
  });

  router.delete('/api/apps/:slug', (ctx) => {
    const user = requireUser(ctx);
    return { deleted: apps.remove(ctx.params.slug, user) };
  });

  // ---- the broker every running app talks to ----
  router.post('/api/query', async (ctx) => {
    requireUser(ctx);
    const b = ctx.body || {};
    if (Buffer.isBuffer(b)) throw new HttpError(400, 'send JSON: { op, args }');
    try {
      return await runQuery({ op: b.op, args: b.args }, ctx, store, { sql });
    } catch (err) {
      logBrokerError(store, ctx, b, err);
      throw err;
    }
  });

  // ---- the shell page ----
  router.get('/a/:slug', (ctx) => {
    const app = apps.get(ctx.params.slug);
    if (!app) throw new HttpError(404, 'no such app');
    if (!ctx.user) return sendHtml(ctx.res, signInPage(app), { 'cache-control': 'no-store' });
    if (!apps.canView(app, ctx.user)) throw new HttpError(404, 'no such app');
    const version = pickVersion(apps, app, ctx.query.v);
    sendHtml(ctx.res, shellPage(app, { version, user: ctx.user }), { 'cache-control': 'no-store', 'x-frame-options': 'SAMEORIGIN' });
  });

  // ---- the app document itself (opaque origin: no cookie is sent with it) ----
  router.get('/a/:slug/app.html', (ctx) => {
    const app = apps.get(ctx.params.slug);
    if (!app) throw new HttpError(404, 'no such app');
    if (!app.published && !apps.canEdit(app, ctx.user)) throw new HttpError(404, 'no such app');
    const version = pickVersion(apps, app, ctx.query.v);
    const html = injectRuntime(apps.readHtml(app.slug, version), { binder: app.mode === 'design' });
    sendHtml(ctx.res, html, {
      'content-security-policy': CSP,
      'x-frame-options': 'SAMEORIGIN',
      'referrer-policy': 'no-referrer',
      'cache-control': 'no-store',
    });
  });
}

// ---------------------------------------------------------------- helpers

function summary(app, apps, user) {
  const { design, bindings, ...rest } = app;
  return { ...rest, ...designSummary(app), url: `/a/${app.slug}`, scopeBadge: scopeBadge(app.scope), editable: apps.canEdit(app, user), versions: apps.versions(app.slug) };
}

function pickVersion(apps, app, raw) {
  if (raw == null || raw === '') return app.version;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'v must be a version number');
  if (!apps.versions(app.slug).includes(n)) throw new HttpError(404, 'no such app version');
  return n;
}

function safeRead(apps, app) {
  try { return apps.readHtml(app.slug, app.version); } catch { return null; }
}

/**
 * Every op an app got wrong lands in the ledger: which app, which op, which
 * argument NAMES, and the message. Never a value, so no student data is logged.
 * Over time these are the training signal for the prompt and the templates.
 */
/**
 * An error message can echo a literal the model wrote into a WHERE clause, and
 * a teacher can put a child's name in a prompt. Anything in quotes is replaced
 * before it reaches the ledger.
 */
export function scrub(message) {
  // One pass: the closing quote is optional, so an unterminated literal goes too.
  return String(message || 'error').replace(/'[^']*'?|"[^"]*"?/g, "'\u2026'").slice(0, 200);
}

export function logBrokerError(store, ctx, body, err) {
  try {
    const args = body && typeof body.args === 'object' && body.args && !Array.isArray(body.args) ? Object.keys(body.args).slice(0, 20) : [];
    store.ledger.append('app.error', {
      slug: ctx.app?.slug || null,
      op: typeof body?.op === 'string' ? body.op.slice(0, 40) : null,
      role: ctx.scope?.role || null,
      status: err?.status || 500,
      message: scrub(err?.message),
      args,
    }, ctx.user?.username || 'anon');
  } catch { /* logging must never break a request */ }
}

/** The runtime goes in first, before anything the model wrote can run. A design gets the binder too. */
export function injectRuntime(html, { binder = false } = {}) {
  const tag = `<script>${RUNTIME_JS}</script>` + (binder ? `\n<script>${BINDER_JS}</script>` : '');
  const head = /<head[^>]*>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + '\n' + tag + html.slice(head.index + head[0].length);
  const htmlTag = /<html[^>]*>/i.exec(html);
  if (htmlTag) return html.slice(0, htmlTag.index + htmlTag[0].length) + `\n<head>${tag}</head>` + html.slice(htmlTag.index + htmlTag[0].length);
  return tag + html;
}

/** Report, but do not rewrite. The document is served exactly as generated. */
export function auditHtml(html) {
  const w = [];
  if (/<script[^>]+src=/i.test(html)) w.push('The app tries to load an external script. The sandbox blocks it; the app may not work.');
  if (/\bfetch\s*\(|XMLHttpRequest|new WebSocket|EventSource\s*\(/.test(html)) w.push('The app calls the network directly. The sandbox blocks that; only window.librea works.');
  if (/<link[^>]+href=["']https?:/i.test(html)) w.push('The app links an external stylesheet or font. The sandbox blocks it.');
  if (/<img[^>]+src=["']https?:/i.test(html)) w.push('The app loads a remote image. The sandbox blocks it.');
  if (!/librea\.ready\s*\(/.test(html)) w.push('The app never calls librea.ready(), so it may never receive data.');
  if (!/librea\.footer\s*\(/.test(html)) w.push('The app does not show the "Data stays here" footer.');
  return w;
}

/** A readable default title: first sentence, no lead-in verb or article, cut at a word. */
export function titleFrom(prompt, max = 60) {
  const first = String(prompt).replace(/\s+/g, ' ').trim().split(/[.!?\n]/)[0];
  let t = first
    .replace(/^(?:please\s+)?(?:build|make|create|write|design|generate|i(?:'d like| want| need)?|give|show|can you (?:build|make|create))\b\s*(?:me\s+)?/i, '')
    .replace(/^(?:a|an|the)\b\s*/i, '')
    .trim();
  if (t.length > max) {
    const cut = t.slice(0, max + 1);
    const space = cut.lastIndexOf(' ');
    t = (space > 12 ? cut.slice(0, space) : cut.slice(0, max)).trim();
  }
  t = t.replace(/[\s,;:.!?\-]+$/, '').trim();
  return t ? t.replace(/^./, (c) => c.toUpperCase()) : 'Librea app';
}
