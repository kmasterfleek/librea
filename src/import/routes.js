// HTTP surface for the importer. Admin only: a roster upload rewrites the
// district's records, so nothing below is reachable by staff or families.
import fs from 'node:fs';
import path from 'node:path';
import { HttpError } from '../api/router.js';
import { requireRole } from '../api/context.js';
import { listPresets, CANONICAL_FIELDS, KINDS, PRESET_IDS } from './presets.js';
import { previewImport, applyImport } from './mapper.js';
import { ImportJobs } from './jobs.js';

const MAX_CSV = 32 * 1024 * 1024;
const SAMPLE_RE = /^[a-z0-9-]+\.csv$/;

/** The CSV can arrive as JSON {csv} or as a raw text/csv body. */
function csvFrom(ctx) {
  const body = ctx.body;
  const text = Buffer.isBuffer(body) ? body.toString('utf8')
    : typeof body === 'string' ? body
      : typeof body?.csv === 'string' ? body.csv : null;
  if (typeof text !== 'string' || !text.trim()) throw new HttpError(400, 'csv text required');
  if (text.length > MAX_CSV) throw new HttpError(413, 'csv too large (32 MB max)');
  return text;
}

/** Options may ride along in the JSON body or in the query string. */
function optsFrom(ctx) {
  const b = Buffer.isBuffer(ctx.body) || typeof ctx.body === 'string' ? {} : (ctx.body || {});
  const preset = b.preset || ctx.query.preset || undefined;
  const kind = b.kind || ctx.query.kind || undefined;
  if (preset && !PRESET_IDS.includes(preset)) throw new HttpError(400, `unknown preset: ${preset}`);
  if (kind && !KINDS.includes(kind)) throw new HttpError(400, `unknown kind: ${kind}`);
  return { preset, kind, mapping: b.mapping || undefined, dryRun: b.dryRun === true || ctx.query.dryRun === 'true' };
}

export function register(router, { store, sql, root }) {
  const jobs = new ImportJobs(store);
  const samplesDir = path.join(root || process.cwd(), 'data/seed/samples');

  router.get('/api/import/presets', (ctx) => {
    requireRole(ctx, 'admin');
    return { presets: listPresets(), kinds: KINDS, fields: CANONICAL_FIELDS };
  });

  router.post('/api/import/preview', (ctx) => {
    requireRole(ctx, 'admin');
    return previewImport(csvFrom(ctx), optsFrom(ctx));
  });

  router.post('/api/import/apply', (ctx) => {
    const user = requireRole(ctx, 'admin');
    const opts = optsFrom(ctx);
    const actor = user.username || user.id || 'admin';
    const result = applyImport(store, csvFrom(ctx), { ...opts, actor, sql });
    let jobId = null;
    if (!opts.dryRun && result.kind === 'students' && result.entityIds.length) {
      jobId = jobs.enqueue({ entityIds: result.entityIds, preset: result.preset, actor }).id;
    }
    return { ...result, jobId };
  });

  router.get('/api/import/jobs', (ctx) => {
    requireRole(ctx, 'admin');
    return { jobs: jobs.list() };
  });

  router.get('/api/import/jobs/:id', (ctx) => {
    requireRole(ctx, 'admin');
    const job = jobs.get(ctx.params.id);
    if (!job) throw new HttpError(404, 'no such job');
    return { job };
  });

  // Sample exports so the UI can offer "try a sample" without a real file.
  router.get('/api/import/samples', (ctx) => {
    requireRole(ctx, 'admin');
    if (!fs.existsSync(samplesDir)) return { samples: [] };
    const samples = fs.readdirSync(samplesDir).filter((f) => SAMPLE_RE.test(f))
      .map((f) => ({ name: f, bytes: fs.statSync(path.join(samplesDir, f)).size }));
    return { samples };
  });

  router.get('/api/import/samples/:name', (ctx) => {
    requireRole(ctx, 'admin');
    const name = ctx.params.name;
    if (!SAMPLE_RE.test(name)) throw new HttpError(400, 'bad sample name');
    const file = path.join(samplesDir, name);
    if (!file.startsWith(path.resolve(samplesDir)) || !fs.existsSync(file)) throw new HttpError(404, 'no such sample');
    return { name, csv: fs.readFileSync(file, 'utf8') };
  });

  return { jobs };
}
