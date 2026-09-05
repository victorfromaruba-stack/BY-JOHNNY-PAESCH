// Deterministic contour art for stay and trip cards. Real hotel photography is not
// ours to publish, so each property gets its own bathymetric-contour strip drawn
// from a hash of its name — the same signature device as the member card, and
// honest about being an illustration.

const hash = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const rng = (seed) => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };

/**
 * Draws contour bands into a canvas. `tone` picks the palette:
 * 'sea' (Aruba), 'dusk' (world trips).
 */
export function drawContours(canvas, key, { tone = 'sea', width = 640, height = 214 } = {}) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = width * dpr; canvas.height = height * dpr;
  canvas.style.width = '100%'; canvas.style.height = '100%';
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  ctx.scale(dpr, dpr);
  const rand = rng(hash(key));
  const palettes = {
    sea: ['#0B2233', '#12405A', '#1B6B7E', '#2C9AA6', '#63C6C9'],
    dusk: ['#141326', '#2A2246', '#4A3556', '#7A4A50', '#B8734A'],
  };
  const ramp = palettes[tone] || palettes.sea;
  const g = ctx.createLinearGradient(0, 0, width, height);
  g.addColorStop(0, ramp[0]); g.addColorStop(1, ramp[2]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, width, height);
  const bands = 9;
  for (let b = 0; b < bands; b++) {
    const t = b / (bands - 1);
    const baseY = height * (0.18 + t * 0.86);
    const amp = 6 + rand() * 16;
    const freq = 0.006 + rand() * 0.012;
    const phase = rand() * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(0, height);
    for (let x = 0; x <= width; x += 4) {
      const y = baseY + Math.sin(x * freq + phase) * amp + Math.sin(x * freq * 2.3 + phase) * amp * 0.3;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(width, height); ctx.closePath();
    ctx.fillStyle = ramp[Math.min(ramp.length - 1, 1 + Math.floor(t * (ramp.length - 1)))];
    ctx.globalAlpha = 0.5 + t * 0.4; ctx.fill();
    ctx.globalAlpha = 0.5; ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 1; ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** The card's etched contour lines, as an inline SVG string. */
export function contourSvg(key, { stroke = 'currentColor', lines = 11, w = 340, h = 214 } = {}) {
  const rand = rng(hash(key));
  const paths = [];
  for (let i = 0; i < lines; i++) {
    const baseY = h * (i / lines) * 1.05 + 8;
    const amp = 4 + rand() * 12, freq = 0.012 + rand() * 0.014, phase = rand() * 6.28;
    let d = `M0 ${(baseY + Math.sin(phase) * amp).toFixed(1)}`;
    for (let x = 8; x <= w; x += 8) d += ` L${x} ${(baseY + Math.sin(x * freq + phase) * amp).toFixed(1)}`;
    paths.push(`<path d="${d}" fill="none" stroke="${stroke}" stroke-width="1" opacity=".5"/>`);
  }
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" width="100%" height="100%" aria-hidden="true">${paths.join('')}</svg>`;
}

/** The leaning-tree tier glyph: the wind-pruned trees of Aruba, leaning further at each tier. */
export function treeSvg(deg = 12, { size = 18, stroke = 'currentColor' } = {}) {
  return `<svg class="tree" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">
    <g stroke="${stroke}" stroke-width="1.5" stroke-linecap="round" fill="none" transform="rotate(${deg} 12 21)">
      <path d="M12 21V10"/><path d="M12 11.6c-2-1.7-4-2-5.7-1.4"/><path d="M12 11.6c2-1.7 4-2 5.7-1.4"/>
      <path d="M12 14.8c-1.8-1.5-3.5-1.8-4.9-1.3"/><path d="M12 14.8c1.8-1.5 3.5-1.8 4.9-1.3"/>
    </g></svg>`;
}

/** The four-pointed star used as the points glyph and the app mark. */
export function starSvg({ size = 22, fill = 'currentColor' } = {}) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path d="M12 1.5 14.4 9.6 22.5 12 14.4 14.4 12 22.5 9.6 14.4 1.5 12 9.6 9.6Z" fill="${fill}"/></svg>`;
}
