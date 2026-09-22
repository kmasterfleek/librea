// Request context helpers: who is calling, what may they see.
import { cookie, HttpError } from './router.js';
import { scopeFor, narrowScope } from '../core/auth.js';

export const SESSION_COOKIE = 'librea_session';

/**
 * Students on a staff member's caseload: everyone enrolled as a student in a
 * class where this staff member is enrolled as teacher or aide, plus students
 * whose learning plan names them as owner. Computed from the SQL projection.
 */
export function caseloadFor(db, staffId) {
  if (!db || !staffId) return [];
  const rows = db.prepare(`
    SELECT DISTINCT s.userSourcedId AS id FROM enrollments t
      JOIN enrollments s ON s.classSourcedId = t.classSourcedId AND s.role = 'student' AND (s.endDate IS NULL OR s.endDate >= date('now'))
     WHERE t.userSourcedId = ? AND t.role IN ('teacher', 'aide')
    UNION SELECT studentSourcedId AS id FROM learning_plans WHERE owner = ? AND status = 'active'
    UNION SELECT sourcedId AS id FROM students WHERE advisorSourcedId = ?`).all(staffId, staffId, staffId);
  return rows.map((r) => r.id);
}

export function attachUser(auth, store, sql = null) {
  return (ctx) => {
    const bearer = (ctx.req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const token = bearer || cookie(ctx.req, SESSION_COOKIE);
    ctx.user = auth.resolve(token);
    ctx.scope = scopeFor(ctx.user);
    // A family account linked to a family entity (not just to students) sees that family's children.
    if (ctx.scope.entityIds && ctx.scope.entityIds.length) {
      const expanded = new Set(ctx.scope.entityIds);
      for (const id of ctx.scope.entityIds) { const e = store.getEntity(id); if (e?.type === 'family') for (const sid of e.students || []) expanded.add(sid); }
      ctx.scope = { ...ctx.scope, entityIds: [...expanded] };
    }
    if (ctx.scope.caseload) ctx.scope = { ...ctx.scope, entityIds: caseloadFor(sql?.db, ctx.user.entityId), caseload: true };
    // A published app narrows the viewer's scope to what the app declared.
    const appSlug = ctx.req.headers['x-librea-app'];
    if (appSlug) {
      const app = store.apps.get(String(appSlug));
      if (!app) throw new HttpError(404, 'unknown app');
      ctx.app = app;
      ctx.scope = narrowScope(ctx.scope, app.scope);
    }
    return ctx;
  };
}

export function requireUser(ctx) {
  if (!ctx.user) throw new HttpError(401, 'sign in first');
  return ctx.user;
}

export function requireRole(ctx, ...roles) {
  requireUser(ctx);
  if (!roles.includes(ctx.user.role)) throw new HttpError(403, `requires role: ${roles.join(' or ')}`);
  return ctx.user;
}

/** May this scope read this entity at all? */
export function canSeeEntity(scope, entityId) {
  return scope.entityIds === null || scope.entityIds.includes(entityId);
}

/** Project an entity for a scope: drop PII when the scope forbids it. */
export function projectEntity(scope, e) {
  if (!e) return null;
  if (scope.pii || (scope.entityIds && scope.entityIds.includes(e.id))) return e;
  const { firstName, lastName, preferredName, dob, email, phone, address, externalIds, guardians, ...rest } = e;
  return rest;
}
