// Dependency-free canvas charts: a 15-dimension radar grouped by domain, a bar
// list, and a sparkline. Everything reads CSS custom properties so light and
// dark themes stay in step.
import { h } from '/app.js';

const DOMAIN_VAR = { Academic: '--d-academic', Behavioral: '--d-behavioral', Wellness: '--d-wellness', Environment: '--d-environment' };

function css(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}
export const domainColor = (domain) => css(DOMAIN_VAR[domain] || '--accent', '#a2552b');

function hidpi(canvas, w, hgt) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(hgt * dpr);
  canvas.style.width = w + 'px';
  canvas.style.height = hgt + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return ctx;
}

/**
 * Radar of the 15 dimensions.
 * dims: {key: 0..1|null}; dimensions: schema DIMENSIONS; compare: optional second series.
 */
export function radar(dims, dimensions, { size = 320, compare = null, compareLabel = 'District mean' } = {}) {
  const canvas = h('canvas', { role: 'img', 'aria-label': radarAlt(dims, dimensions) });
  const wrap = h('div', canvas);
  const draw = () => {
    const w = Math.max(220, Math.min(size, wrap.clientWidth || size));
    const ctx = hidpi(canvas, w, w);
    const cx = w / 2, cy = w / 2, r = w / 2 - 34;
    const n = dimensions.length;
    const line = css('--line', '#e6dccd');
    const faint = css('--ink-faint', '#8b8075');
    ctx.clearRect(0, 0, w, w);
    const pointAt = (i, v) => {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      return [cx + Math.cos(a) * r * v, cy + Math.sin(a) * r * v];
    };
    // rings
    ctx.strokeStyle = line; ctx.lineWidth = 1;
    for (const ring of [0.25, 0.5, 0.75, 1]) {
      ctx.beginPath();
      for (let i = 0; i <= n; i++) { const [x, y] = pointAt(i % n, ring); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.closePath(); ctx.stroke();
    }
    // spokes + ticks
    for (let i = 0; i < n; i++) {
      const [x, y] = pointAt(i, 1);
      ctx.strokeStyle = line;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke();
      const [lx, ly] = pointAt(i, 1.17);
      ctx.fillStyle = domainColor(dimensions[i].domain);
      ctx.font = '600 9px ' + css('--font', 'system-ui');
      ctx.textAlign = lx < cx - 6 ? 'right' : lx > cx + 6 ? 'left' : 'center';
      ctx.textBaseline = ly < cy ? 'bottom' : 'top';
      ctx.fillText(short(dimensions[i].label), lx, ly);
    }
    // comparison series first, behind
    if (compare) {
      ctx.strokeStyle = faint; ctx.setLineDash([3, 3]); ctx.lineWidth = 1.5;
      traceSeries(ctx, dimensions, compare, pointAt);
      ctx.stroke(); ctx.setLineDash([]);
    }
    // primary series, filled per-vertex by domain
    ctx.lineWidth = 2;
    ctx.strokeStyle = css('--accent', '#a2552b');
    ctx.fillStyle = css('--accent-soft', '#f3e3d7');
    traceSeries(ctx, dimensions, dims, pointAt);
    ctx.globalAlpha = 0.55; ctx.fill(); ctx.globalAlpha = 1; ctx.stroke();
    for (let i = 0; i < n; i++) {
      const v = dims?.[dimensions[i].key];
      if (v == null) continue;
      const [x, y] = pointAt(i, v);
      ctx.fillStyle = domainColor(dimensions[i].domain);
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
    }
  };
  requestAnimationFrame(draw);
  window.addEventListener('resize', debounce(draw, 150));
  if (compare) wrap.appendChild(h('p.small.muted', { style: 'margin:4px 0 0' }, `Dotted line: ${compareLabel}.`));
  return wrap;
}

function traceSeries(ctx, dimensions, values, pointAt) {
  ctx.beginPath();
  let started = false;
  dimensions.forEach((d, i) => {
    const v = values?.[d.key];
    const [x, y] = pointAt(i, v == null ? 0 : Math.max(0, Math.min(1, v)));
    if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
  });
  ctx.closePath();
}

function short(label) {
  if (label.length <= 13) return label;
  return label.split(' ')[0].slice(0, 12);
}

function radarAlt(dims, dimensions) {
  const parts = dimensions.filter((d) => dims?.[d.key] != null).map((d) => `${d.label} ${Math.round(dims[d.key] * 100)}%`);
  return parts.length ? 'Signal radar: ' + parts.join(', ') : 'Signal radar: no signals recorded yet';
}

/** Domain legend to sit under a radar. */
export function domainLegend() {
  return h('p.legend', Object.keys(DOMAIN_VAR).map((d) => h('span', { style: `color:${domainColor(d)}` }, d)));
}

/** Horizontal bars from [{label, value 0..1, note, color}]. */
export function bars(rows) {
  return h('div.bars', rows.map((r) => h('div.barrow',
    h('span', r.label),
    h('div.bartrack', h('div.barfill', { style: `width:${Math.round(Math.max(0, Math.min(1, r.value || 0)) * 100)}%${r.color ? ';background:' + r.color : ''}` })),
    h('span.small.muted', r.note != null ? r.note : Math.round((r.value || 0) * 100) + '%'),
  )));
}

/** Small sparkline for a series of numbers. */
export function sparkline(values, { width = 120, height = 28, color } = {}) {
  const canvas = h('canvas', { role: 'img', 'aria-label': `Trend of ${values.length} values` });
  requestAnimationFrame(() => {
    const ctx = hidpi(canvas, width, height);
    const nums = values.filter((v) => typeof v === 'number');
    if (nums.length < 2) return;
    const min = Math.min(...nums), max = Math.max(...nums), span = max - min || 1;
    ctx.strokeStyle = color || css('--accent', '#a2552b');
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    nums.forEach((v, i) => {
      const x = (i / (nums.length - 1)) * (width - 2) + 1;
      const y = height - 2 - ((v - min) / span) * (height - 4);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
  });
  return canvas;
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
