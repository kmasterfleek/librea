// Install the edition's starter apps as published vibe apps: the manifest goes
// into the hash-chained ledger (store.upsertApp), the HTML is copied to
// <dataDir>/apps/<slug>/v1.html where src/vibe/apps.js expects to find it.
import fs from 'node:fs';
import path from 'node:path';

/**
 * @param {{store: object, dataDir: string, dir: string, author: object}} o
 * @returns {string[]} slugs installed
 */
export function installApps({ store, dataDir, dir, author }) {
  const manifestFile = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestFile)) return [];
  const entries = JSON.parse(fs.readFileSync(manifestFile, 'utf8')).apps || [];
  const now = new Date().toISOString();
  const out = [];
  for (const e of entries) {
    const src = path.join(dir, e.file);
    if (!fs.existsSync(src)) { console.warn(`  app ${e.slug}: ${e.file} missing, skipped`); continue; }
    const target = path.join(dataDir, 'apps', e.slug);
    fs.mkdirSync(target, { recursive: true });
    fs.copyFileSync(src, path.join(target, 'v1.html'));
    store.upsertApp({
      slug: e.slug,
      title: e.title,
      prompt: e.prompt,
      provider: 'starter',
      model: 'librea-alt-starter',
      scope: e.scope || { visibility: ['school', 'staff'] },
      author,
      createdAt: now,
      updatedAt: now,
      version: 1,
      published: true,
      templateGenerated: true,
      warnings: [],
      history: [{ version: 1, prompt: e.prompt, createdAt: now, by: author.username }],
    }, author.username);
    out.push(e.slug);
  }
  return out;
}
