// Request context helpers: who is calling, what may they see.
import { cookie, HttpError } from './router.js';
import { scopeFor, narrowScope } from '../core/auth.js';

export const SESSION_COOKIE = 'librea_session';

export function attachUser(auth, store) {
  return (ctx) => {
    const bearer = (ctx.req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const token = bearer || cookie(ctx.req, SESSION_COOKIE);
    ctx.user = auth.resolve(token);
    ctx.scope = scopeFor(ctx.user);
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
