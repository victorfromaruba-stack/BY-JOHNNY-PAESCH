// Small SVG chart kit. One scale per chart, thin marks, hairline grid,
// tooltips that enhance but never gate (every chart has a table twin via
// `tableFor`). Colors come from CSS tokens so both themes work.

import { escapeHtml, fmtInt } from '../core/util.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, children = []) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  for (const c of children) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return n;
};
const niceMax = (v) => {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / p;
  const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return n * p;
};

/** Sparkline: single series, area wash, emphasized endpoint. */
export function sparkline(values, { width = 160, height = 44, stroke = 'var(--series-1)', fill = 'var(--series-1)' } = {}) {
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', height, role: 'img', 'aria-label': 'trend' , class: 'spark' });
  if (!values.length) return svg;
  const max = Math.max(...values, 1), min = Math.min(...values, 0);
  const pad = 5;
  const x = (i) => pad + (i / Math.max(values.length - 1, 1)) * (width - pad * 2);
  const y = (v) => height - pad - ((v - min) / Math.max(max - min, 1)) * (height - pad * 2);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  svg.appendChild(el('path', { d: `M${pts[0]} L${pts.slice(1).join(' L')} L${x(values.length - 1).toFixed(1)},${height - pad} L${x(0)},${height - pad} Z`, fill, 'fill-opacity': '.1', stroke: 'none' }));
  svg.appendChild(el('path', { d: `M${pts.join(' L')}`, fill: 'none', stroke, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  const last = values.length - 1;
  svg.appendChild(el('circle', { cx: x(last), cy: y(values[last]), r: 4.5, fill: stroke, stroke: 'var(--surface-1)', 'stroke-width': 2 }));
  return svg;
}

/**
 * Column chart: one series (bars in slot 1) or two series (grouped) with a legend.
 * data: [{label, values:[n,(n)]}]; series: ['Paid', 'Points'] optional.
 */
export function columns(data, { series = [], height = 180, unit = '', ariaLabel = 'chart', highlightIndex = -1 } = {}) {
  const wrap = document.createElement('div'); wrap.className = 'chart';
  const width = 520, padL = 44, padR = 12, padT = 12, padB = 30;
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', role: 'img', 'aria-label': ariaLabel, class: 'chart-svg' });
  const allVals = data.flatMap(d => d.values);
  const max = niceMax(Math.max(...allVals, 1));
  const plotW = width - padL - padR, plotH = height - padT - padB;
  const y = (v) => padT + plotH - (v / max) * plotH;
  // grid: 4 hairlines + baseline
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i; const yy = y(v);
    svg.appendChild(el('line', { x1: padL, x2: width - padR, y1: yy, y2: yy, stroke: i === 0 ? 'var(--chart-axis)' : 'var(--chart-grid)', 'stroke-width': 1 }));
    svg.appendChild(el('text', { x: padL - 8, y: yy + 4, 'text-anchor': 'end', class: 'chart-tick' }, [compact(v)]));
  }
  const nSeries = Math.max(1, data[0]?.values.length || 1);
  const band = plotW / Math.max(data.length, 1);
  const barW = Math.min(24, (band - 10) / nSeries - 2);
  const groupW = barW * nSeries + 2 * (nSeries - 1);
  data.forEach((d, i) => {
    const gx = padL + band * i + (band - groupW) / 2;
    d.values.forEach((v, s) => {
      const h = Math.max(0, (v / max) * plotH);
      const bx = gx + s * (barW + 2);
      const dim = highlightIndex >= 0 && highlightIndex !== i;
      const rect = el('path', { d: roundedTop(bx, y(v), barW, h, 4), fill: `var(--series-${s + 1})`, opacity: dim ? .35 : 1, class: 'bar', tabindex: 0, 'data-label': d.label, 'data-value': `${series[s] ? series[s] + ': ' : ''}${fmtInt(v)}${unit}` });
      svg.appendChild(rect);
    });
    svg.appendChild(el('text', { x: gx + groupW / 2, y: height - 10, 'text-anchor': 'middle', class: 'chart-tick' }, [d.label]));
  });
  wrap.appendChild(svg);
  if (series.length > 1) {
    const legend = document.createElement('div'); legend.className = 'legend';
    legend.innerHTML = series.map((s, i) => `<span><i style="background:var(--series-${i + 1})"></i>${escapeHtml(s)}</span>`).join('');
    wrap.appendChild(legend);
  }
  attachTooltip(wrap, svg);
  return wrap;
}

/** Progress ring (meter). value 0..1 */
export function ring(value, { size = 120, thickness = 10, label = '', sub = '' } = {}) {
  const r = (size - thickness) / 2, c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  const svg = el('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, class: 'ring', role: 'img', 'aria-label': `${Math.round(v * 100)}%` });
  svg.appendChild(el('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', stroke: 'var(--ring-track)', 'stroke-width': thickness }));
  svg.appendChild(el('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', stroke: 'var(--ring-fill)', 'stroke-width': thickness, 'stroke-linecap': 'round', 'stroke-dasharray': c, 'stroke-dashoffset': c * (1 - v), transform: `rotate(-90 ${size / 2} ${size / 2})`, class: 'ring-fill' }));
  if (label) svg.appendChild(el('text', { x: size / 2, y: size / 2 + (sub ? 0 : 6), 'text-anchor': 'middle', class: 'ring-label' }, [label]));
  if (sub) svg.appendChild(el('text', { x: size / 2, y: size / 2 + 18, 'text-anchor': 'middle', class: 'ring-sub' }, [sub]));
  return svg;
}

/** Horizontal stacked bar for part-to-whole (e.g. $100 → 85 backing / 15 circle). */
export function splitBar(parts, { height = 14 } = {}) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  const wrap = document.createElement('div'); wrap.className = 'splitbar';
  const track = document.createElement('div'); track.className = 'splitbar-track'; track.style.height = `${height}px`;
  parts.forEach((p, i) => {
    const seg = document.createElement('span');
    seg.style.width = `${(p.value / total) * 100}%`;
    seg.style.background = p.color || `var(--series-${i + 1})`;
    seg.title = `${p.label}: ${p.display ?? p.value}`;
    track.appendChild(seg);
  });
  wrap.appendChild(track);
  const legend = document.createElement('div'); legend.className = 'legend';
  legend.innerHTML = parts.map((p, i) => `<span><i style="background:${p.color || `var(--series-${i + 1})`}"></i>${escapeHtml(p.label)} <b>${escapeHtml(p.display ?? p.value)}</b></span>`).join('');
  wrap.appendChild(legend);
  return wrap;
}

/** The WCAG-clean twin of a chart. */
export function tableFor(data, columnsDef) {
  const t = document.createElement('table'); t.className = 'data-table';
  t.innerHTML = `<thead><tr>${columnsDef.map(c => `<th>${escapeHtml(c.label)}</th>`).join('')}</tr></thead><tbody>${data.map(r => `<tr>${columnsDef.map(c => `<td class="${c.num ? 'num' : ''}">${escapeHtml(typeof c.value === 'function' ? c.value(r) : r[c.value])}</td>`).join('')}</tr>`).join('')}</tbody>`;
  return t;
}

function roundedTop(x, y, w, h, r) {
  if (h <= 0) return '';
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}
function compact(v) { return v >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : fmtInt(v); }
function attachTooltip(wrap, svg) {
  const tip = document.createElement('div'); tip.className = 'chart-tip'; tip.hidden = true; wrap.appendChild(tip);
  const show = (t, evt) => {
    tip.hidden = false;
    tip.innerHTML = `<b>${escapeHtml(t.dataset.value)}</b><span>${escapeHtml(t.dataset.label)}</span>`;
    const r = wrap.getBoundingClientRect();
    const tr = t.getBoundingClientRect();
    tip.style.left = `${tr.left - r.left + tr.width / 2}px`;
    tip.style.top = `${tr.top - r.top - 8}px`;
  };
  svg.addEventListener('pointerover', e => { const t = e.target.closest('.bar'); if (t) show(t, e); });
  svg.addEventListener('pointerout', e => { if (e.target.closest('.bar')) tip.hidden = true; });
  svg.addEventListener('focusin', e => { const t = e.target.closest('.bar'); if (t) show(t, e); });
  svg.addEventListener('focusout', () => { tip.hidden = true; });
}
