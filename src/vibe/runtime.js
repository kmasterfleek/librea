// The runtime injected as the first <script> of every vibe app.
// The app iframe is sandboxed (opaque origin) with a CSP that blocks all
// network access, so postMessage to the parent shell is the ONLY channel out.
// Everything here is dependency-free and must stay under 400 lines.

export const RUNTIME_JS = String.raw`
(function () {
  'use strict';
  var pending = new Map();
  var seq = 0;
  var readyResolve = null;
  var readyPromise = new Promise(function (r) { readyResolve = r; });
  var identity = null;

  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || d.librea !== 1) return;
    if (d.type === 'hello') { identity = d.me || null; if (readyResolve) { readyResolve(identity); readyResolve = null; } return; }
    var p = pending.get(d.id);
    if (!p) return;
    pending.delete(d.id);
    if (d.ok) p.resolve(d.result);
    else p.reject(new Error(d.error || 'request failed'));
  });

  function call(op, args) {
    return new Promise(function (resolve, reject) {
      var id = 'r' + (++seq);
      pending.set(id, { resolve: resolve, reject: reject });
      setTimeout(function () {
        if (pending.has(id)) { pending.delete(id); reject(new Error('timed out: ' + op)); }
      }, 30000);
      parent.postMessage({ librea: 1, id: id, op: op, args: args || {} }, '*');
    });
  }

  function ready() {
    parent.postMessage({ librea: 1, type: 'ready' }, '*');
    return readyPromise;
  }

  // ---------- data API ----------
  var api = {
    ready: ready,
    me: function () { return call('me', {}); },
    stats: function () { return call('stats', {}); },
    people: function (o) { return call('people', o || {}); },
    person: function (id) { return call('person', { id: id }); },
    fragments: function (id, o) { return call('fragments', Object.assign({ id: id }, o || {})); },
    search: function (q, o) { return call('search', Object.assign({ q: q }, o || {})); },
    similar: function (id, o) { return call('similar', Object.assign({ id: id }, o || {})); },
    aggregate: function (o) { return call('aggregate', o || {}); },
    addFragment: function (id, o) { return call('addFragment', Object.assign({ entityId: id }, o || {})); },
    schema: function () { return call('schema', {}); },
    sql: function (query, o) { return call('sql', Object.assign({ sql: query }, o || {})); },
    sqlSchema: function () { return call('sqlSchema', {}); },
    bindings: function () { return call('bindings', {}); }
  };

  // ---------- tiny DOM helper ----------
  api.el = function (tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'text') n.textContent = String(v);
      else if (k === 'html') n.innerHTML = String(v);
      else if (k === 'style' && typeof v === 'object') { for (var s in v) n.style[s] = v[s]; }
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
      else n.setAttribute(k, v === true ? '' : String(v));
    }
    var kids = children == null ? [] : (Array.isArray(children) ? children : [children]);
    for (var i = 0; i < kids.length; i++) {
      var c = kids[i];
      if (c == null || c === false) continue;
      n.appendChild(typeof c === 'object' && c.nodeType ? c : document.createTextNode(String(c)));
    }
    return n;
  };

  api.footer = function (target) {
    if (document.getElementById('librea-sovereign-footer')) return;
    var f = api.el('footer', { id: 'librea-sovereign-footer', style: {
      margin: '32px 0 0', padding: '14px 16px', borderTop: '1px solid rgba(0,0,0,.10)',
      font: '12px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
      color: 'rgba(0,0,0,.55)', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap'
    } }, [
      api.el('span', { text: 'Data stays here.', style: { fontWeight: '600' } }),
      api.el('span', { text: 'This app runs on your district\'s own machine and reads records through a scoped broker. No student data leaves the building.' })
    ]);
    (target || document.body).appendChild(f);
  };

  // ---------- canvas charts ----------
  var PALETTE = ['#3d6b8e', '#c97b4a', '#6d8f6a', '#8a6f9e', '#b4585f', '#4f8a8b', '#a3894a'];

  function prep(canvas, pad) {
    // Be forgiving: accept a 2D context, a canvas id, or a selector as well as the element.
    if (canvas && canvas.canvas && canvas.canvas.getContext) canvas = canvas.canvas;
    if (typeof canvas === 'string') canvas = document.getElementById(canvas) || document.querySelector(canvas);
    if (!canvas || !canvas.getContext) throw new Error('chart: pass a <canvas> element');
    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    var w = Math.max(160, Math.round(rect.width || canvas.width || 480));
    var h = Math.max(120, Math.round(rect.height || canvas.height || 260));
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    var c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    c.font = '12px ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif';
    c.textBaseline = 'middle';
    return { c: c, w: w, h: h, pad: pad };
  }

  function niceMax(v) {
    if (!(v > 0)) return 1;
    var mag = Math.pow(10, Math.floor(Math.log10(v)));
    var n = v / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  }

  function axes(g, max, opts) {
    var c = g.c, pad = g.pad;
    c.strokeStyle = 'rgba(0,0,0,.08)';
    c.fillStyle = 'rgba(0,0,0,.45)';
    c.lineWidth = 1;
    for (var i = 0; i <= 4; i++) {
      var y = Math.round(pad.t + (g.h - pad.t - pad.b) * (i / 4)) + 0.5;
      c.beginPath(); c.moveTo(pad.l, y); c.lineTo(g.w - pad.r, y); c.stroke();
      var val = max * (1 - i / 4);
      c.textAlign = 'right';
      c.fillText(opts && opts.format ? opts.format(val) : (Math.round(val * 100) / 100), pad.l - 8, y);
    }
  }

  function labelAxis(g, labels, step) {
    var c = g.c;
    c.fillStyle = 'rgba(0,0,0,.6)';
    c.textAlign = 'center';
    var every = Math.ceil(labels.length / Math.max(2, Math.floor((g.w - g.pad.l - g.pad.r) / 64)));
    for (var i = 0; i < labels.length; i++) {
      if (i % every) continue;
      var x = g.pad.l + step * (i + 0.5);
      var t = String(labels[i]);
      if (t.length > 12) t = t.slice(0, 11) + '…';
      c.fillText(t, x, g.h - g.pad.b + 14);
    }
  }

  function empty(g, msg) {
    var c = g.c;
    c.fillStyle = 'rgba(0,0,0,.4)';
    c.textAlign = 'center';
    c.fillText(msg || 'No data yet', g.w / 2, g.h / 2);
  }

  var chart = {};

  chart.bar = function (canvas, labels, values, opts) {
    opts = opts || {};
    var g = prep(canvas, { l: 48, r: 12, t: 16, b: 28 });
    if (!labels || !labels.length) return empty(g, opts.emptyText);
    var max = niceMax(Math.max.apply(null, values.concat([0])));
    axes(g, max, opts);
    var step = (g.w - g.pad.l - g.pad.r) / labels.length;
    var bw = Math.max(4, Math.min(48, step * 0.62));
    var base = g.h - g.pad.b;
    for (var i = 0; i < labels.length; i++) {
      var v = Number(values[i]) || 0;
      var hgt = max ? (base - g.pad.t) * (v / max) : 0;
      var x = g.pad.l + step * (i + 0.5) - bw / 2;
      g.c.fillStyle = opts.color || PALETTE[i % PALETTE.length];
      roundRect(g.c, x, base - hgt, bw, hgt, Math.min(5, bw / 2));
      g.c.fill();
    }
    labelAxis(g, labels, step);
    if (opts.title) { g.c.textAlign = 'left'; g.c.fillStyle = 'rgba(0,0,0,.7)'; g.c.fillText(opts.title, g.pad.l, 8); }
  };

  chart.line = function (canvas, labels, values, opts) {
    opts = opts || {};
    var g = prep(canvas, { l: 48, r: 12, t: 16, b: 28 });
    if (!labels || !labels.length) return empty(g, opts.emptyText);
    var max = niceMax(Math.max.apply(null, values.concat([0])));
    axes(g, max, opts);
    var step = (g.w - g.pad.l - g.pad.r) / labels.length;
    var base = g.h - g.pad.b;
    var pts = [];
    for (var i = 0; i < labels.length; i++) {
      var v = Number(values[i]) || 0;
      pts.push([g.pad.l + step * (i + 0.5), base - (max ? (base - g.pad.t) * (v / max) : 0)]);
    }
    var c = g.c;
    var color = opts.color || PALETTE[0];
    c.beginPath();
    c.moveTo(pts[0][0], base);
    for (var j = 0; j < pts.length; j++) c.lineTo(pts[j][0], pts[j][1]);
    c.lineTo(pts[pts.length - 1][0], base);
    c.closePath();
    c.fillStyle = hexA(color, 0.12);
    c.fill();
    c.beginPath();
    for (var k = 0; k < pts.length; k++) (k ? c.lineTo : c.moveTo).call(c, pts[k][0], pts[k][1]);
    c.strokeStyle = color; c.lineWidth = 2; c.lineJoin = 'round'; c.stroke();
    c.fillStyle = color;
    for (var m = 0; m < pts.length; m++) { c.beginPath(); c.arc(pts[m][0], pts[m][1], 3, 0, Math.PI * 2); c.fill(); }
    labelAxis(g, labels, step);
  };

  chart.radar = function (canvas, labels, values, opts) {
    opts = opts || {};
    var g = prep(canvas, { l: 8, r: 8, t: 8, b: 8 });
    if (!labels || !labels.length) return empty(g, opts.emptyText);
    var c = g.c;
    var cx = g.w / 2, cy = g.h / 2;
    var R = Math.max(20, Math.min(g.w, g.h) / 2 - 46);
    var n = labels.length;
    var max = opts.max || 1;
    c.strokeStyle = 'rgba(0,0,0,.10)';
    for (var ring = 1; ring <= 4; ring++) {
      c.beginPath();
      for (var i = 0; i <= n; i++) {
        var a = (Math.PI * 2 * (i % n)) / n - Math.PI / 2;
        var r = R * (ring / 4);
        (i ? c.lineTo : c.moveTo).call(c, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      c.closePath(); c.stroke();
    }
    c.fillStyle = 'rgba(0,0,0,.55)';
    for (var s = 0; s < n; s++) {
      var ang = (Math.PI * 2 * s) / n - Math.PI / 2;
      c.beginPath(); c.moveTo(cx, cy);
      c.lineTo(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R); c.stroke();
      var lx = cx + Math.cos(ang) * (R + 20), ly = cy + Math.sin(ang) * (R + 20);
      c.textAlign = Math.abs(Math.cos(ang)) < 0.2 ? 'center' : (Math.cos(ang) > 0 ? 'left' : 'right');
      var t = String(labels[s]);
      c.fillText(t.length > 13 ? t.slice(0, 12) + '…' : t, lx, ly);
    }
    var color = opts.color || PALETTE[0];
    c.beginPath();
    for (var p = 0; p <= n; p++) {
      var idx = p % n;
      var av = (Math.PI * 2 * idx) / n - Math.PI / 2;
      var vv = Math.max(0, Math.min(1, (Number(values[idx]) || 0) / max));
      (p ? c.lineTo : c.moveTo).call(c, cx + Math.cos(av) * R * vv, cy + Math.sin(av) * R * vv);
    }
    c.closePath();
    c.fillStyle = hexA(color, 0.25); c.fill();
    c.strokeStyle = color; c.lineWidth = 2; c.stroke();
  };

  function roundRect(c, x, y, w, h, r) {
    if (h < 0) { y += h; h = -h; }
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function hexA(hex, a) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  api.chart = chart;
  api.palette = PALETTE;
  window.librea = api;
})();
`;

export default RUNTIME_JS;
