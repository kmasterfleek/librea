// The binder: injected after the runtime into every design app. It reads the
// manifest the designer wrote, asks the broker for each slot's rows (already
// shaped and scoped on the server), and renders standard markup into each
// data-slot region. The design's CSS styles that markup. There is no other
// script in a design app, so this file is the whole of its behavior.
//
// Samples from the manifest are rendered ONLY when the broker says
// preview: true (a draft, opened by someone who may edit it). A reader of a
// published app never sees a sample; an unbound slot shows its empty state.

export const BINDER_JS = String.raw`
(function () {
  'use strict';
  // The binder is injected at the top of <head>, before the manifest has been
  // parsed, so everything waits for the document to finish loading.
  var manifest = null;

  function region(id) {
    var els = document.querySelectorAll('[data-slot]');
    for (var i = 0; i < els.length; i++) if (els[i].getAttribute('data-slot') === id) return els[i];
    return null;
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
  function fmt(v) {
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
    return v == null ? '' : String(v);
  }

  var charts = [];

  function renderStat(root, slot, rows) {
    var r = rows[0] || {};
    var box = el('div', 'lb-stat');
    box.appendChild(el('div', 'lb-stat-value', fmt(r.value)));
    box.appendChild(el('div', 'lb-stat-label', r.label != null ? r.label : slot.label));
    if (r.note != null && r.note !== '') box.appendChild(el('div', 'lb-stat-note', r.note));
    root.appendChild(box);
  }

  function renderChart(root, slot, rows, kind) {
    var canvas = el('canvas', 'lb-chart');
    var h = root.getBoundingClientRect().height;
    canvas.style.width = '100%';
    canvas.style.height = Math.max(160, Math.round(h || 0) || 240) + 'px';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', slot.label + ': ' + rows.map(function (r) { return r.label + ' ' + fmt(r.value); }).join(', '));
    root.appendChild(canvas);
    var draw = function () {
      var labels = rows.map(function (r) { return r.label; });
      var values = rows.map(function (r) { return Number(r.value) || 0; });
      (kind === 'line' ? window.librea.chart.line : window.librea.chart.bar)(canvas, labels, values, {});
    };
    charts.push(draw);
    draw();
  }

  function renderTable(root, slot, rows) {
    var cols = slot.columns || [];
    var t = el('table', 'lb-table');
    var thead = el('thead'), tr = el('tr');
    cols.forEach(function (c) { var th = el('th', null, c.label || c.key); th.setAttribute('scope', 'col'); tr.appendChild(th); });
    thead.appendChild(tr); t.appendChild(thead);
    var tbody = el('tbody');
    rows.forEach(function (r) {
      var row = el('tr');
      cols.forEach(function (c) { row.appendChild(el('td', null, fmt(r[c.key]))); });
      tbody.appendChild(row);
    });
    t.appendChild(tbody);
    root.appendChild(t);
  }

  function renderList(root, slot, rows) {
    var ul = el('ul', 'lb-list');
    rows.forEach(function (r) {
      var li = el('li');
      li.appendChild(el('span', 'lb-list-title', r.title));
      if (r.subtitle != null && r.subtitle !== '') li.appendChild(el('span', 'lb-list-sub', r.subtitle));
      if (r.meta != null && r.meta !== '') li.appendChild(el('span', 'lb-list-meta', fmt(r.meta)));
      ul.appendChild(li);
    });
    root.appendChild(ul);
  }

  function renderText(root, slot, rows) {
    rows.forEach(function (r) { root.appendChild(el('p', 'lb-text', r.text)); });
  }

  function render(slot, res, preview) {
    var root = region(slot.id);
    if (!root) return;
    clear(root);
    root.classList.remove('lb-sample');
    var rows = null, note = null;
    if (res && res.error) { root.appendChild(el('p', 'lb-error', res.error)); return; }
    if (res && res.rows) { rows = res.rows; note = res.note || null; }
    else if (res && res.unbound && preview && Array.isArray(slot.sample) && slot.sample.length) {
      rows = slot.sample;
      root.classList.add('lb-sample');
      root.appendChild(el('span', 'lb-sample-tag', 'Sample data'));
    }
    if (!rows || !rows.length) {
      root.appendChild(el('p', 'lb-empty', slot.empty || (res && res.unbound ? 'This section has no data source yet.' : 'No data yet for this section.')));
      return;
    }
    if (slot.kind === 'stat') renderStat(root, slot, rows);
    else if (slot.kind === 'bar' || slot.kind === 'line') renderChart(root, slot, rows, slot.kind);
    else if (slot.kind === 'table') renderTable(root, slot, rows);
    else if (slot.kind === 'list') renderList(root, slot, rows);
    else if (slot.kind === 'text') renderText(root, slot, rows);
    if (res && res.truncated) root.appendChild(el('p', 'lb-note', 'Showing the first ' + rows.length + ' rows.'));
    if (note) root.appendChild(el('p', 'lb-note', note));
  }

  function run() {
    var m = document.getElementById('librea-design');
    if (!m || !window.librea) return;
    try { manifest = JSON.parse(m.textContent || ''); } catch (e) { return; }
    if (!manifest || !Array.isArray(manifest.slots)) return;
    window.librea.ready().then(function () {
      return window.librea.bindings();
    }).then(function (res) {
      var slots = (res && res.slots) || {};
      manifest.slots.forEach(function (slot) { render(slot, slots[slot.id] || { unbound: true }, !!(res && res.preview)); });
    }).catch(function (err) {
      manifest.slots.forEach(function (slot) { render(slot, { error: err && err.message ? err.message : 'could not load data' }, false); });
    }).then(function () { window.librea.footer(); });
  }

  var timer = null;
  window.addEventListener('resize', function () {
    clearTimeout(timer);
    timer = setTimeout(function () { charts.forEach(function (d) { try { d(); } catch (e) { /* ignore */ } }); }, 120);
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
`;

export default BINDER_JS;
