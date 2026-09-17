// Minimal HTTP router on node:http. No framework, no middleware stack to audit.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv' };

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export class Router {
  constructor() { this.routes = []; this.statics = []; }

  add(method, pattern, handler) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }).replace(/\*$/, '(.*)') + '$');
    if (pattern.endsWith('*')) keys.push('rest');
    this.routes.push({ method, re, keys, handler });
    return this;
  }
  get(p, h) { return this.add('GET', p, h); }
  post(p, h) { return this.add('POST', p, h); }
  put(p, h) { return this.add('PUT', p, h); }
  delete(p, h) { return this.add('DELETE', p, h); }

  /** Serve a directory at a URL prefix. */
  static(prefix, dir) { this.statics.push({ prefix, dir }); return this; }

  async handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const ctx = { req, res, url, query: Object.fromEntries(url.searchParams), params: {}, body: null };
    try {
      for (const r of this.routes) {
        if (r.method !== req.method) continue;
        const m = url.pathname.match(r.re);
        if (!m) continue;
        r.keys.forEach((k, i) => { ctx.params[k] = decodeURIComponent(m[i + 1]); });
        if (['POST', 'PUT'].includes(req.method)) ctx.body = await readBody(req);
        const out = await r.handler(ctx);
        if (out !== undefined && !res.writableEnded) sendJson(res, 200, out);
        return;
      }
      for (const s of this.statics) {
        if (!url.pathname.startsWith(s.prefix)) continue;
        if (serveFile(res, s.dir, url.pathname.slice(s.prefix.length) || 'index.html')) return;
      }
      sendJson(res, 404, { error: 'not found' });
    } catch (err) {
      const status = err.status || (err.message?.startsWith('no such') ? 404 : 400);
      if (!err.status && status === 400 && process.env.LIBREA_DEBUG) console.error(err);
      if (!res.writableEnded) sendJson(res, status, { error: err.message || 'error' });
    }
  }

  listen(port, host = '127.0.0.1') {
    const server = http.createServer((req, res) => this.handle(req, res));
    return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
  }
}

export function sendJson(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

export function sendHtml(res, html, extraHeaders = {}) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...extraHeaders });
  res.end(html);
}

export function serveFile(res, dir, rel) {
  const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(dir, safe);
  if (!file.startsWith(path.resolve(dir))) return false;
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
  res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
  return true;
}

const MAX_BODY = 64 * 1024 * 1024; // 64 MB: CSV exports and photos

export function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new HttpError(413, 'body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      const ct = req.headers['content-type'] || '';
      if (ct.includes('application/json')) { try { resolve(buf.length ? JSON.parse(buf.toString('utf8')) : {}); } catch { reject(new HttpError(400, 'invalid JSON')); } }
      else resolve(buf);
    });
    req.on('error', reject);
  });
}

export function cookie(req, name) {
  const m = (req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}
