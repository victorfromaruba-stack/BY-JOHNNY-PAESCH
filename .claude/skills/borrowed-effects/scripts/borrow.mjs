#!/usr/bin/env node
// Read an Aceternity UI component out of its free public registry and say, in one page,
// whether it can become plain CSS in this app and what would have to change.
//
//   node borrow.mjs <slug> [<slug>...]        print the verdict and the source
//   node borrow.mjs --save <dir> <slug>...    also write the raw .tsx and the report to <dir>
//   node borrow.mjs --list                    probe the known slugs and print a table
//
// Why this exists. The Circle is vanilla ES modules with no build step, no React and no
// Tailwind, behind a CSP that only runs scripts from 'self' and jsdelivr. A .tsx file cannot
// run here at all, so "installing" a component is never the job — the job is lifting the CSS
// mechanism out of a React wrapper whose props are only ever className. Doing that by hand
// goes wrong in the same four ways every time: someone ports a paid component they have not
// bought, someone copies a Tailwind palette hex into a stylesheet whose colours all come from
// tokens.css, someone keeps a `md:` variant into a stylesheet that has no width breakpoints,
// and someone tries to rebuild in CSS an effect that actually reads the pointer. This script
// checks those four before a line is written.
//
// It reports on portability only. Portable is not the same as wanted: this library's register
// is glowing borders, aurora washes and spotlights, and The Edition is a printed bulletin. Read
// the house verdict in SKILL.md before believing a PORTABLE line means go ahead.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';

// Overridable only so the failure path can be exercised against a dead host without editing
// this file. Leave it unset in real use.
const REGISTRY = process.env.ACETERNITY_REGISTRY || 'https://ui.aceternity.com/registry';

// Slugs probed against the live registry on 2026-09-20. Every one of these returned 200 that
// day, so the list doubles as the set of names --list can report on and the set of near
// matches suggested when a slug is rejected. It is not the whole catalogue; a name that is not
// here may still exist. Keep it in the groups the porter thinks in, not alphabetical.
const KNOWN = {
  'backgrounds': [
    'spotlight', 'spotlight-new', 'aurora-background', 'background-beams',
    'background-beams-with-collision', 'background-boxes', 'background-gradient',
    'background-lines', 'meteors', 'vortex', 'wavy-background', 'shooting-stars',
    'sparkles', 'lamp', 'glowing-effect', 'hero-highlight', 'canvas-reveal-effect',
  ],
  'text': [
    'text-generate-effect', 'text-hover-effect', 'text-reveal-card', 'colourful-text',
    'container-text-flip', 'flip-words', 'typewriter-effect', 'pointer-highlight',
  ],
  'scroll': [
    'hero-parallax', 'parallax-scroll', 'tracing-beam', 'sticky-scroll-reveal',
    'container-scroll-animation', 'timeline',
  ],
  'cards': [
    'card-spotlight', 'card-hover-effect', 'evervault-card', 'glare-card', 'wobble-card',
    'focus-cards', 'direction-aware-hover', 'animated-tooltip', 'lens', 'compare',
    'svg-mask-effect',
  ],
  'buttons and borders': [
    'moving-border', 'hover-border-gradient', 'tailwindcss-buttons', 'stateful-button',
  ],
  'carousels and lists': [
    'infinite-moving-cards', 'animated-testimonials', 'apple-cards-carousel', 'carousel',
  ],
  'inputs and chrome': [
    'placeholders-and-vanish-input', 'file-upload', 'multi-step-loader', 'loader',
    'animated-modal', 'floating-dock', 'sidebar', 'navbar-menu', 'resizable-navbar',
    'following-pointer', 'link-preview',
  ],
};
const ALL_KNOWN = Object.values(KNOWN).flat();

// What references/catalog.md already decided, keyed by slug and grouped by the reason, because
// the reason is the reusable part. This is printed ABOVE the mechanism verdict on purpose: for
// any slug in here the decision is already taken, and a "PORTABLE AS CSS ALONE" line read
// without it points the opposite way. Keep this in step with catalog.md — the file is the
// record, this table is a pointer to it.
const HOUSE = [
  ['FITS', 'it replaces an absence rather than dressing up something plain — port it',
    ['stateful-button', 'text-generate-effect']],
  ['ONLY IF ASKED', 'mechanically sound and palette-neutral once ported, but it solves a problem this app has not had — do not volunteer it',
    ['infinite-moving-cards', 'loader', 'pointer-highlight', 'flip-words', 'typewriter-effect',
      'card-stack', 'compare', 'images-slider', 'parallax-scroll', 'animated-modal',
      'placeholders-and-vanish-input', 'multi-step-loader', 'container-text-flip', 'carousel']],
  ['WRONG FOR THIS APP', 'glow, gradient border or neon — the exact register Victor calls AI slop, and every one needs a colour tokens.css does not have',
    ['background-gradient', 'hover-border-gradient', 'moving-border', 'glowing-effect',
      'card-spotlight', 'spotlight', 'spotlight-new', 'lamp', 'hero-highlight', 'colourful-text',
      'tracing-beam', 'timeline', 'glare-card', 'tailwindcss-buttons']],
  ['WRONG FOR THIS APP', 'an aurora or particle field, which argues with the one photograph each screen leads on — and meteors additionally loops forever',
    ['aurora-background', 'background-beams', 'background-beams-with-collision', 'background-lines',
      'background-boxes', 'meteors', 'shooting-stars', 'vortex', 'wavy-background', 'sparkles',
      'canvas-reveal-effect']],
  ['WRONG FOR THIS APP', 'the whole effect is on :hover or mousemove. It may live above the breakpoint, inside @media (min-width: 900px) and (min-height: 600px) and (hover: hover) — both conditions, never one — but only if the phone loses nothing by its absence: on a phone it does not degrade, it does nothing',
    ['3d-card', '3d-pin', 'direction-aware-hover', 'wobble-card', 'following-pointer',
      'animated-tooltip', 'text-hover-effect', 'text-reveal-card', 'svg-mask-effect',
      'card-hover-effect', 'floating-dock', 'evervault-card', 'focus-cards', 'file-upload',
      'lens', 'sidebar', 'navbar-menu', 'link-preview']],
  ['WRONG FOR THIS APP', 'it prints over a photograph or asserts something the app has not established',
    ['sticky-scroll-reveal', 'animated-testimonials']],
  ['WRONG FOR THIS APP', 'a landing-page set piece, built to fill a viewport above the fold for a stranger',
    ['hero-parallax', 'container-scroll-animation', 'layout-grid', 'google-gemini-effect',
      'apple-cards-carousel', 'resizable-navbar']],
];

function houseVerdict(slug) {
  for (const [ruling, why, slugs] of HOUSE) if (slugs.includes(slug)) return { ruling, why };
  return null;
}

// ---------------------------------------------------------------------------- fetching

// The registry answers 200 for anything free, and 401 for BOTH a paid component and a slug
// that does not exist — checked on 2026-09-20 with 3d-card-effect (real, paid) and
// totally-bogus-slug-xyz (not a component): identical 401 and identical body. So a 401 can
// never be read as proof that Victor has to buy something; it is "not yours, or not a thing",
// and the near-match list below is how you tell the two apart.
async function fetchRegistry(slug) {
  const url = `${REGISTRY}/${slug}.json`;
  let res;
  try {
    // A plain Accept header and nothing else. No spoofed user-agent: this is a public endpoint
    // being used as published, and pretending to be a browser would be the first step of doing
    // something the licence does not allow. Proxying is left to the runtime (Node honours
    // HTTPS_PROXY when started with --use-env-proxy or NODE_USE_ENV_PROXY=1); TLS verification
    // is never touched.
    res = await fetch(url, { headers: { accept: 'application/json' }, redirect: 'follow' });
  } catch (err) {
    const cause = err?.cause?.message ? `${err.message} (${err.cause.message})` : err.message;
    throw new Error(`could not reach ${url}\n  ${cause}`);
  }
  const text = await res.text().catch(() => '');
  let json = null;
  if (res.status === 200) {
    try { json = JSON.parse(text); }
    catch { throw new Error(`${url} answered 200 but the body is not JSON:\n  ${text.slice(0, 300)}`); }
  }
  return { url, status: res.status, body: text, json };
}

// Cheap edit distance, used only to suggest near matches on a rejected slug.
function distance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

function nearMatches(slug, n = 6) {
  return ALL_KNOWN
    .map(k => ({ k, d: k.includes(slug) || slug.includes(k) ? 0 : distance(slug, k) }))
    .sort((a, b) => a.d - b.d)
    .filter(x => x.d <= Math.max(4, Math.round(slug.length / 2)))
    .slice(0, n)
    .map(x => x.k);
}

// ---------------------------------------------------------------------------- source scanning

// Pull out the string literals that hold class names. Not a parser: it finds the regions where
// classes are written — a className attribute, or a cn()/clsx()/twMerge() call — and then reads
// the quoted and backticked strings inside them. Template substitutions are blanked, because
// `${isActive ? "a" : "b"}` contributes its own literals anyway.
function classRegions(src) {
  const regions = [];
  const push = (s) => { if (s) regions.push(s); };

  const readLiteral = (i) => {          // i points at a quote character
    const q = src[i];
    let j = i + 1, out = '';
    while (j < src.length) {
      const c = src[j];
      if (c === '\\') { j += 2; continue; }
      if (c === q) return { text: out, end: j + 1 };
      out += c; j++;
    }
    return { text: out, end: j };
  };
  const readBalanced = (i, open, close) => {   // i points at the opening bracket
    let depth = 0, j = i;
    while (j < src.length) {
      const c = src[j];
      if (c === '"' || c === "'" || c === '`') { j = readLiteral(j).end; continue; }
      if (c === open) depth++;
      else if (c === close) { depth--; if (depth === 0) return { text: src.slice(i + 1, j), end: j + 1 }; }
      j++;
    }
    return { text: src.slice(i + 1), end: src.length };
  };
  const literalsIn = (chunk) => {
    const out = [];
    for (let j = 0; j < chunk.length; j++) {
      const c = chunk[j];
      if (c === '"' || c === "'" || c === '`') {
        const q = c; let k = j + 1, s = '';
        while (k < chunk.length) {
          if (chunk[k] === '\\') { k += 2; continue; }
          if (chunk[k] === q) break;
          s += chunk[k]; k++;
        }
        out.push(s.replace(/\$\{[^}]*\}/g, ' '));
        j = k;
      }
    }
    return out;
  };

  for (const m of src.matchAll(/className\s*=\s*/g)) {
    const i = m.index + m[0].length;
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') push(readLiteral(i).text.replace(/\$\{[^}]*\}/g, ' '));
    else if (c === '{') literalsIn(readBalanced(i, '{', '}').text).forEach(push);
  }
  for (const m of src.matchAll(/\b(?:cn|clsx|twMerge|cva)\s*\(/g)) {
    const i = m.index + m[0].length - 1;
    literalsIn(readBalanced(i, '(', ')').text).forEach(push);
  }
  return regions;
}

function classTokens(src) {
  const seen = new Map();   // class -> count
  for (const region of classRegions(src)) {
    // Split on whitespace, but not inside [] — an arbitrary value may contain a space as _
    // already, yet some sources do write `[mask-image:linear-gradient(black, white)]`.
    let depth = 0, cur = '';
    const flush = () => { if (cur) { seen.set(cur, (seen.get(cur) || 0) + 1); cur = ''; } };
    for (const ch of region) {
      if (ch === '[' || ch === '(') depth++;
      if (ch === ']' || ch === ')') depth--;
      if (/\s/.test(ch) && depth <= 0) { flush(); depth = 0; continue; }
      cur += ch;
    }
    flush();
  }
  const out = new Map();
  for (const [cls, n] of seen) {
    if (!/[a-z]/i.test(cls)) continue;
    if (/[<>=;{}]/.test(cls)) continue;
    if (cls.length > 120) continue;
    out.set(cls, n);
  }
  return out;
}

// Split `dark:group-hover/spotlight:opacity-100` into its variants and its base class.
function splitVariants(cls) {
  const variants = [];
  let depth = 0, cur = '', base = cls;
  for (let i = 0; i < cls.length; i++) {
    const c = cls[i];
    if (c === '[' || c === '(') depth++;
    if (c === ']' || c === ')') depth--;
    if (c === ':' && depth === 0) { variants.push(cur); cur = ''; base = cls.slice(i + 1); continue; }
    cur += c;
  }
  return { variants, base };
}

// ---------------------------------------------------------------------------- tailwind -> css

const SPACE = (n) => {
  if (n === 'px') return '1px';
  if (n === 'full') return '100%';
  if (n === 'screen') return '100vw';
  if (/^\d+\/\d+$/.test(n)) { const [a, b] = n.split('/').map(Number); return `${+(a / b * 100).toFixed(4)}%`; }
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return v === 0 ? '0' : `${v / 4}rem`;
};

const FIXED = {
  absolute: 'position: absolute', relative: 'position: relative', fixed: 'position: fixed',
  sticky: 'position: sticky', static: 'position: static',
  'inset-0': 'inset: 0', '-inset-px': 'inset: -1px', 'inset-px': 'inset: 1px',
  flex: 'display: flex', 'inline-flex': 'display: inline-flex', grid: 'display: grid',
  block: 'display: block', 'inline-block': 'display: inline-block', hidden: 'display: none',
  'flex-col': 'flex-direction: column', 'flex-row': 'flex-direction: row',
  'flex-wrap': 'flex-wrap: wrap', 'flex-1': 'flex: 1 1 0%',
  'shrink-0': 'flex-shrink: 0', 'flex-shrink-0': 'flex-shrink: 0',
  'items-center': 'align-items: center', 'items-start': 'align-items: flex-start',
  'items-end': 'align-items: flex-end', 'justify-center': 'justify-content: center',
  'justify-between': 'justify-content: space-between', 'justify-start': 'justify-content: flex-start',
  'justify-end': 'justify-content: flex-end', 'place-items-center': 'place-items: center',
  'overflow-hidden': 'overflow: hidden', 'overflow-visible': 'overflow: visible',
  'overflow-x-hidden': 'overflow-x: hidden', 'overflow-y-auto': 'overflow-y: auto',
  'pointer-events-none': 'pointer-events: none', 'pointer-events-auto': 'pointer-events: auto',
  'select-none': 'user-select: none', 'cursor-pointer': 'cursor: pointer',
  'w-full': 'width: 100%', 'h-full': 'height: 100%', 'w-screen': 'width: 100vw',
  'h-screen': 'height: 100vh', 'min-h-screen': 'min-height: 100vh', 'w-fit': 'width: fit-content',
  'aspect-square': 'aspect-ratio: 1 / 1', 'aspect-video': 'aspect-ratio: 16 / 9',
  'object-cover': 'object-fit: cover', 'object-contain': 'object-fit: contain',
  'whitespace-nowrap': 'white-space: nowrap', 'whitespace-pre-wrap': 'white-space: pre-wrap',
  'break-words': 'overflow-wrap: break-word',
  'rounded-none': 'border-radius: 0', 'rounded-sm': 'border-radius: 2px',
  rounded: 'border-radius: 4px', 'rounded-md': 'border-radius: 6px',
  'rounded-lg': 'border-radius: 8px', 'rounded-xl': 'border-radius: 12px',
  'rounded-2xl': 'border-radius: 16px', 'rounded-3xl': 'border-radius: 24px',
  'rounded-full': 'border-radius: 9999px',
  border: 'border-width: 1px', 'border-0': 'border-width: 0', 'border-2': 'border-width: 2px',
  'border-4': 'border-width: 4px', 'border-t': 'border-top-width: 1px',
  'border-b': 'border-bottom-width: 1px', 'border-l': 'border-left-width: 1px',
  'border-r': 'border-right-width: 1px',
  'blur-none': 'filter: blur(0)', 'blur-sm': 'filter: blur(4px)', blur: 'filter: blur(8px)',
  'blur-md': 'filter: blur(12px)', 'blur-lg': 'filter: blur(16px)', 'blur-xl': 'filter: blur(24px)',
  'blur-2xl': 'filter: blur(40px)', 'blur-3xl': 'filter: blur(64px)',
  'backdrop-blur-sm': 'backdrop-filter: blur(4px)', 'backdrop-blur': 'backdrop-filter: blur(8px)',
  'backdrop-blur-md': 'backdrop-filter: blur(12px)', 'backdrop-blur-lg': 'backdrop-filter: blur(16px)',
  'backdrop-blur-xl': 'backdrop-filter: blur(24px)',
  'mix-blend-normal': 'mix-blend-mode: normal', 'mix-blend-multiply': 'mix-blend-mode: multiply',
  'mix-blend-screen': 'mix-blend-mode: screen', 'mix-blend-overlay': 'mix-blend-mode: overlay',
  'mix-blend-darken': 'mix-blend-mode: darken', 'mix-blend-lighten': 'mix-blend-mode: lighten',
  'mix-blend-difference': 'mix-blend-mode: difference', 'mix-blend-plus-lighter': 'mix-blend-mode: plus-lighter',
  'bg-blend-multiply': 'background-blend-mode: multiply', 'bg-blend-screen': 'background-blend-mode: screen',
  'bg-cover': 'background-size: cover', 'bg-center': 'background-position: center',
  'bg-no-repeat': 'background-repeat: no-repeat', 'bg-clip-text': 'background-clip: text',
  'bg-transparent': 'background-color: transparent',
  transition: 'transition-property: color, background-color, border-color, opacity, box-shadow, transform, filter, backdrop-filter; transition-duration: 150ms',
  'transition-all': 'transition-property: all; transition-duration: 150ms',
  'transition-opacity': 'transition-property: opacity; transition-duration: 150ms',
  'transition-transform': 'transition-property: transform; transition-duration: 150ms',
  'transition-colors': 'transition-property: color, background-color, border-color; transition-duration: 150ms',
  'ease-linear': 'transition-timing-function: linear',
  'ease-in': 'transition-timing-function: cubic-bezier(.4, 0, 1, 1)',
  'ease-out': 'transition-timing-function: cubic-bezier(0, 0, .2, 1)',
  'ease-in-out': 'transition-timing-function: cubic-bezier(.4, 0, .2, 1)',
  'animate-none': 'animation: none',
  'animate-spin': 'animation: spin 1s linear infinite  (@keyframes spin { to { transform: rotate(360deg) } })',
  'animate-ping': 'animation: ping 1s cubic-bezier(0, 0, .2, 1) infinite',
  'animate-pulse': 'animation: pulse 2s cubic-bezier(.4, 0, .6, 1) infinite',
  'animate-bounce': 'animation: bounce 1s infinite',
  'transform-gpu': 'transform: translateZ(0)  (a hint, not an effect)',
  'will-change-transform': 'will-change: transform',
  'transform-style-preserve-3d': 'transform-style: preserve-3d',
  'backface-hidden': 'backface-visibility: hidden',
  'origin-center': 'transform-origin: center', 'origin-top': 'transform-origin: top',
  'origin-left': 'transform-origin: left',
  'shadow-none': 'box-shadow: none',
  invert: 'filter: invert(100%)', 'invert-0': 'filter: invert(0)',
  grayscale: 'filter: grayscale(100%)', 'grayscale-0': 'filter: grayscale(0)',
  sepia: 'filter: sepia(100%)', 'filter-none': 'filter: none',
  filter: 'Tailwind v3 plumbing that turns the filter utilities on — no CSS of its own',
  'transform': 'Tailwind v3 plumbing that turns the transform utilities on — no CSS of its own',
  'antialiased': '-webkit-font-smoothing: antialiased',
  'italic': 'font-style: italic', 'uppercase': 'text-transform: uppercase',
  'text-center': 'text-align: center', 'text-left': 'text-align: left',
  'truncate': 'overflow: hidden; text-overflow: ellipsis; white-space: nowrap',
  'sr-only': 'the visually-hidden recipe',
  'leading-none': 'line-height: 1', 'leading-tight': 'line-height: 1.25',
  'leading-snug': 'line-height: 1.375', 'leading-normal': 'line-height: 1.5',
  'leading-relaxed': 'line-height: 1.625', 'leading-loose': 'line-height: 2',
  'tracking-tighter': 'letter-spacing: -.05em', 'tracking-tight': 'letter-spacing: -.025em',
  'tracking-normal': 'letter-spacing: 0', 'tracking-wide': 'letter-spacing: .025em',
  'tracking-wider': 'letter-spacing: .05em', 'tracking-widest': 'letter-spacing: .1em',
};

const FONT_SIZE = {
  'text-xs': '.75rem', 'text-sm': '.875rem', 'text-base': '1rem', 'text-lg': '1.125rem',
  'text-xl': '1.25rem', 'text-2xl': '1.5rem', 'text-3xl': '1.875rem', 'text-4xl': '2.25rem',
  'text-5xl': '3rem', 'text-6xl': '3.75rem', 'text-7xl': '4.5rem', 'text-8xl': '6rem',
  'text-9xl': '8rem',
};
const FONT_WEIGHT = {
  'font-thin': 100, 'font-light': 300, 'font-normal': 400, 'font-medium': 500,
  'font-semibold': 600, 'font-bold': 700, 'font-extrabold': 800, 'font-black': 900,
};
const GRADIENT_DIR = {
  t: 'to top', tr: 'to top right', r: 'to right', br: 'to bottom right',
  b: 'to bottom', bl: 'to bottom left', l: 'to left', tl: 'to top left',
};
// Arbitrary-value prefixes whose CSS property is unambiguous: `h-[169%]` is height: 169%.
const ARB_PROP = {
  w: 'width', h: 'height', size: 'width / height', 'min-w': 'min-width', 'min-h': 'min-height',
  'max-w': 'max-width', 'max-h': 'max-height', top: 'top', bottom: 'bottom', left: 'left',
  right: 'right', inset: 'inset', z: 'z-index', p: 'padding', px: 'padding-inline',
  py: 'padding-block', pt: 'padding-top', pb: 'padding-bottom', pl: 'padding-left',
  pr: 'padding-right', m: 'margin', mx: 'margin-inline', my: 'margin-block', mt: 'margin-top',
  mb: 'margin-bottom', gap: 'gap', rounded: 'border-radius', opacity: 'opacity',
  blur: 'filter: blur()', 'backdrop-blur': 'backdrop-filter: blur()', bg: 'background',
  'bg-size': 'background-size', 'bg-position': 'background-position', text: 'font-size or color',
  'leading-': 'line-height', tracking: 'letter-spacing', scale: 'transform: scale()',
  rotate: 'transform: rotate()', 'translate-x': 'transform: translateX()',
  'translate-y': 'transform: translateY()', perspective: 'perspective',
  duration: 'transition-duration', delay: 'transition-delay', border: 'border-width',
  shadow: 'box-shadow', 'mask-image': 'mask-image', filter: 'filter', animation: 'animation',
  content: 'content', grid: 'grid', 'grid-cols': 'grid-template-columns', aspect: 'aspect-ratio',
  'transform-origin': 'transform-origin', brightness: 'filter: brightness()',
  contrast: 'filter: contrast()', saturate: 'filter: saturate()',
};

// Turn one class into its CSS, or return null for "check tailwindcss.com".
function toCss(cls) {
  let c = cls.replace(/^!/, '');
  const neg = c.startsWith('-');
  if (neg) c = c.slice(1);
  const sign = neg ? '-' : '';

  if (FIXED[cls]) return FIXED[cls];
  if (FIXED[c]) return (neg ? 'negated: ' : '') + FIXED[c];
  if (FONT_SIZE[c]) return `font-size: ${FONT_SIZE[c]}`;
  if (FONT_WEIGHT[c]) return `font-weight: ${FONT_WEIGHT[c]}`;

  // `[property:value]` — an arbitrary declaration, including `[--aurora:...]`
  let m = c.match(/^\[([^:]+):(.+)\]$/);
  if (m) return `${m[1]}: ${m[2].replace(/_/g, ' ')}`;

  // `prefix-[value]`
  m = c.match(/^([a-z-]+?)-\[(.+)\]$/);
  if (m) {
    const [, pre, raw] = m;
    const val = raw.replace(/_/g, ' ');
    const prop = ARB_PROP[pre];
    if (prop === 'filter: blur()') return `filter: blur(${val})`;
    if (prop === 'backdrop-filter: blur()') return `backdrop-filter: blur(${val})`;
    if (prop === 'transform: scale()') return `transform: scale(${val})`;
    if (prop === 'transform: rotate()') return `transform: rotate(${val})`;
    if (prop === 'transform: translateX()') return `transform: translateX(${sign}${val})`;
    if (prop === 'transform: translateY()') return `transform: translateY(${sign}${val})`;
    if (prop === 'filter: brightness()') return `filter: brightness(${val})`;
    if (prop === 'filter: contrast()') return `filter: contrast(${val})`;
    if (prop === 'filter: saturate()') return `filter: saturate(${val})`;
    if (prop === 'transition-duration') return `transition-duration: ${/^\d+$/.test(val) ? val + 'ms' : val}`;
    if (prop === 'transition-delay') return `transition-delay: ${/^\d+$/.test(val) ? val + 'ms' : val}`;
    if (prop === 'font-size or color') return /^#|rgb|hsl|var\(/.test(val) ? `color: ${val}` : `font-size: ${val}`;
    if (prop) return `${prop}: ${sign}${val}`;
    if (/^(from|via|to)$/.test(pre)) {
      return /%$/.test(val)
        ? `a gradient stop POSITION (${pre} ${val}), not a colour`
        : `a gradient stop colour (${pre}) — pick the token, do not copy the value`;
    }
    return null;
  }

  // opacity / z / scale / rotate / translate on the numeric scales
  m = c.match(/^opacity-(\d+)$/); if (m) return `opacity: ${Number(m[1]) / 100}`;
  m = c.match(/^z-(\d+)$/); if (m) return `z-index: ${sign}${m[1]}`;
  m = c.match(/^scale-(\d+)$/); if (m) return `transform: scale(${Number(m[1]) / 100})`;
  m = c.match(/^scale-([xy])-(\d+)$/); if (m) return `transform: scale${m[1].toUpperCase()}(${Number(m[2]) / 100})`;
  m = c.match(/^rotate-(\d+)$/); if (m) return `transform: rotate(${sign}${m[1]}deg)`;
  m = c.match(/^translate-([xy])-(.+)$/);
  if (m) { const v = SPACE(m[2]); if (v) return `transform: translate${m[1].toUpperCase()}(${sign}${v})`; }
  m = c.match(/^duration-(\d+)$/); if (m) return `transition-duration: ${m[1]}ms`;
  m = c.match(/^delay-(\d+)$/); if (m) return `transition-delay: ${m[1]}ms`;
  m = c.match(/^(w|h|min-w|min-h|max-w|max-h|top|bottom|left|right|inset|p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|size)-(.+)$/);
  if (m) {
    const v = SPACE(m[2]);
    if (v) {
      const prop = { w: 'width', h: 'height', p: 'padding', px: 'padding-inline', py: 'padding-block',
        pt: 'padding-top', pb: 'padding-bottom', pl: 'padding-left', pr: 'padding-right',
        m: 'margin', mx: 'margin-inline', my: 'margin-block', mt: 'margin-top', mb: 'margin-bottom',
        ml: 'margin-left', mr: 'margin-right', 'gap-x': 'column-gap', 'gap-y': 'row-gap',
        size: 'width and height' }[m[1]] || m[1];
      return `${prop}: ${sign}${v}`;
    }
  }
  m = c.match(/^bg-gradient-to-(t|tr|r|br|b|bl|l|tl)$/);
  if (m) return `background-image: linear-gradient(${GRADIENT_DIR[m[1]]}, <from>, <via>, <to>)`;
  m = c.match(/^bg-linear-to-(t|tr|r|br|b|bl|l|tl)$/);
  if (m) return `background-image: linear-gradient(${GRADIENT_DIR[m[1]]}, <from>, <via>, <to>)`;
  m = c.match(/^(from|via|to)-(.+)$/);
  if (m) return `a linear-gradient colour stop (${m[1]}) — pick the token, do not copy the value`;
  m = c.match(/^animate-(.+)$/);
  if (m) return `animation: ${m[1]} — NOT DEFINED IN THIS FILE, see the keyframes note below`;

  // A colour utility. Say which property it sets and that the value is not ours to copy —
  // every colour in this app comes from tokens.css.
  m = c.match(new RegExp(`^(${COLOUR_UTIL})-((?:${PALETTE})-(?:50|\\d{3})|white|black|transparent|current)$`));
  if (m) {
    const prop = { text: 'color', bg: 'background-color', border: 'border-color', ring: 'outline-color',
      fill: 'fill', stroke: 'stroke', divide: 'border-color', placeholder: 'color', accent: 'accent-color',
      caret: 'caret-color', decoration: 'text-decoration-color', outline: 'outline-color',
      shadow: 'box-shadow colour' }[m[1]] || m[1];
    return `${prop}: a Tailwind palette value — must be replaced by a token`;
  }
  m = c.match(/^group(?:\/[a-zA-Z0-9-]+)?$/);
  if (m) return 'no CSS of its own — it marks the ancestor that group-hover: rules look up to';
  m = c.match(/^peer(?:\/[a-zA-Z0-9-]+)?$/);
  if (m) return 'no CSS of its own — it marks the sibling that peer-* rules look at';
  m = c.match(/^(from|via|to)-\[(\d+%)\]$/);
  if (m) return `a gradient stop POSITION (${m[1]} ${m[2]}), not a colour`;
  return null;
}

const GROUPS = [
  ['the effect', /^(transform|filter|backdrop-filter|mix-blend-mode|background-blend-mode|animation|opacity|mask-image|background-image|box-shadow|will-change|transform-style|backface-visibility|perspective|transition|--)/],
  ['geometry and size', /^(position|inset|top|bottom|left|right|z-index|width|height|min-|max-|aspect-ratio)/],
  ['box, layout and spacing', /^(display|flex|align|justify|place|gap|column-gap|row-gap|padding|margin|border|overflow|object-fit|grid)/],
  ['type', /^(font|letter-spacing|line-height|text-|white-space|color|-webkit-font-smoothing|overflow-wrap)/],
];
function groupOf(css) {
  if (!css) return 'unmapped';
  for (const [name, re] of GROUPS) if (re.test(css)) return name;
  return 'everything else';
}

// ---------------------------------------------------------------------------- colours

const PALETTE = 'slate|gray|grey|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const COLOUR_UTIL = 'text|bg|border|from|via|to|ring|shadow|fill|stroke|decoration|outline|divide|accent|caret|placeholder';

function findColours(src) {
  const hits = new Map();
  const add = (k) => hits.set(k, (hits.get(k) || 0) + 1);
  for (const m of src.matchAll(/#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g)) add(m[0]);
  for (const m of src.matchAll(/\b(?:rgba?|hsla?|oklch|oklab)\([^)]*\)/g)) add(m[0].replace(/\s+/g, ' '));
  for (const m of src.matchAll(new RegExp(`\\b(?:${COLOUR_UTIL})-(?:${PALETTE})-(?:50|\\d{3})\\b`, 'g'))) add(m[0]);
  for (const m of src.matchAll(new RegExp(`\\b(?:${COLOUR_UTIL})-(?:white|black)\\b`, 'g'))) add(m[0]);
  // A bare "white" or "black" string literal is a colour too — it is how a default fill is
  // usually written (fill={fill || "white"}), and it is the one people forget to tokenise.
  for (const m of src.matchAll(/["'`](white|black|currentColor|transparent)["'`]/g)) add(`"${m[1]}"`);
  return hits;
}

// ---------------------------------------------------------------------------- other scans

function findKeyframes(src) {
  const out = [];
  const re = /@keyframes\s+([A-Za-z0-9_-]+)\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    let depth = 1, i = re.lastIndex;
    while (i < src.length && depth > 0) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
      i++;
    }
    out.push(src.slice(m.index, i));
  }
  return out;
}

function findCustomProps(src) {
  const props = new Map();
  for (const m of src.matchAll(/["'`]?(--[a-zA-Z0-9-]+)["'`]?\s*:\s*([^,;\n}]+)/g)) {
    props.set(m[1], (props.get(m[1]) ? props.get(m[1]) + ' | ' : '') + m[2].trim().replace(/_/g, ' ').slice(0, 160));
  }
  for (const m of src.matchAll(/\[(--[a-zA-Z0-9-]+):([^\]]+)\]/g)) {
    props.set(m[1], m[2].replace(/_/g, ' ').slice(0, 160));
  }
  // Properties written from JS, which the object-literal scan above cannot see.
  for (const m of src.matchAll(/setProperty\(\s*["'`](--[a-zA-Z0-9-]+)["'`]\s*,\s*([^)]*)\)/g)) {
    const prev = props.get(m[1]);
    const val = `${m[2].trim().slice(0, 100)}  (set from JS)`;
    props.set(m[1], prev ? `${prev} | ${val}` : val);
  }
  return props;
}

function findSvgs(src) {
  const out = [];
  let i = 0;
  while ((i = src.indexOf('<svg', i)) !== -1) {
    const end = src.indexOf('</svg>', i);
    if (end === -1) break;
    out.push(src.slice(i, end + 6));
    i = end + 6;
  }
  return out;
}

// The part that decides between a stylesheet and a real module: does the component read
// something the browser only knows at runtime?
const SIGNALS = [
  [/onMouseMove|mousemove/, 'reads the pointer while it moves (onMouseMove) — CSS cannot see the cursor position'],
  [/clientX|clientY|pageX|pageY/, 'uses the raw pointer coordinates'],
  [/getBoundingClientRect/, 'measures the element on screen'],
  [/ResizeObserver/, 'watches its own size (ResizeObserver)'],
  [/IntersectionObserver|useInView/, 'reacts to entering the viewport — in vanilla that is an IntersectionObserver'],
  [/useScroll|scrollYProgress|addEventListener\(\s*["']scroll|onScroll/, 'ties the effect to scroll position'],
  [/scrollLeft|scrollBy|scrollTo\(|scrollWidth|scrollIntoView/, 'drives or measures a scroll container itself'],
  [/setInterval|setTimeout/, 'steps through a sequence on a timer (a fixed sequence is @keyframes; one that depends on data is not)'],
  [/useMotionValue|useMotionTemplate|useSpring|useTransform/, 'drives a CSS value from a live number (Framer motion value)'],
  [/requestAnimationFrame/, 'runs its own animation loop'],
  [/getContext\(|<canvas|WebGL|THREE\.|@react-three/, 'draws on a canvas or in WebGL — there is no CSS equivalent at all'],
  [/\.split\(\s*["'`]\s+?["'`]\s*\)|\.split\(\s*["'`]["'`]\s*\)/, 'splits text into per-word or per-letter spans — the wrapping needs JS, the animation does not'],
  [/useEffect|useState|useRef/, 'holds React state (only a hint: often just hover or mounted)'],
  [/cloneNode|appendChild|insertAdjacent/, 'duplicates its own DOM at runtime — a seamless loop usually needs a second copy of the children, and CSS cannot make one'],
  // JSX multiplies DOM declaratively, so the two lines below are the same failure as cloneNode
  // wearing different clothes. meteors is the case that taught this: it maps over an array of
  // twenty and gives each span a random delay, duration and offset, and nothing about that
  // reads the pointer or the scroll — so without these two the report says "nothing read at
  // runtime" and a porter starts writing pure CSS for something CSS cannot express.
  [/Math\.random/, 'uses runtime randomness — CSS has no random(), so the scatter must become a fixed value per element (an :nth-child table, or a module that assigns one)'],
  [/new Array\(|Array\.from\(\s*\{\s*length/, 'mints N elements from a count — CSS cannot create elements, so a module or hand-written markup has to emit them'],
  [/style\.setProperty|setProperty\(\s*["'`]--/, 'writes a CSS custom property from JS — that is exactly the seam a vanilla module plugs into'],
  [/localStorage|sessionStorage/, 'stores something in the browser'],
];

// ---------------------------------------------------------------------------- report

const RULE = '='.repeat(78);
const THIN = '-'.repeat(78);
const bytes = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(1)} KB`;

// Deps that are packaging rather than mechanism. An icon set is chrome the app already has its
// own answer for, and mini-svg-data-uri only inlines an SVG at build time — the SVG itself is in
// the source and ports unchanged. Neither one should be allowed to condemn a component, which is
// why they are pulled out of the verdict.
const INCIDENTAL = /^(@tabler\/icons-react|lucide-react|react-icons|mini-svg-data-uri|clsx|tailwind-merge|class-variance-authority)$/;
const MOTION = /^(motion|framer-motion)$/;

function classifyDep(dep) {
  if (MOTION.test(dep)) {
    return `${dep} — the animation must be rebuilt as CSS keyframes or the Web Animations API`;
  }
  if (/icons|react-icons/.test(dep)) {
    return `${dep} — an icon set, not the effect; this app draws its own marks, so drop it`;
  }
  if (dep === 'mini-svg-data-uri') {
    return `${dep} — a build-time helper that inlines an SVG into a background-image; the SVG is in the source, so encode it once by hand and drop the dep`;
  }
  if (/^@?react|^next|^clsx|^tailwind-merge|^class-variance/.test(dep)) {
    return `${dep} — React plumbing, irrelevant once the effect is CSS`;
  }
  return `${dep} — needs ${dep}, almost certainly not worth porting`;
}

function analyse(slug, res) {
  const j = res.json;
  const files = (j.files || []).map(f => ({ path: f.path || f.target || '(unnamed)', content: f.content || '' }));
  const src = files.map(f => f.content).join('\n');
  const deps = Array.isArray(j.dependencies) ? j.dependencies : [];
  const regDeps = Array.isArray(j.registryDependencies) ? j.registryDependencies : [];
  const classes = classTokens(src);
  const colours = findColours(src);
  const keyframes = findKeyframes(src);
  const customProps = findCustomProps(src);
  const svgs = findSvgs(src);

  // A registry entry often ships more than one file: the component asked for, plus the
  // siblings it imports. Judging the whole blob together gets the verdict wrong — card-spotlight
  // bundles canvas-reveal-effect, and reading them as one made a pointer-driven gradient look
  // like a WebGL component. So signals are per file, and the verdict is about the PRIMARY file:
  // the one whose name matches the slug. The extra files are reported, not judged.
  const isPrimary = (f) => basename(f.path).replace(/\.[jt]sx?$/, '') === slug;
  const primary = files.find(isPrimary) || files[0] || { path: '(none)', content: '' };
  const extras = files.filter(f => f !== primary);
  const signalsFor = (text) => SIGNALS.filter(([re]) => re.test(text)).map(([, why]) => why);
  const signals = signalsFor(primary.content);
  const extraSignals = extras.map(f => ({ path: f.path, signals: signalsFor(f.content) }));

  const CANVAS = /getContext\(|<canvas|WebGL|THREE\.|@react-three/;
  const RUNTIME = /onMouseMove|mousemove|clientX|getBoundingClientRect|ResizeObserver|IntersectionObserver|useInView|useScroll|scrollYProgress|onScroll|scrollLeft|scrollBy|scrollTo\(|scrollWidth|useMotionValue|requestAnimationFrame|cloneNode|appendChild|style\.setProperty|\.split\(|Math\.random|new Array\(|Array\.from\(\s*\{\s*length/;
  const hardDeps = deps.filter(d => !MOTION.test(d) && !INCIDENTAL.test(d));
  const needsCanvas = CANVAS.test(primary.content);
  const needsRuntime = RUNTIME.test(primary.content);

  let verdict, why;
  if (hardDeps.length) {
    verdict = 'NOT WORTH PORTING';
    why = `it is built on ${hardDeps.join(', ')}; the effect is that library, not CSS you can lift out`;
  } else if (needsCanvas) {
    verdict = 'NOT WORTH PORTING';
    why = 'it paints on a canvas or in WebGL, so there is no CSS underneath to take';
  } else if (needsRuntime) {
    verdict = 'NEEDS A SMALL JS MODULE';
    why = 'it does something CSS cannot do by itself (see BEHAVIOUR above); the look is still CSS, but a module in circle/js/ui/ has to feed it';
  } else if (deps.some(d => MOTION.test(d))) {
    verdict = 'PORTABLE AS CSS ALONE';
    why = 'the only dependency is motion, and the animation here runs on a timeline, so it becomes @keyframes';
  } else {
    verdict = 'PORTABLE AS CSS ALONE';
    why = 'no dependencies and nothing read at runtime — this is Tailwind utilities and markup, and both have plain CSS equivalents';
  }

  return { slug, res, j, files, primary, extras, src, deps, regDeps, classes, colours,
    keyframes, customProps, svgs, signals, extraSignals, verdict, why };
}

function render(a, { source = true } = {}) {
  const L = [];
  const p = (s = '') => L.push(s);
  p(RULE);
  p(`${a.slug}    ${a.res.url}`);
  p(RULE);
  p(`STATUS  200 — free, and the licence permits using it in an end product`);
  p(`TITLE   ${a.j.title || a.j.name || a.slug}${a.j.author ? `   (${a.j.author})` : ''}`);
  for (const f of a.files) {
    p(`FILE    ${f.path}   ${bytes(f.content)}${f === a.primary ? '   <- the component itself' : '   (a sibling it imports)'}`);
  }
  p();

  p('DEPENDENCIES');
  if (!a.deps.length) p('  none — pure CSS, ports directly');
  else for (const d of a.deps) p(`  ${classifyDep(d)}`);
  if (a.regDeps.length) {
    const names = a.regDeps.map(d => String(d).replace(/^.*\/registry\//, '').replace(/\.json$/, ''));
    p(`  registry: ${names.join(', ')} — other Aceternity components, probe each one too`);
  }
  p();

  // Classes, grouped by the CSS they become.
  const buckets = new Map();
  const unmapped = [];
  for (const cls of [...a.classes.keys()].sort()) {
    const { base } = splitVariants(cls);
    const css = toCss(base);
    if (!css) { unmapped.push(cls); continue; }
    const g = groupOf(css);
    if (!buckets.has(g)) buckets.set(g, []);
    buckets.get(g).push([cls, css]);
  }
  p(`TAILWIND CLASSES  (${a.classes.size} distinct)`);
  const order = [...GROUPS.map(g => g[0]), 'everything else'];
  for (const g of order) {
    const rows = buckets.get(g);
    if (!rows || !rows.length) continue;
    p(`  ${g}`);
    for (const [cls, css] of rows) p(`    ${cls.padEnd(38)} ${css}`);
  }
  if (unmapped.length) {
    p('  no mechanical mapping — check tailwindcss.com');
    p('    (or the class is not a stock utility at all: a name defined in the consumer\'s');
    p('     Tailwind config, in which case its CSS is not in this file and never will be.)');
    for (const cls of unmapped) p(`    ${cls}`);
  }
  p();

  // Variants that this codebase cannot keep, with the reason.
  const variantNotes = [];
  const withVariant = (re) => [...a.classes.keys()].filter(c => splitVariants(c).variants.some(v => re.test(v)));
  const responsive = withVariant(/^(sm|md|lg|xl|2xl|max-sm|max-md|max-lg)$/);
  const darks = withVariant(/^dark$/);
  const hovers = withVariant(/^(hover|group-hover)/);
  if (responsive.length) variantNotes.push(['width breakpoints', responsive,
    'this app has ONE layout breakpoint, (min-width: 900px) and (min-height: 600px), at the foot of css/app.css. A port may use it, and must say what it does on each side: the phone side is the value the phone gets today. It may not introduce a second width.']);
  if (darks.length) variantNotes.push(['dark: variants', darks,
    'dark mode here is tokens.css redefining tokens, not a second set of rules. Use a token and both themes follow.']);
  if (hovers.length) variantNotes.push(['hover variants', hovers,
    'a phone has no hover, so a hover-only reaction is no reaction. Guard with @media (hover: hover) and give :active a state of its own.']);
  if (variantNotes.length) {
    p('VARIANTS THIS APP CANNOT KEEP');
    for (const [name, list, why] of variantNotes) {
      p(`  ${name} (${list.length}): ${list.slice(0, 8).join(' ')}${list.length > 8 ? ' …' : ''}`);
      p(`    ${why}`);
    }
    p();
  }

  p(`HARD-CODED COLOURS  (${a.colours.size} distinct)`);
  if (!a.colours.size) p('  none — nothing to re-point at a token');
  else {
    p('  Each of these must be replaced by a token from circle/css/tokens.css. A baked hex is');
    p('  how a port ends up correct in light mode and broken for half the club.');
    for (const [c, n] of [...a.colours.entries()].sort((x, y) => y[1] - x[1])) {
      p(`    ${c.padEnd(44)} ${n}×   must be replaced by a token`);
    }
  }
  p();

  p('KEYFRAMES IN THE SOURCE');
  if (!a.keyframes.length) {
    const named = [...a.classes.keys()].map(c => splitVariants(c).base.match(/^animate-(.+)$/)).filter(Boolean).map(m => m[1])
      .filter(n => !/^(spin|ping|pulse|bounce|none)$/.test(n));
    if (named.length) {
      p(`  none in this file, but it uses animate-${named.join(', animate-')}.`);
      p('  Those keyframes live in the consumer\'s Tailwind config, which the registry does not ship,');
      p('  so the timing is not here — read the component page or write the keyframes yourself.');
    } else p('  none');
  } else for (const k of a.keyframes) { for (const line of k.split('\n')) p(`  ${line}`); p(); }
  p();

  p('CSS CUSTOM PROPERTIES DECLARED INLINE');
  if (!a.customProps.size) p('  none');
  else for (const [k, v] of a.customProps) p(`  ${k}: ${v}`);
  p();

  p('SVG');
  if (!a.svgs.length) p('  none');
  else {
    p('  An SVG filter often IS the effect, and it ports unchanged. Printed whole:');
    for (const s of a.svgs) { p(); for (const line of s.split('\n')) p(`  ${line}`); }
  }
  p();

  p(`BEHAVIOUR  (${basename(a.primary.path)} — the component itself)`);
  if (!a.signals.length) p('  nothing read at runtime — no pointer, no scroll, no measurement');
  else for (const s of a.signals) p(`  - ${s}`);
  for (const e of a.extraSignals) {
    p(`  ${basename(e.path)} — a sibling, only if you port that too`);
    if (!e.signals.length) p('    nothing read at runtime');
    else for (const s of e.signals) p(`    - ${s}`);
  }
  p();

  if (source) {
    for (const f of a.files) {
      p(THIN);
      p(`SOURCE  ${f.path}`);
      p(THIN);
      p(f.content.replace(/\s+$/, ''));
      p();
    }
  }

  p(THIN);
  const house = houseVerdict(a.slug);
  if (house) {
    p(`THE HOUSE HAS ALREADY RULED  ${house.ruling}`);
    p(`  ${house.why}.`);
    p('  That decision is written down in references/catalog.md, with the full clause. Read it');
    p('  before the line below, which is about MECHANISM only and cannot overturn it.');
  } else {
    p('THE HOUSE HAS NOT RULED ON THIS ONE');
    p('  references/catalog.md does not judge this slug. Put it through the five questions in');
    p('  SKILL.md section 2 yourself, and write the verdict into the catalogue afterwards so the');
    p('  next person does not repeat the work.');
  }
  p(THIN);
  p(`MECHANISM  ${a.verdict} — ${a.why}`);
  p(THIN);
  p('Portable is not the same as wanted. Read The Edition in circle-feel/SKILL.md and the house');
  p('verdict in borrowed-effects/SKILL.md before porting: most of this library is a register this');
  p('app deliberately does not use.');
  return L.join('\n');
}

function renderRejected(slug, res) {
  const L = [];
  L.push(RULE);
  L.push(`${slug}    ${res.url}`);
  L.push(RULE);
  if (res.status === 401) {
    L.push('STATUS  401 — not available. The registry answers 401 for two different things and');
    L.push('        does not distinguish them: a paid (Pro / All-Access) component that has not');
    L.push('        been bought, AND a slug that does not exist at all. Checked 2026-09-20:');
    L.push('        3d-card-effect (real, paid) and totally-bogus-slug-xyz return the same 401');
    L.push('        and the same body.');
    L.push('');
    L.push('        So: do NOT port this, and do NOT tell anyone they have to buy it until the');
    L.push('        slug itself is confirmed on ui.aceternity.com. Check the spelling first.');
    const near = nearMatches(slug);
    if (near.length) {
      L.push('');
      L.push(`        Known free slugs that look close: ${near.join(', ')}`);
    }
  } else if (res.status === 404) {
    L.push('STATUS  404 — no such component. The slug is wrong.');
    const near = nearMatches(slug);
    if (near.length) L.push(`        Known free slugs that look close: ${near.join(', ')}`);
  } else {
    L.push(`STATUS  ${res.status} — unexpected. The server said, verbatim:`);
    L.push('');
    for (const line of (res.body || '(empty body)').slice(0, 1200).split('\n')) L.push(`        ${line}`);
  }
  L.push(THIN);
  L.push('VERDICT  NOT WORTH PORTING — there is no source to port.');
  L.push(THIN);
  return L.join('\n');
}

// ---------------------------------------------------------------------------- --list

async function runList() {
  const rows = [];
  const queue = [...ALL_KNOWN];
  const worker = async () => {
    for (;;) {
      const slug = queue.shift();
      if (!slug) return;
      try {
        const res = await fetchRegistry(slug);
        if (res.status !== 200) { rows.push({ slug, status: res.status, deps: '-', verdict: 'not available' }); continue; }
        const a = analyse(slug, res);
        rows.push({
          slug, status: 200,
          deps: a.deps.length ? a.deps.join(' ') : 'none',
          verdict: a.verdict === 'PORTABLE AS CSS ALONE' ? 'css alone'
            : a.verdict === 'NEEDS A SMALL JS MODULE' ? 'css + js module' : 'not worth porting',
        });
      } catch (err) {
        rows.push({ slug, status: 'ERR', deps: '-', verdict: err.message.split('\n')[0] });
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  const by = new Map(rows.map(r => [r.slug, r]));

  const tag = (slug) => {
    const h = houseVerdict(slug);
    if (!h) return 'UNJUDGED';
    return h.ruling === 'FITS' ? 'fits'
      : h.ruling === 'ONLY IF ASKED' ? 'only if asked' : 'wrong';
  };

  console.log('Known Aceternity slugs, probed live just now. This script reads the Aceternity');
  console.log('registry only — 21st.dev and shadcn publish their source on the page instead.');
  console.log('status 200 = free and the source is readable; anything else = no source to port.');
  console.log('house   = what references/catalog.md already decided. That is the decision.');
  console.log('mech    = whether the MECHANISM fits in CSS. It never says an effect is wanted.');
  console.log();
  for (const [group, slugs] of Object.entries(KNOWN)) {
    console.log(group);
    for (const slug of slugs) {
      const r = by.get(slug) || { status: '?', deps: '-', verdict: '-' };
      console.log(`  ${String(slug).padEnd(32)} ${String(r.status).padEnd(4)} ${tag(slug).padEnd(14)} ${String(r.verdict).padEnd(16)} ${r.deps}`);
    }
    console.log();
  }
  const tally = (pred) => rows.filter(pred).length;
  console.log(`${rows.length} slugs probed: ${tally(r => r.status === 200)} answered 200.`);
  console.log(`mechanism: ${tally(r => r.verdict === 'css alone')} css alone, `
    + `${tally(r => r.verdict === 'css + js module')} css + js module, `
    + `${tally(r => r.verdict === 'not worth porting')} not worth porting.`);
  console.log(`house: ${ALL_KNOWN.filter(s => tag(s) === 'fits').length} fits, `
    + `${ALL_KNOWN.filter(s => tag(s) === 'only if asked').length} only if asked, `
    + `${ALL_KNOWN.filter(s => tag(s) === 'wrong').length} wrong for this app, `
    + `${ALL_KNOWN.filter(s => tag(s) === 'UNJUDGED').length} not judged yet.`);
  console.log('These counts move whenever Aceternity ships a component. Trust this table, not a');
  console.log('number written into a skill file months ago.');
  console.log();
  const bad = rows.filter(r => r.status === 'ERR');
  if (bad.length) {
    console.error(`${bad.length} slug(s) could not be reached: ${bad.map(b => b.slug).join(', ')}`);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------- main

const USAGE = `Usage (Aceternity UI only — 21st.dev and shadcn have no registry to read, their
source is on the component page; save it to a file and read it by hand):
  node borrow.mjs <slug> [<slug>...]          print the house ruling, the mechanism and the source
  node borrow.mjs --save <dir> <slug>...      also write the raw .tsx and the report to <dir>
  node borrow.mjs --list                      probe the known slugs and print a table
  node borrow.mjs --no-source <slug>...       the report without the full source`;

async function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) { console.log(USAGE); return; }
  if (argv.includes('--list')) return runList();

  let saveDir = null, source = true;
  const slugs = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--save') { saveDir = argv[++i]; if (!saveDir) throw new Error('--save needs a directory'); continue; }
    if (argv[i] === '--no-source') { source = false; continue; }
    if (argv[i].startsWith('-')) throw new Error(`unknown option ${argv[i]}\n\n${USAGE}`);
    slugs.push(argv[i].replace(/\.json$/, '').replace(/^.*\/registry\//, ''));
  }
  if (!slugs.length) throw new Error(`no slug given\n\n${USAGE}`);
  if (saveDir) mkdirSync(resolve(saveDir), { recursive: true });

  let failed = 0;
  for (const slug of slugs) {
    const res = await fetchRegistry(slug);
    let text;
    if (res.status === 200) {
      const a = analyse(slug, res);
      text = render(a, { source });
      if (saveDir) {
        for (const f of a.files) writeFileSync(resolve(saveDir, basename(f.path)), f.content);
        writeFileSync(resolve(saveDir, `${slug}.report.txt`), text + '\n');
      }
    } else {
      failed++;
      text = renderRejected(slug, res);
      if (saveDir) writeFileSync(resolve(saveDir, `${slug}.report.txt`), text + '\n');
    }
    console.log(text);
    console.log();
  }
  if (failed && failed === slugs.length) process.exitCode = 2;
}

main().catch(err => {
  console.error(`borrow.mjs failed: ${err.message}`);
  process.exit(1);
});
