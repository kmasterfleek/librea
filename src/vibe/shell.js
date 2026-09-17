// The shell: the same-origin page that frames an app and brokers its data.
// The app iframe is sandboxed with an opaque origin, so it can talk to exactly
// one thing — this page — and this page calls POST /api/query with the app's
// slug in a header. The server narrows the viewer's scope from there.
import { scopeBadge } from './apps.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const SHELL_CSS = `
:root{--bg:#faf7f2;--card:#fff;--ink:#23201c;--mut:#6d6559;--line:#e7e0d5;--accent:#3d6b8e}
@media (prefers-color-scheme:dark){:root{--bg:#1a1815;--card:#232019;--ink:#f0ebe3;--mut:#a79c8d;--line:#3a352c;--accent:#7fa8c9}}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;display:flex;flex-direction:column;background:var(--bg);color:var(--ink);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:10px 16px;border-bottom:1px solid var(--line);background:var(--card)}
header h1{font-size:15px;margin:0;font-weight:650;letter-spacing:-.01em}
.by{color:var(--mut);font-size:13px}
.badge{font-size:12px;padding:3px 10px;border-radius:999px;background:rgba(61,107,142,.12);color:var(--accent);white-space:nowrap}
.draft{background:rgba(201,123,74,.16);color:#a8622f}
nav{margin-left:auto;display:flex;gap:14px}
a{color:var(--accent);text-decoration:none;font-size:13.5px}
a:hover{text-decoration:underline}
iframe{flex:1;width:100%;border:0;background:var(--bg)}
.mid{margin:auto;max-width:400px;width:100%;padding:28px;background:var(--card);border:1px solid var(--line);border-radius:14px}
label{display:block;font-size:12.5px;color:var(--mut);margin:12px 0 4px}
input{width:100%;font:inherit;color:inherit;background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:10px}
button{margin-top:16px;width:100%;font:inherit;font-weight:600;background:var(--accent);color:#fff;border:0;border-radius:10px;padding:11px;cursor:pointer}
.err{color:#b4585f;font-size:13.5px;margin-top:10px;min-height:1em}
:focus-visible{outline:2px solid #c97b4a;outline-offset:2px}
`.trim();

/** The sign-in page shown when an app is opened by someone with no session. */
export function signInPage(app) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in &middot; ${esc(app.title)}</title><style>${SHELL_CSS}</style></head>
<body>
<form class="mid" id="f" autocomplete="on">
  <h1 style="margin:0 0 4px;font-size:19px">${esc(app.title)}</h1>
  <p class="by" style="margin:0">Sign in to open this app. It runs on this machine and reads only what your account may see.</p>
  <label for="u">Username</label><input id="u" name="username" autocomplete="username" required>
  <label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password" required>
  <button type="submit">Sign in</button>
  <p class="err" id="e" role="alert"></p>
</form>
<script>
document.getElementById('f').addEventListener('submit', function (ev) {
  ev.preventDefault();
  document.getElementById('e').textContent = '';
  fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: document.getElementById('u').value, password: document.getElementById('p').value }) })
    .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'sign in failed'); return j; }); })
    .then(function () { location.reload(); })
    .catch(function (err) { document.getElementById('e').textContent = err.message; });
});
</script>
</body></html>`;
}

/**
 * The app shell. `version` is the version to frame; `user` is the signed-in
 * viewer. The broker below is the only thing standing between the iframe and
 * the store, and it adds nothing the server would not already allow.
 */
export function shellPage(app, { version, user }) {
  const badge = scopeBadge(app.scope);
  const draft = app.published ? '' : '<span class="badge draft">draft</span>';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(app.title)} &middot; Librea</title><style>${SHELL_CSS}</style></head>
<body>
<header>
  <h1>${esc(app.title)}</h1>
  <span class="by">by ${esc(app.author?.displayName || app.author?.username || 'unknown')}${app.templateGenerated ? ' &middot; built offline from a Librea template' : ''}${app.mode === 'design' ? ' &middot; designed, then bound to data here' : ''}</span>
  <span class="badge" title="Enforced on the server, not in the page">${esc(badge)}</span>
  ${draft}
  <nav>
    <a href="${app.mode === 'design' ? '/#/design?slug=' : '/#/build?remix='}${encodeURIComponent(app.slug)}">${app.mode === 'design' ? 'Revise' : 'Remix'}</a>
    <a href="/">Librea</a>
  </nav>
</header>
<iframe id="app" title="${esc(app.title)}" sandbox="allow-scripts" src="/a/${encodeURIComponent(app.slug)}/app.html?v=${Number(version)}"></iframe>
<script>
(function () {
  var SLUG = ${JSON.stringify(app.slug)};
  var ME = ${JSON.stringify({ role: user.role, username: user.username, displayName: user.displayName || user.username, entityId: user.entityId || null })};
  var frame = document.getElementById('app');

  function reply(msg) { try { frame.contentWindow.postMessage(msg, '*'); } catch (e) { /* frame gone */ } }

  window.addEventListener('message', function (ev) {
    if (ev.source !== frame.contentWindow) return;
    var d = ev.data;
    if (!d || d.librea !== 1) return;
    if (d.type === 'ready') { reply({ librea: 1, type: 'hello', me: ME }); return; }
    if (!d.id || typeof d.op !== 'string') return;
    fetch('/api/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Librea-App': SLUG },
      body: JSON.stringify({ op: d.op, args: d.args || {} }),
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (res.ok) reply({ librea: 1, id: d.id, ok: true, result: res.j });
        else reply({ librea: 1, id: d.id, ok: false, error: res.j && res.j.error || ('request failed (' + d.op + ')') });
      })
      .catch(function (err) { reply({ librea: 1, id: d.id, ok: false, error: err.message }); });
  });
})();
</script>
</body></html>`;
}
