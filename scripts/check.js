// "Build" for a no-build project: syntax-check every module by importing it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } })(path.join(ROOT, 'src'));
let bad = 0;
for (const f of files) {
  try { await import(pathToFileURL(f).href); } catch (e) { bad++; console.error('FAIL', path.relative(ROOT, f), '-', e.message); }
  const lines = fs.readFileSync(f, 'utf8').split('\n').length;
  if (lines > 500) { bad++; console.error('TOO LONG', path.relative(ROOT, f), lines, 'lines'); }
}
console.log(bad ? `${bad} problem(s) in ${files.length} modules` : `ok: ${files.length} modules import cleanly, all under 500 lines`);
process.exit(bad ? 1 : 0);
