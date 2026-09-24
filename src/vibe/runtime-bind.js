// Injected into design-first apps next to the bindings. Reads the slot list,
// runs each recipe's SQL through the broker (scoped to the viewer), and renders
// by kind into the slot element. The design never touched a record; this does,
// at view time, on the district's machine.
export const RUNTIME_BIND_JS = String.raw`
(function () {
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  function fmt(v) { return typeof v === 'number' ? (Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 1 })) : esc(v); }
  function render(el, kind, res, b) {
    var rows = res.rows || [], cols = res.columns || [];
    if (!rows.length) { el.innerHTML = '<p class="librea-empty" style="opacity:.65;margin:0">No data yet.</p>'; return; }
    if (kind === 'stat') {
      var v = rows[0][cols[cols.length - 1]];
      el.innerHTML = '<div class="librea-stat"><span class="librea-stat-n" style="font-size:2rem;font-weight:700;display:block">' + fmt(v) + '</span><span class="librea-stat-k" style="opacity:.7">' + esc(b.label || cols[cols.length - 1].replace(/_/g, ' ')) + '</span></div>';
      return;
    }
    if (kind === 'bar' || kind === 'line') {
      var c = document.createElement('canvas'); c.style.width = '100%'; c.style.height = (el.getAttribute('data-height') || 260) + 'px'; el.innerHTML = ''; el.appendChild(c);
      var labels = rows.map(function (r) { return String(r[cols[0]]); }), values = rows.map(function (r) { return Number(r[cols[1]]) || 0; });
      var opts = { color: b.color || getComputedStyle(document.documentElement).getPropertyValue('--accent') || undefined, title: b.label || '' };
      try { librea.chart[kind](c, labels, values, opts); } catch (e) { el.innerHTML = '<p style="opacity:.65">' + esc(e.message) + '</p>'; }
      return;
    }
    if (kind === 'list') {
      el.innerHTML = '<ul class="librea-list" style="padding-left:18px;margin:0">' + rows.map(function (r) { return '<li>' + esc(r[cols[0]]) + '</li>'; }).join('') + '</ul>';
      return;
    }
    el.innerHTML = '<div style="overflow-x:auto"><table class="librea-table" style="width:100%;border-collapse:collapse"><thead><tr>' + cols.map(function (k) { return '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid rgba(0,0,0,.12)">' + esc(k.replace(/_/g, ' ')) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) { return '<tr>' + cols.map(function (k) { return '<td style="padding:6px 8px;border-bottom:1px solid rgba(0,0,0,.06)">' + fmt(r[k]) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>' + (res.truncated ? '<p style="opacity:.65;font-size:.85em">Showing the first ' + rows.length + ' rows.</p>' : '');
  }
  async function bindAll() {
    var node = document.getElementById('librea-bindings');
    if (!node) return;
    var bindings = []; try { bindings = JSON.parse(node.textContent || '[]'); } catch (e) { return; }
    await librea.ready();
    await Promise.all(bindings.map(async function (b) {
      var el = document.querySelector('[data-slot="' + b.slot + '"]');
      if (!el) return;
      el.innerHTML = '<p style="opacity:.6;margin:0">Loading…</p>';
      try { render(el, b.kind, await librea.sql(b.sql, { limit: b.limit || 200 }), b); }
      catch (e) { el.innerHTML = '<p style="opacity:.65;margin:0">Could not load: ' + esc(e.message) + '</p>'; }
    }));
    if (typeof librea.footer === 'function') librea.footer();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindAll); else bindAll();
})();
`;
