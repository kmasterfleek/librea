// Read-only curriculum documents (markdown) the district keeps alongside its
// data, so assignments built on the vibe layer can cite them. Files live in
// data/seed/curriculum by default; a district can point LIBREA_CURRICULUM
// anywhere.
import fs from 'node:fs';
import path from 'node:path';
import { HttpError } from './router.js';
import { requireUser } from './context.js';

export function registerCurriculum(router, { root }) {
  const dir = process.env.LIBREA_CURRICULUM || path.join(root, 'data', 'seed', 'curriculum');
  const list = () => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort() : []);
  const title = (f) => (fs.readFileSync(path.join(dir, f), 'utf8').match(/^#\s+(.+)$/m) || [])[1] || f;

  router.get('/api/curriculum', (ctx) => {
    requireUser(ctx);
    return { docs: list().map((f) => ({ id: f.replace(/\.md$/, ''), title: title(f) })) };
  });

  router.get('/api/curriculum/:id', (ctx) => {
    requireUser(ctx);
    const id = String(ctx.params.id).replace(/[^a-zA-Z0-9_-]/g, '');
    const file = path.join(dir, id + '.md');
    if (!file.startsWith(path.resolve(dir)) || !fs.existsSync(file)) throw new HttpError(404, 'no such document');
    return { id, title: title(id + '.md'), markdown: fs.readFileSync(file, 'utf8') };
  });
}
