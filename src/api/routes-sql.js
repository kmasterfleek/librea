// SQL surface: schema browser, scoped read-only queries, fact writes, derivation.
import { HttpError } from './router.js';
import { requireUser, requireRole } from './context.js';
import { runScoped, schemaFor } from '../sql/query.js';
import { deriveAll } from '../sql/derive.js';
import { FACT_TABLE_NAMES } from '../sql/schema.js';

export function registerSql(router, { store, sql }) {
  router.get('/api/sql/schema', (ctx) => { requireUser(ctx); return schemaFor(ctx.scope); });

  /** Body { sql, limit? }. Read-only, scoped by the caller (and the app, if any). */
  router.post('/api/sql/query', (ctx) => {
    requireUser(ctx);
    const b = ctx.body || {};
    return runScoped(sql.db, b.sql, ctx.scope, { limit: b.limit });
  });

  router.get('/api/sql/status', (ctx) => { requireRole(ctx, 'admin', 'staff'); return { file: sql.file, seq: sql.seq, ledgerSeq: store.ledger.seq, counts: sql.counts() }; });

  router.post('/api/sql/rebuild', (ctx) => { requireRole(ctx, 'admin'); return { seq: sql.rebuild(store), counts: sql.counts() }; });

  /** Bulk upsert rows into a fact table. Body { rows: [...] }. */
  router.post('/api/facts/:table', (ctx) => {
    requireRole(ctx, 'admin', 'staff');
    if (!FACT_TABLE_NAMES.includes(ctx.params.table)) throw new HttpError(404, `no such fact table; one of ${FACT_TABLE_NAMES.join(', ')}`);
    const b = ctx.body || {};
    const r = store.upsertFacts(ctx.params.table, b.rows, ctx.user.username);
    let derived = null;
    if (b.derive !== false) {
      const ids = [...new Set(b.rows.map((row) => row.studentSourcedId || (ctx.params.table === 'enrollments' ? row.userSourcedId : null)).filter(Boolean))];
      if (ids.length) derived = deriveAll(sql.db, store, ids, ctx.user.username);
    }
    return { ...r, derived };
  });

  /** Delete rows by key. Body { ids: [...] } (DELETE bodies are not read, so this is a POST). */
  router.post('/api/facts/:table/delete', (ctx) => {
    requireRole(ctx, 'admin');
    if (!FACT_TABLE_NAMES.includes(ctx.params.table)) throw new HttpError(404, 'no such fact table');
    return store.deleteFacts(ctx.params.table, (ctx.body || {}).ids, ctx.user.username);
  });

  /** Recompute metrics from facts for some or all students. Body { ids? }. */
  router.post('/api/derive', (ctx) => {
    requireRole(ctx, 'admin', 'staff');
    return deriveAll(sql.db, store, (ctx.body || {}).ids || null, ctx.user.username);
  });

}
