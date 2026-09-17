// Export: the third sovereignty check is "what survives your exit". Everything
// here comes back out as plain files a district can read without Librea.
import fs from 'node:fs';
import { requireRole } from './context.js';
import { DIM_KEYS } from '../core/schema.js';

const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

export function registerExport(router, { store }) {
  /** Full JSON bundle: entities, fragments, apps, ledger head. */
  router.get('/api/export/bundle.json', (ctx) => {
    requireRole(ctx, 'admin');
    return {
      exportedAt: new Date().toISOString(), format: 'librea-bundle/1', ledger: store.ledger.verify(),
      entities: [...store.entities.values()], fragments: [...store.fragments.values()], apps: [...store.apps.values()],
    };
  });

  /** Students as CSV: identity, structured metrics, computed dims. */
  router.get('/api/export/students.csv', (ctx) => {
    requireRole(ctx, 'admin');
    const students = store.listEntities({ type: 'student' });
    const metricKeys = [...new Set(students.flatMap((s) => Object.keys(s.metrics || {})))].sort();
    const head = ['id', 'firstName', 'lastName', 'grade', 'schoolId', 'outcome', 'flags', ...metricKeys, ...DIM_KEYS.map((k) => 'dim_' + k)];
    const rows = students.map((s) => [s.id, s.firstName, s.lastName, s.grade, s.schoolId, s.outcome, (s.flags || []).map((f) => f.key).join('|'), ...metricKeys.map((k) => s.metrics?.[k]), ...DIM_KEYS.map((k) => s.dims?.[k])]);
    ctx.res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="librea-students.csv"' });
    ctx.res.end([head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n'));
  });

  /** Fragments as CSV: the co-authored record, in words. */
  router.get('/api/export/fragments.csv', (ctx) => {
    requireRole(ctx, 'admin');
    const head = ['id', 'entityId', 'kind', 'visibility', 'authorId', 'authorRole', 'source', 'createdAt', 'mediaPath', 'text'];
    const rows = [...store.fragments.values()].map((f) => [f.id, f.entityId, f.kind, f.visibility, f.author?.id, f.author?.role, f.source, f.createdAt, f.media?.path, f.text]);
    ctx.res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="librea-fragments.csv"' });
    ctx.res.end([head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n'));
  });

  /** The ledger itself, verbatim. */
  router.get('/api/export/ledger.jsonl', (ctx) => {
    requireRole(ctx, 'admin');
    ctx.res.writeHead(200, { 'content-type': 'application/x-ndjson', 'content-disposition': 'attachment; filename="librea-ledger.jsonl"' });
    ctx.res.end(fs.readFileSync(store.ledger.file));
  });
}
