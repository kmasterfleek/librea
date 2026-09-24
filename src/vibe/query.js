// The broker. Every read a vibe app makes lands here, under the viewer's scope
// (already narrowed by the app's declared scope in context.js). Nothing else in
// the app has network access, so this file is the whole data surface.
import { HttpError } from '../api/router.js';
import { canSeeEntity, projectEntity } from '../api/context.js';
import { DIMENSIONS, DIM_KEYS, FRAGMENT_KINDS, VISIBILITY, STUDENT_METRICS, ENTITY_TYPES } from '../core/schema.js';
import { runScoped, schemaFor } from '../sql/query.js';
import { recipeSql, menuFor } from './recipes.js';

/** Minimum group size before an aggregate is reported to an aggregates-only app. */
export const K_ANON = 5;

const OPS = ['stats', 'people', 'person', 'fragments', 'search', 'similar', 'aggregate', 'addFragment', 'schema', 'me', 'sql', 'sqlSchema', 'recipe', 'recipes'];
const GROUPS = ['schoolId', 'grade', 'outcome', 'flag'];

// ---------- boundary validation ----------
const str = (v, name, max = 200) => {
  if (v == null) return null;
  if (typeof v !== 'string') throw new HttpError(400, `${name} must be a string`);
  const t = v.trim();
  if (t.length > max) throw new HttpError(400, `${name} too long (max ${max})`);
  return t || null;
};
const int = (v, name, min, max, dflt) => {
  if (v == null || v === '') return dflt;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new HttpError(400, `${name} must be a number`);
  return Math.max(min, Math.min(max, Math.trunc(n)));
};
const oneOf = (v, name, allowed) => {
  const t = str(v, name);
  if (t && !allowed.includes(t)) throw new HttpError(400, `${name} must be one of: ${allowed.join(', ')}`);
  return t;
};

function peopleFilter(a = {}) {
  const f = {};
  const type = oneOf(a.type, 'type', ENTITY_TYPES);
  if (type) f.type = type;
  const schoolId = str(a.schoolId, 'schoolId', 64);
  if (schoolId) f.schoolId = schoolId;
  if (a.grade != null && a.grade !== '') f.grade = int(a.grade, 'grade', -1, 13, undefined);
  const outcome = str(a.outcome, 'outcome', 40);
  if (outcome) f.outcome = outcome;
  const flag = str(a.flag, 'flag', 40);
  if (flag) f.flag = flag;
  const q = str(a.q, 'q', 200);
  if (q) f.q = q;
  return f;
}

/** Under aggregatesOnly an app may only name the entities the viewer owns. */
function individualIds(scope) {
  if (!scope.aggregatesOnly) return scope.entityIds;
  return scope.entityIds || [];
}

const visible = (scope, id) => {
  const ids = individualIds(scope);
  return ids === null || ids.includes(id);
};

/**
 * Run one broker op. `ctx` is the request context (ctx.scope already narrowed).
 * Returns a plain JSON-safe object.
 */
export async function runQuery({ op, args = {} }, ctx, store, deps = {}) {
  const name = str(op, 'op', 40);
  if (!name || !OPS.includes(name)) throw new HttpError(400, `unknown op: ${op}. Known ops: ${OPS.join(', ')}`);
  if (args == null || typeof args !== 'object' || Array.isArray(args)) throw new HttpError(400, 'args must be an object');
  const scope = ctx.scope;
  switch (name) {
    case 'me': return me(ctx);
    case 'schema': return schema();
    case 'stats': return stats(scope, store);
    case 'people': return people(args, scope, store);
    case 'person': return person(args, scope, store);
    case 'fragments': return fragments(args, scope, store);
    case 'search': return search(args, scope, store);
    case 'similar': return similar(args, scope, store);
    case 'aggregate': return aggregate(args, scope, store);
    case 'addFragment': return addFragment(args, ctx, store);
    case 'sql': return sql(args, scope, deps);
    case 'sqlSchema': return schemaFor(scope);
    case 'recipe': return recipe(args, scope, deps);
    case 'recipes': return menuFor(scope);
    default: throw new HttpError(400, `unknown op: ${name}`);
  }
}

function me(ctx) {
  const s = ctx.scope;
  const ids = individualIds(s);
  return {
    role: s.role,
    username: ctx.user?.username || null,
    displayName: ctx.user?.displayName || ctx.user?.username || 'Guest',
    entityId: ctx.user?.entityId || null,
    app: ctx.app ? { slug: ctx.app.slug, title: ctx.app.title } : null,
    scope: {
      visibility: s.visibility,
      sees: ids === null ? 'everyone in scope' : ids.length ? 'only these records' : 'aggregates only',
      entityIds: ids,
      names: !!s.pii,
      aggregatesOnly: !!s.aggregatesOnly,
      kAnonymity: s.aggregatesOnly ? K_ANON : 0,
    },
  };
}

function schema() {
  return { dimensions: DIMENSIONS, dimKeys: DIM_KEYS, fragmentKinds: FRAGMENT_KINDS, visibility: VISIBILITY, studentMetrics: STUDENT_METRICS, entityTypes: ENTITY_TYPES, groupBy: GROUPS };
}

function stats(scope, store) {
  const s = store.stats();
  if (!scope.aggregates) throw new HttpError(403, 'this app may not read aggregates');
  return { entities: s.entities, students: s.students, staff: s.staff, families: s.families, fragments: s.fragments, schools: s.schools, outcomes: s.outcomes, dimMeans: s.dimMeans };
}

function people(args, scope, store) {
  const limit = int(args.limit, 'limit', 1, 500, 100);
  const offset = int(args.offset, 'offset', 0, 1e6, 0);
  const ids = individualIds(scope);
  let list = store.listEntities(peopleFilter(args));
  if (ids !== null) list = list.filter((e) => ids.includes(e.id));
  const total = list.length;
  const page = list.slice(offset, offset + limit);
  return { total, limit, offset, truncated: offset + page.length < total, people: page.map((e) => projectEntity(scope, e)) };
}

function person(args, scope, store) {
  const id = str(args.id, 'id', 64);
  if (!id) throw new HttpError(400, 'id required');
  const e = store.getEntity(id);
  if (!e || !visible(scope, id)) throw new HttpError(404, 'no such person in this app’s scope');
  return { person: projectEntity(scope, e), fragments: store.getFragments(id, { visibility: scope.visibility }) };
}

function fragments(args, scope, store) {
  const id = str(args.id, 'id', 64);
  if (!id) throw new HttpError(400, 'id required');
  if (!visible(scope, id)) throw new HttpError(404, 'no such person in this app’s scope');
  const kind = oneOf(args.kind, 'kind', FRAGMENT_KINDS);
  let rows = store.getFragments(id, { visibility: scope.visibility });
  if (kind) rows = rows.filter((f) => f.kind === kind);
  return { entityId: id, fragments: rows.slice(0, int(args.limit, 'limit', 1, 500, 200)) };
}

async function search(args, scope, store) {
  const q = str(args.q, 'q', 500);
  if (!q) throw new HttpError(400, 'q required');
  const ids = individualIds(scope);
  if (scope.aggregatesOnly && !ids.length) return { results: [], note: 'This app reads aggregates only; individual search is off.' };
  const rows = await store.semanticSearch(q, {
    k: int(args.k, 'k', 1, 50, 10),
    visibility: scope.visibility,
    entityType: oneOf(args.type, 'type', ENTITY_TYPES) || undefined,
    schoolId: str(args.schoolId, 'schoolId', 64) || undefined,
    entityIds: ids || undefined,
  });
  return { results: rows.map((g) => ({ score: +g.score.toFixed(4), person: projectEntity(scope, g.entity), fragments: g.fragments })) };
}

async function similar(args, scope, store) {
  const id = str(args.id, 'id', 64);
  if (!id) throw new HttpError(400, 'id required');
  if (!visible(scope, id)) throw new HttpError(404, 'no such person in this app’s scope');
  const rows = await store.similar(id, { k: int(args.k, 'k', 1, 50, 10), space: oneOf(args.space, 'space', ['signal', 'semantic']) || 'signal' });
  const kept = rows.filter((r) => r.entity && visible(scope, r.entity.id));
  return { similar: kept.map((r) => ({ score: +r.score.toFixed(4), person: projectEntity(scope, r.entity) })), suppressed: rows.length - kept.length };
}

/**
 * Group the student body and report a count or the mean of one signal dimension.
 * For an aggregates-only app any group with fewer than K_ANON students is
 * dropped and only counted, so no single child can be read out of a chart.
 */
function aggregate(args, scope, store) {
  if (!scope.aggregates) throw new HttpError(403, 'this app may not read aggregates');
  const groupBy = oneOf(args.groupBy, 'groupBy', GROUPS) || 'schoolId';
  const metric = str(args.metric, 'metric', 40) || 'count';
  if (metric !== 'count' && !DIM_KEYS.includes(metric)) throw new HttpError(400, `metric must be 'count' or a dimension key: ${DIM_KEYS.join(', ')}`);
  const filter = peopleFilter(args.filter || {});
  filter.type = 'student';
  let rows = store.listEntities(filter);
  if (!scope.aggregatesOnly && scope.entityIds) rows = rows.filter((e) => scope.entityIds.includes(e.id));

  const buckets = new Map();
  const put = (key, e) => {
    const k = key == null || key === '' ? 'unknown' : String(key);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(e);
  };
  for (const e of rows) {
    if (groupBy === 'flag') { for (const f of e.flags || []) put(f.key, e); if (!(e.flags || []).length) put('none', e); }
    else put(e[groupBy], e);
  }

  let suppressed = 0;
  const groups = [];
  for (const [key, members] of buckets) {
    if (scope.aggregatesOnly && members.length < K_ANON) { suppressed += members.length; continue; }
    let value = members.length;
    if (metric !== 'count') {
      const vals = members.map((m) => m.dims?.[metric]).filter((v) => v != null);
      value = vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(4) : null;
    }
    groups.push({ key, label: groupLabel(groupBy, key, store), n: members.length, value });
  }
  groups.sort((a, b) => (groupBy === 'grade' ? Number(a.key) - Number(b.key) : (b.value ?? -1) - (a.value ?? -1)));
  return { groupBy, metric, total: rows.length, groups, suppressed, kAnonymity: scope.aggregatesOnly ? K_ANON : 0 };
}

function groupLabel(groupBy, key, store) {
  if (groupBy === 'schoolId') return store.getEntity(key)?.name || key;
  if (groupBy === 'grade') return key === 'unknown' ? 'Unknown' : key === '0' ? 'Kindergarten' : key === '-1' ? 'Pre-K' : `Grade ${key}`;
  return key;
}

/**
 * Read-only SQL under the viewer's scope. The database does the enforcing:
 * runScoped shadows every table with a TEMP view filtered to the rows and
 * columns this scope allows, so an aggregates-only app sees only the viewer's
 * own rows and no extra suppression is needed here.
 */
function sql(args, scope, deps) {
  const db = deps?.sql?.db;
  if (!db) throw new HttpError(503, 'the SQL projection is not available on this server');
  const text = str(args.sql, 'sql', 20000);
  if (!text) throw new HttpError(400, 'sql required');
  return runScoped(db, text, scope, { limit: int(args.limit, 'limit', 1, 2000, 2000) });
}

/** Apps may write a fragment onto the viewer's own record, or staff onto anyone in scope. */
async function addFragment(args, ctx, store) {
  const user = ctx.user;
  if (!user) throw new HttpError(401, 'sign in first');
  const entityId = str(args.entityId, 'entityId', 64);
  if (!entityId) throw new HttpError(400, 'entityId required');
  const text = str(args.text, 'text', 20000);
  if (!text) throw new HttpError(400, 'text required');
  const staff = ['admin', 'staff'].includes(user.role);
  const own = (user.entityId && user.entityId === entityId) || (user.entityIds || []).includes(entityId);
  if (!own && !staff) throw new HttpError(403, 'apps may only write to your own record');
  if (!canSeeEntity(ctx.scope, entityId)) throw new HttpError(404, 'no such person in this app’s scope');
  if (!store.getEntity(entityId)) throw new HttpError(404, 'no such person');
  const kind = oneOf(args.kind, 'kind', FRAGMENT_KINDS) || { student: 'self', family: 'family', staff: 'observation', admin: 'note' }[user.role] || 'note';
  if (user.role === 'student' && !['self', 'artifact', 'photo'].includes(kind)) throw new HttpError(403, 'students add self, artifact, or photo fragments');
  if (user.role === 'family' && !['family', 'photo'].includes(kind)) throw new HttpError(403, 'families add family or photo fragments');
  const visibility = oneOf(args.visibility, 'visibility', VISIBILITY) || 'school';
  if (!staff && visibility === 'staff') throw new HttpError(403, 'only staff can write staff-only notes');
  if (!ctx.scope.visibility.includes(visibility)) throw new HttpError(403, `this app may not write ${visibility} fragments`);
  const f = await store.addFragment({
    entityId, kind, text, visibility,
    author: { id: user.username, role: user.role, name: user.displayName || user.username },
    source: ctx.app ? `app:${ctx.app.slug}` : 'app',
  }, user.username);
  return { fragment: f };
}

/** A data recipe by id: the SQL is built here, on the server, never in the app. */
function recipe(args, scope, deps) {
  if (!deps.sql?.db) { const e = new Error('SQL projection not available'); e.status = 503; throw e; }
  const id = String(args.id || '');
  let built;
  try { built = recipeSql(id, args.params && typeof args.params === 'object' ? args.params : {}); }
  catch (e) { e.status = 400; throw e; }
  const out = runScoped(deps.sql.db, built.sql, scope, { limit: Math.min(200, Number(args.limit) || 200) });
  return { ...out, recipe: id, kind: built.kind };
}
