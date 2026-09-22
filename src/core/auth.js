// Accounts, sessions, roles, scopes. Local file, scrypt hashes, no third party.
// Roles: admin (district), staff, student, family, app (a published vibe app).
import fs from 'node:fs';
import path from 'node:path';
import { scryptSync, randomBytes, timingSafeEqual, randomUUID } from 'node:crypto';
import { ROLE_VISIBILITY } from './schema.js';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export class Auth {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'users.json');
    this.users = new Map();
    this.sessions = new Map();
    fs.mkdirSync(dataDir, { recursive: true });
    if (fs.existsSync(this.file)) for (const u of JSON.parse(fs.readFileSync(this.file, 'utf8'))) this.users.set(u.username, u);
  }

  save() { fs.writeFileSync(this.file, JSON.stringify([...this.users.values()], null, 1)); }
  get bootstrapped() { return [...this.users.values()].some((u) => u.role === 'admin'); }

  /** Create a user. entityId links a student/family/staff account to its record. */
  createUser({ username, password, role, entityId = null, entityIds = [], displayName = '' }) {
    username = String(username || '').trim().toLowerCase();
    if (!/^[a-z0-9._@-]{2,80}$/.test(username)) throw new Error('username: 2-80 chars, letters/digits/._@-');
    if (typeof password !== 'string' || password.length < 8) throw new Error('password must be at least 8 characters');
    if (!['admin', 'staff', 'student', 'family'].includes(role)) throw new Error('bad role');
    if (this.users.has(username)) throw new Error('username taken');
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, 64).toString('hex');
    const u = { id: randomUUID(), username, role, salt, hash, entityId, entityIds, displayName, createdAt: new Date().toISOString() };
    this.users.set(username, u);
    this.save();
    return this.publicUser(u);
  }

  publicUser(u) { return u ? { id: u.id, username: u.username, role: u.role, entityId: u.entityId, entityIds: u.entityIds || [], displayName: u.displayName, active: u.active !== false, caseload: !!u.caseload } : null; }

  /** Admin edit: role, links, display name, password reset, activate/deactivate. */
  updateUser(username, patch = {}) {
    const u = this.users.get(String(username || '').toLowerCase());
    if (!u) throw new Error('no such user');
    if (patch.role != null) { if (!['admin', 'staff', 'student', 'family'].includes(patch.role)) throw new Error('bad role'); u.role = patch.role; }
    if ('entityId' in patch) u.entityId = patch.entityId || null;
    if (patch.entityIds != null) u.entityIds = [...new Set(patch.entityIds.map(String))];
    if (patch.displayName != null) u.displayName = String(patch.displayName).slice(0, 120);
    if (patch.caseload != null) u.caseload = !!patch.caseload;
    if (patch.password != null) {
      if (typeof patch.password !== 'string' || patch.password.length < 8) throw new Error('password must be at least 8 characters');
      u.salt = randomBytes(16).toString('hex');
      u.hash = scryptSync(patch.password, u.salt, 64).toString('hex');
      for (const [t, sess] of this.sessions) if (sess.username === u.username) this.sessions.delete(t);
    }
    if (patch.active != null) {
      u.active = !!patch.active;
      if (!u.active) for (const [t, sess] of this.sessions) if (sess.username === u.username) this.sessions.delete(t);
    }
    if (u.role !== 'admin' || [...this.users.values()].some((o) => o !== u && o.role === 'admin' && o.active !== false)) { /* ok */ } else throw new Error('cannot demote or deactivate the last admin');
    this.save();
    return this.publicUser(u);
  }

  login(username, password) {
    const u = this.users.get(String(username || '').toLowerCase());
    if (!u || u.active === false) return null;
    const hash = Buffer.from(scryptSync(String(password || ''), u.salt, 64));
    if (!timingSafeEqual(hash, Buffer.from(u.hash, 'hex'))) return null;
    const token = randomBytes(32).toString('hex');
    this.sessions.set(token, { username: u.username, exp: Date.now() + SESSION_TTL_MS });
    return { token, user: this.publicUser(u) };
  }

  logout(token) { this.sessions.delete(token); }

  resolve(token) {
    const s = token && this.sessions.get(token);
    if (!s) return null;
    if (s.exp < Date.now()) { this.sessions.delete(token); return null; }
    return this.publicUser(this.users.get(s.username));
  }

  listUsers() { return [...this.users.values()].map((u) => this.publicUser(u)); }

  // ---- invites: how a from-scratch school brings people in without an IT department ----
  get inviteFile() { return this.file.replace(/users\.json$/, 'invites.json'); }
  _loadInvites() { if (!this.invites) { this.invites = new Map(); if (fs.existsSync(this.inviteFile)) for (const i of JSON.parse(fs.readFileSync(this.inviteFile, 'utf8'))) this.invites.set(i.code, i); } return this.invites; }
  _saveInvites() { fs.writeFileSync(this.inviteFile, JSON.stringify([...this._loadInvites().values()], null, 1)); }

  /** Create an invite code for a role, optionally pre-linked to entity ids. Expires in `days`. */
  createInvite({ role, entityId = null, entityIds = [], displayName = '', days = 14, createdBy = 'admin' }) {
    if (!['staff', 'student', 'family', 'admin'].includes(role)) throw new Error('bad role');
    const code = randomBytes(6).toString('base64url').replace(/[^A-Za-z0-9]/g, 'x').slice(0, 8).toUpperCase();
    const inv = { code, role, entityId, entityIds, displayName, createdBy, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + days * 86400000).toISOString(), usedBy: null };
    this._loadInvites().set(code, inv);
    this._saveInvites();
    return inv;
  }

  listInvites() { return [...this._loadInvites().values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)); }
  revokeInvite(code) { const ok = this._loadInvites().delete(String(code).toUpperCase()); this._saveInvites(); return ok; }

  /** Redeem an invite: creates the account with the invite's role and links. */
  redeemInvite(code, { username, password, displayName }) {
    const inv = this._loadInvites().get(String(code || '').trim().toUpperCase());
    if (!inv) throw new Error('invalid invite code');
    if (inv.usedBy) throw new Error('invite already used');
    if (inv.expiresAt < new Date().toISOString()) throw new Error('invite expired');
    const user = this.createUser({ username, password, role: inv.role, entityId: inv.entityId, entityIds: inv.entityIds, displayName: displayName || inv.displayName });
    inv.usedBy = user.username; inv.usedAt = new Date().toISOString();
    this._saveInvites();
    return user;
  }
}

/**
 * What a principal may see. Returned object is consumed by the store and the
 * query layer; this is the single place that maps role -> data ceiling.
 *   visibility:    fragment audience labels this principal may read
 *   entityIds:     null = any entity, else only these (own record / own kids)
 *   pii:           may see names/ids of others
 */
export function scopeFor(user) {
  if (!user) return { role: 'anon', visibility: [], entityIds: [], pii: false, aggregates: false };
  const vis = ROLE_VISIBILITY[user.role] || [];
  switch (user.role) {
    case 'admin': return { role: 'admin', visibility: vis, entityIds: null, pii: true, aggregates: true };
    case 'staff': return { role: 'staff', visibility: vis, entityIds: null, pii: true, aggregates: true, caseload: !!user.caseload };
    case 'family': return { role: 'family', visibility: vis, entityIds: [...(user.entityIds || []), ...(user.entityId ? [user.entityId] : [])], pii: false, aggregates: true };
    case 'student': return { role: 'student', visibility: vis, entityIds: user.entityId ? [user.entityId] : [], pii: false, aggregates: true };
    default: return { role: user.role, visibility: [], entityIds: [], pii: false, aggregates: false };
  }
}

/** Intersect a user's scope with an app's declared scope (apps can only narrow). */
export function narrowScope(userScope, appScope) {
  if (!appScope) return userScope;
  const visibility = appScope.visibility ? userScope.visibility.filter((v) => appScope.visibility.includes(v)) : userScope.visibility;
  let entityIds = userScope.entityIds;
  if (appScope.entityIds) entityIds = entityIds ? entityIds.filter((id) => appScope.entityIds.includes(id)) : appScope.entityIds;
  return { ...userScope, visibility, entityIds, pii: userScope.pii && appScope.pii !== false, aggregatesOnly: !!appScope.aggregatesOnly };
}
