// Core REST surface: auth, people, fragments, search, stats, ledger.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { HttpError, sendJson, serveFile } from './router.js';
import { SESSION_COOKIE, requireUser, requireRole, canSeeEntity, projectEntity } from './context.js';
import { DIMENSIONS, FRAGMENT_KINDS, VISIBILITY, STUDENT_METRICS, ENTITY_TYPES } from '../core/schema.js';

const IMG = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };

export function registerCore(router, { store, auth, dataDir }) {
  const mediaDir = path.join(dataDir, 'media');

  // ---- auth ----
  router.get('/api/auth/status', () => ({ bootstrapped: auth.bootstrapped }));
  router.post('/api/auth/bootstrap', (ctx) => {
    if (auth.bootstrapped) throw new HttpError(409, 'already bootstrapped');
    const u = auth.createUser({ ...ctx.body, role: 'admin' });
    return { user: u };
  });
  router.post('/api/auth/login', (ctx) => {
    const r = auth.login(ctx.body?.username, ctx.body?.password);
    if (!r) throw new HttpError(401, 'bad username or password');
    ctx.res.setHeader('set-cookie', `${SESSION_COOKIE}=${r.token}; Path=/; HttpOnly; SameSite=Strict`);
    return { user: r.user, token: r.token };
  });
  router.post('/api/auth/logout', (ctx) => {
    const t = (ctx.req.headers.cookie || '').match(new RegExp(SESSION_COOKIE + '=([^;]*)'))?.[1];
    if (t) auth.logout(t);
    ctx.res.setHeader('set-cookie', `${SESSION_COOKIE}=; Path=/; Max-Age=0`);
    return { ok: true };
  });
  router.get('/api/auth/me', (ctx) => ({ user: ctx.user, scope: ctx.scope }));

  router.get('/api/users', (ctx) => { requireRole(ctx, 'admin'); return { users: auth.listUsers() }; });
  router.post('/api/users', (ctx) => { requireRole(ctx, 'admin'); return { user: auth.createUser(ctx.body || {}) }; });
  router.put('/api/users/:username', (ctx) => {
    requireRole(ctx, 'admin');
    const patch = ctx.body || {};
    if (ctx.params.username === ctx.user.username && (patch.active === false || (patch.role && patch.role !== 'admin'))) throw new HttpError(400, 'you cannot lock yourself out');
    return { user: auth.updateUser(ctx.params.username, patch) };
  });

  // ---- schema & stats ----
  router.get('/api/schema', () => ({ dimensions: DIMENSIONS, fragmentKinds: FRAGMENT_KINDS, visibility: VISIBILITY, studentMetrics: STUDENT_METRICS, entityTypes: ENTITY_TYPES }));
  router.get('/api/stats', (ctx) => { requireUser(ctx); return store.stats(); });
  router.get('/api/ledger/verify', (ctx) => { requireRole(ctx, 'admin'); return store.ledger.verify(); });

  // ---- people ----
  router.get('/api/people', (ctx) => {
    requireUser(ctx);
    const limit = Math.min(500, Number(ctx.query.limit) || 100);
    let list = store.listEntities(ctx.query);
    if (ctx.scope.entityIds) list = list.filter((e) => ctx.scope.entityIds.includes(e.id));
    const total = list.length;
    list = list.slice(Number(ctx.query.offset) || 0, (Number(ctx.query.offset) || 0) + limit).map((e) => projectEntity(ctx.scope, e));
    return { total, people: list };
  });

  router.get('/api/people/:id', async (ctx) => {
    requireUser(ctx);
    const e = store.getEntity(ctx.params.id);
    if (!e || !canSeeEntity(ctx.scope, e.id)) throw new HttpError(404, 'no such person');
    const fragments = store.getFragments(e.id, { visibility: ctx.scope.visibility });
    return { person: projectEntity(ctx.scope, e), fragments };
  });

  router.put('/api/people/:id', (ctx) => {
    requireRole(ctx, 'admin', 'staff');
    const body = ctx.body || {};
    return { person: store.upsertEntity({ ...body, id: ctx.params.id, type: body.type || store.getEntity(ctx.params.id)?.type || 'student' }, ctx.user.username) };
  });

  router.delete('/api/people/:id', (ctx) => { requireRole(ctx, 'admin'); return { deleted: store.deleteEntity(ctx.params.id, ctx.user.username) }; });

  router.get('/api/people/:id/similar', async (ctx) => {
    requireUser(ctx);
    if (!canSeeEntity(ctx.scope, ctx.params.id)) throw new HttpError(404, 'no such person');
    const rows = await store.similar(ctx.params.id, { k: Math.min(50, Number(ctx.query.k) || 10), space: ctx.query.space || 'signal' });
    return { similar: rows.filter((r) => canSeeEntity(ctx.scope, r.entity.id) || ctx.scope.aggregates).map((r) => ({ score: r.score, person: projectEntity(ctx.scope, r.entity) })) };
  });

  router.get('/api/people/:id/timeline', (ctx) => {
    requireUser(ctx);
    const e = store.getEntity(ctx.params.id);
    if (!e || !canSeeEntity(ctx.scope, e.id)) throw new HttpError(404, 'no such person');
    return { timeline: e.timeline || [], arc: e.arc || 'flat', movers: e.movers || [] };
  });

  router.post('/api/people/:id/timeline', (ctx) => {
    requireRole(ctx, 'admin', 'staff');
    const b = ctx.body || {};
    return { timeline: store.addSnapshot(ctx.params.id, b.at, b.dims || {}, ctx.user.username) };
  });

  // ---- fragments ----
  const authorFor = (ctx) => ({ id: ctx.user.username, role: ctx.user.role, name: ctx.user.displayName || ctx.user.username });

  router.post('/api/people/:id/fragments', async (ctx) => {
    requireUser(ctx);
    if (!canSeeEntity(ctx.scope, ctx.params.id)) throw new HttpError(404, 'no such person');
    const b = ctx.body || {};
    const kind = b.kind || { student: 'self', family: 'family', staff: 'observation', admin: 'note' }[ctx.user.role];
    if (ctx.user.role === 'student' && !['self', 'artifact', 'photo'].includes(kind)) throw new HttpError(403, 'students add self, artifact, or photo fragments');
    if (ctx.user.role === 'family' && !['family', 'photo'].includes(kind)) throw new HttpError(403, 'families add family or photo fragments');
    const visibility = b.visibility || 'school';
    if (['student', 'family'].includes(ctx.user.role) && visibility === 'staff') throw new HttpError(403, 'only staff can write staff-only notes');
    const f = await store.addFragment({ entityId: ctx.params.id, kind, text: b.text, visibility, author: authorFor(ctx), source: b.source || 'ui' }, ctx.user.username);
    return { fragment: f };
  });

  /** JSON body: { caption, mime, data (base64) }. Saved locally; a photo fragment is added. */
  router.post('/api/people/:id/photo', async (ctx) => {
    requireUser(ctx);
    if (!canSeeEntity(ctx.scope, ctx.params.id)) throw new HttpError(404, 'no such person');
    const b = ctx.body || {};
    const ext = IMG[b.mime];
    if (!ext) throw new HttpError(400, 'mime must be image/png, image/jpeg or image/webp');
    const buf = Buffer.from(String(b.data || ''), 'base64');
    if (!buf.length || buf.length > 15 * 1024 * 1024) throw new HttpError(400, 'image empty or over 15MB');
    const dir = path.join(mediaDir, ctx.params.id);
    fs.mkdirSync(dir, { recursive: true });
    const file = randomUUID() + ext;
    fs.writeFileSync(path.join(dir, file), buf);
    const caption = String(b.caption || '').trim() || 'Photo';
    const visibility = b.visibility || 'school';
    if (['student', 'family'].includes(ctx.user.role) && visibility === 'staff') throw new HttpError(403, 'only staff can write staff-only notes');
    const f = await store.addFragment({ entityId: ctx.params.id, kind: 'photo', text: caption, visibility, author: authorFor(ctx), media: { path: `/media/${ctx.params.id}/${file}`, mime: b.mime, bytes: buf.length } }, ctx.user.username);
    return { fragment: f };
  });

  router.get('/media/:entityId/:file', (ctx) => {
    requireUser(ctx);
    if (!canSeeEntity(ctx.scope, ctx.params.entityId)) throw new HttpError(404, 'not found');
    const f = [...store.fragments.values()].find((x) => x.media?.path === `/media/${ctx.params.entityId}/${ctx.params.file}`);
    if (!f || !store.getFragments(ctx.params.entityId, { visibility: ctx.scope.visibility }).some((x) => x.id === f.id)) throw new HttpError(404, 'not found');
    if (!serveFile(ctx.res, path.join(mediaDir, ctx.params.entityId), ctx.params.file)) throw new HttpError(404, 'not found');
  });

  router.delete('/api/fragments/:id', async (ctx) => {
    requireUser(ctx);
    const f = store.fragments.get(ctx.params.id);
    if (!f) throw new HttpError(404, 'no such fragment');
    const own = f.author?.id === ctx.user.username;
    if (!own && !['admin', 'staff'].includes(ctx.user.role)) throw new HttpError(403, 'not yours');
    if (!own && ctx.user.role === 'staff' && ['self', 'family'].includes(f.kind)) throw new HttpError(403, 'staff cannot remove a student or family voice');
    return { removed: await store.removeFragment(ctx.params.id, ctx.user.username) };
  });

  // ---- search ----
  router.get('/api/search', async (ctx) => {
    requireUser(ctx);
    const q = String(ctx.query.q || '').trim();
    if (!q) throw new HttpError(400, 'q required');
    // Structured filters (grade, outcome, flag) narrow the candidate set; scope narrows it further.
    let entityIds = ctx.scope.entityIds || undefined;
    if (ctx.query.grade != null || ctx.query.outcome || ctx.query.flag) {
      const allowed = new Set(store.listEntities({ type: ctx.query.type || 'student', grade: ctx.query.grade, outcome: ctx.query.outcome, flag: ctx.query.flag }).map((e) => e.id));
      entityIds = entityIds ? entityIds.filter((id) => allowed.has(id)) : [...allowed];
    }
    const rows = await store.semanticSearch(q, { k: Math.min(50, Number(ctx.query.k) || 10), visibility: ctx.scope.visibility, entityType: ctx.query.type, schoolId: ctx.query.schoolId, entityIds });
    return { results: rows.map((g) => ({ score: g.score, person: projectEntity(ctx.scope, g.entity), fragments: g.fragments })) };
  });

  router.get('/api/health', () => ({ ok: true, ts: new Date().toISOString() }));
  void sendJson;
}
