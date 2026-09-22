// From-scratch onboarding: create people and families by hand, invite them in,
// and expose the active edition. This is how a microschool or an alternative
// school starts with no vendor export to import.
import { randomBytes } from 'node:crypto';
import { HttpError } from './router.js';
import { requireUser, requireRole, canSeeEntity, projectEntity } from './context.js';
import { loadEdition, listEditions } from '../core/edition.js';
import { ENTITY_TYPES } from '../core/schema.js';

const newId = (prefix) => `${prefix}-${randomBytes(3).toString('hex').toUpperCase()}`;
const PREFIX = { student: 'STU', staff: 'STF', family: 'FAM', school: 'SCH', course: 'CRS', section: 'SEC' };

export function registerOnboard(router, { store, auth }) {
  router.get('/api/edition', () => loadEdition());
  router.get('/api/editions', () => ({ editions: listEditions(), active: loadEdition().id }));

  /** Create an entity from scratch. Body: { type, ...fields }. Id is generated unless given. */
  router.post('/api/people', (ctx) => {
    requireRole(ctx, 'admin', 'staff');
    const b = ctx.body || {};
    if (!ENTITY_TYPES.includes(b.type)) throw new HttpError(400, `type must be one of ${ENTITY_TYPES.join(', ')}`);
    if (ctx.user.role === 'staff' && !['student', 'family'].includes(b.type)) throw new HttpError(403, 'staff can add students and families');
    let id = b.id;
    if (!id) { do { id = newId(PREFIX[b.type] || 'ENT'); } while (store.getEntity(id)); }
    else if (store.getEntity(id)) throw new HttpError(409, `id already exists: ${id}`);
    const person = store.upsertEntity({ ...b, id }, ctx.user.username);
    // A family created with students links both ways.
    if (b.type === 'family') for (const sid of person.students || []) {
      const s = store.getEntity(sid);
      if (s) store.upsertEntity({ id: sid, type: s.type, guardians: [...new Set([...(s.guardians || []).map((g) => g.familyId || g), id].map((g) => (typeof g === 'string' ? { familyId: g } : g)))] }, ctx.user.username);
    }
    return { person };
  });

  /** Link a student to a family (both directions). */
  router.post('/api/families/:id/students', (ctx) => {
    requireRole(ctx, 'admin', 'staff');
    const fam = store.getEntity(ctx.params.id);
    if (!fam || fam.type !== 'family') throw new HttpError(404, 'no such family');
    const sid = String((ctx.body || {}).studentId || '');
    const s = store.getEntity(sid);
    if (!s || s.type !== 'student') throw new HttpError(404, 'no such student');
    const updated = store.upsertEntity({ id: fam.id, type: 'family', students: [...new Set([...(fam.students || []), sid])] }, ctx.user.username);
    store.upsertEntity({ id: sid, type: 'student', guardians: [...new Set([...(s.guardians || []).map((g) => g.familyId), fam.id])].map((familyId) => ({ familyId })) }, ctx.user.username);
    return { family: updated };
  });

  router.get('/api/families/:id', (ctx) => {
    requireUser(ctx);
    const fam = store.getEntity(ctx.params.id);
    if (!fam || fam.type !== 'family') throw new HttpError(404, 'no such family');
    const visible = (fam.students || []).filter((sid) => canSeeEntity(ctx.scope, sid));
    if (!ctx.scope.pii && !visible.length) throw new HttpError(404, 'no such family');
    return { family: ctx.scope.pii ? fam : { id: fam.id, type: 'family', students: visible }, students: visible.map((sid) => projectEntity(ctx.scope, store.getEntity(sid))).filter(Boolean) };
  });

  // ---- invites ----
  router.get('/api/invites', (ctx) => { requireRole(ctx, 'admin', 'staff'); return { invites: auth.listInvites() }; });
  router.post('/api/invites', (ctx) => {
    requireRole(ctx, 'admin', 'staff');
    const b = ctx.body || {};
    if (ctx.user.role === 'staff' && !['student', 'family'].includes(b.role)) throw new HttpError(403, 'staff can invite students and families');
    for (const id of [...(b.entityIds || []), ...(b.entityId ? [b.entityId] : [])]) if (!store.getEntity(id)) throw new HttpError(404, `no such entity: ${id}`);
    return { invite: auth.createInvite({ ...b, createdBy: ctx.user.username }) };
  });
  router.post('/api/invites/:code/revoke', (ctx) => { requireRole(ctx, 'admin', 'staff'); return { revoked: auth.revokeInvite(ctx.params.code) }; });
  /** Public: redeem an invite into an account. Body { code, username, password, displayName? }. */
  router.post('/api/invites/redeem', (ctx) => {
    const b = ctx.body || {};
    return { user: auth.redeemInvite(b.code, b) };
  });
  router.get('/api/invites/:code', (ctx) => {
    const inv = auth.listInvites().find((i) => i.code === String(ctx.params.code).toUpperCase());
    if (!inv || inv.usedBy || inv.expiresAt < new Date().toISOString()) throw new HttpError(404, 'invite not valid');
    return { invite: { code: inv.code, role: inv.role, displayName: inv.displayName, expiresAt: inv.expiresAt } };
  });
}
