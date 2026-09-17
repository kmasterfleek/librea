// Vibe app storage. The manifest lives in the hash-chained ledger (via
// store.upsertApp) so every app and every scope change is auditable; the HTML
// of each version is a plain file on disk you can read, diff, or delete.
import fs from 'node:fs';
import path from 'node:path';
import { HttpError } from '../api/router.js';
import { VISIBILITY } from '../core/schema.js';

const STOP = new Set(['a', 'an', 'the', 'my', 'our', 'their', 'for', 'of', 'with', 'and', 'to', 'in', 'on', 'that', 'this', 'me', 'i', 'want', 'make', 'build', 'create', 'show', 'page', 'app', 'where', 'who', 'can', 'is', 'are', 'be', 'it', 'at', 'by', 'from', 'all', 'each', 'so', 'please']);
const RESERVED = new Set(['api', 'a', 'new', 'apps', 'admin', 'public', 'media', 'app']);

/** A path-safe, human-readable slug: lowercase [a-z0-9-], 3-40 chars. */
export function slugify(text, fallback = 'app') {
  const words = String(text || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/[\s-]+/).filter(Boolean);
  const kept = words.filter((w) => !STOP.has(w)).slice(0, 5);
  let s = (kept.length ? kept : words.slice(0, 4)).join('-').slice(0, 40).replace(/^-+|-+$/g, '');
  if (s.length < 3) s = (s ? s + '-' : '') + fallback;
  s = s.slice(0, 40).replace(/^-+|-+$/g, '');
  return /^[a-z0-9][a-z0-9-]{2,39}$/.test(s) ? s : fallback;
}

export function isValidSlug(s) { return typeof s === 'string' && /^[a-z0-9][a-z0-9-]{2,39}$/.test(s); }

/** First free slug of the form base, base-2, base-3 ... */
export function uniqueSlug(base, taken) {
  const has = taken instanceof Set ? (s) => taken.has(s) : (s) => taken.has(s);
  let s = RESERVED.has(base) ? `${base}-app` : base;
  if (!has(s)) return s;
  for (let i = 2; i < 500; i++) {
    const c = `${s.slice(0, 37)}-${i}`;
    if (!has(c)) return c;
  }
  return `${s.slice(0, 32)}-${Date.now().toString(36).slice(-6)}`;
}

/** Normalize an app scope. Apps can only ever narrow, so absent keys stay absent. */
export function normalizeScope(input = {}) {
  const out = {};
  if (Array.isArray(input.visibility)) {
    const v = input.visibility.filter((x) => VISIBILITY.includes(x));
    if (v.length) out.visibility = v;
  }
  if (Array.isArray(input.entityIds)) out.entityIds = input.entityIds.filter((x) => typeof x === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(x)).slice(0, 5000);
  if (input.pii === false) out.pii = false;
  if (input.aggregatesOnly) out.aggregatesOnly = true;
  return out;
}

/**
 * The default scope for an app this user just described. Staff and admins may
 * opt into names; students and families never see another child as an
 * individual, only as an aggregate (their own record still comes through).
 */
export function defaultScopeFor(user, scope, { includePii = false } = {}) {
  const staff = ['admin', 'staff'].includes(user.role);
  const out = { visibility: [...scope.visibility] };
  if (!staff || !includePii) out.pii = false;
  if (!staff) {
    out.aggregatesOnly = true;
    const own = [...(user.entityIds || []), ...(user.entityId ? [user.entityId] : [])];
    if (own.length) out.entityIds = own;
  }
  return normalizeScope(out);
}

/** A short plain-language description of what an app can see. */
export function scopeBadge(scope = {}) {
  const bits = [];
  if (scope.aggregatesOnly) bits.push('aggregates only');
  if (scope.entityIds?.length) bits.push(scope.entityIds.length === 1 ? 'your record' : `${scope.entityIds.length} records`);
  bits.push(scope.pii === false ? 'no names' : 'names');
  const vis = scope.visibility || [];
  if (vis.length) bits.push(`${vis.join('/')} fragments`);
  return 'sees: ' + bits.join(', ');
}

export class AppStore {
  constructor(store, dataDir) {
    this.store = store;
    this.dir = path.join(dataDir, 'apps');
  }

  list() { return [...this.store.apps.values()]; }
  get(slug) { return this.store.apps.get(slug) || null; }

  /** Apps this viewer may see in a listing: published ones plus their own drafts. */
  listFor(user) {
    return this.list().filter((a) => a.published || (user && (a.author?.username === user.username || user.role === 'admin')))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  canEdit(app, user) {
    return !!user && (user.role === 'admin' || app.author?.username === user.username);
  }

  canView(app, user) {
    return !!app && (app.published || this.canEdit(app, user));
  }

  htmlPath(slug, version) { return path.join(this.dir, slug, `v${version}.html`); }

  readHtml(slug, version) {
    const f = this.htmlPath(slug, version);
    if (!fs.existsSync(f)) throw new HttpError(404, 'no such app version');
    return fs.readFileSync(f, 'utf8');
  }

  versions(slug) {
    const d = path.join(this.dir, slug);
    if (!fs.existsSync(d)) return [];
    return fs.readdirSync(d).map((f) => Number(/^v(\d+)\.html$/.exec(f)?.[1])).filter(Number.isFinite).sort((a, b) => a - b);
  }

  /**
   * Save a generated document. Creates the app on first save, appends a version
   * on every later one. Returns the updated manifest.
   */
  save({ slug, title, prompt, html, provider, model, scope, user, warnings = [], templateGenerated = false, design = null, bindings = null }) {
    if (!isValidSlug(slug)) throw new HttpError(400, 'bad slug');
    if (typeof html !== 'string' || html.length < 30) throw new HttpError(400, 'generated document is empty');
    const prev = this.get(slug);
    const now = new Date().toISOString();
    const version = (prev?.version || 0) + 1;
    fs.mkdirSync(path.join(this.dir, slug), { recursive: true });
    fs.writeFileSync(this.htmlPath(slug, version), html);
    const app = {
      slug,
      title: String(title || prev?.title || slug).slice(0, 120),
      prompt: String(prompt || '').slice(0, 4000),
      provider, model,
      scope: scope || prev?.scope || {},
      author: prev?.author || { username: user.username, role: user.role, displayName: user.displayName || user.username },
      createdAt: prev?.createdAt || now,
      updatedAt: now,
      version,
      published: prev?.published ?? false,
      templateGenerated: !!templateGenerated,
      warnings,
      ...(design ? { mode: 'design', design, bindings: bindings || {} } : {}),
      history: [...(prev?.history || []), { version, prompt: String(prompt || '').slice(0, 4000), createdAt: now, by: user.username }].slice(-50),
    };
    this.store.upsertApp(app, user.username);
    return app;
  }

  update(slug, patch, user) {
    const app = this.get(slug);
    if (!app) throw new HttpError(404, 'no such app');
    if (!this.canEdit(app, user)) throw new HttpError(403, 'not your app');
    const next = { ...app, updatedAt: new Date().toISOString() };
    if (patch.title != null) next.title = String(patch.title).trim().slice(0, 120) || app.title;
    if (patch.published != null) next.published = !!patch.published;
    if (patch.scope != null) next.scope = normalizeScope(patch.scope);
    if (patch.bindings != null) next.bindings = patch.bindings;
    this.store.upsertApp(next, user.username);
    return next;
  }

  remove(slug, user) {
    const app = this.get(slug);
    if (!app) throw new HttpError(404, 'no such app');
    if (!this.canEdit(app, user)) throw new HttpError(403, 'not your app');
    this.store.deleteApp(slug, user.username);
    fs.rmSync(path.join(this.dir, slug), { recursive: true, force: true });
    return true;
  }
}
