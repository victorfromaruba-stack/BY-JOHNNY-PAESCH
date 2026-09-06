#!/usr/bin/env node
// HTML or SVG in, a sharp PNG out. See ../SKILL.md for when to reach for this.
//
//   node render.mjs --in card.html --out og.png --width 1200 --height 630 --scale 2
//   cat mark.svg | node render.mjs --out badge.png --width 96 --height 96 --scale 3 --transparent
//
// Chromium is already on this machine and Playwright is pointed at it, so there is nothing to
// install and nothing to download.

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve, extname, join } from 'node:path';

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1]?.startsWith('--') ? true : argv[i + 1]);
};
const has = (name) => argv.includes(`--${name}`);

const out = flag('out');
if (!out) { console.error('render.mjs: --out is required'); process.exit(1); }
const width = Number(flag('width', 1200));
const height = Number(flag('height', 630));
const scale = Number(flag('scale', 2));
const selector = flag('selector', null);

const readStdin = () => new Promise((res) => {
  let s = ''; process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { s += d; });
  process.stdin.on('end', () => res(s));
});

const inPath = flag('in');
let source = inPath ? readFileSync(resolve(inPath), 'utf8') : await readStdin();
if (!source.trim()) { console.error('render.mjs: nothing to render'); process.exit(1); }

// A bare SVG gets wrapped so it fills the frame and sits on the requested background. An HTML
// document is used as-is, because it may carry its own <style> and fonts.
const isSvg = (inPath ? extname(inPath).toLowerCase() === '.svg' : source.trimStart().startsWith('<svg'));
const transparent = has('transparent');
if (isSvg) {
  source = `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;width:${width}px;height:${height}px;
      background:${transparent ? 'transparent' : '#fff'};display:grid;place-items:center}
    svg{width:100%;height:100%;display:block}
  </style>${source}`;
}

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width, height },
  deviceScaleFactor: scale,
  // Nothing should be caught mid-transition, and the site's own CSS honours this.
  reducedMotion: 'reduce',
  colorScheme: has('dark') ? 'dark' : 'light',
});

// The page has to be NAVIGATED to, not set as content. setContent leaves the document on an
// about:blank origin, and Chromium then refuses every file:// subresource it asks for — so a
// card referencing a local SVG or font comes out full of broken-image icons and the PNG looks
// fine by every measure except the only one that counts. Writing a temp file beside the input
// and going to it gives the document a real file:// origin, and relative paths just work.
const anchorDir = inPath ? resolve(dirname(inPath)) : process.cwd();
const tmp = join(anchorDir, `.render-${process.pid}-${Date.now()}.html`);
writeFileSync(tmp, source);
try {
  await page.goto(`file://${tmp}`, { waitUntil: 'load' });

  if (has('dark')) await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));

  // Type that renders in a fallback face and then swaps is the single most common way one of
  // these comes out wrong, and it is invisible until you look at the PNG.
  await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve()));
  await page.waitForTimeout(120);

  // A subresource that failed is the other way. Say so rather than writing a tidy broken PNG.
  const missing = await page.evaluate(() => [...document.images]
    .filter(i => i.complete && i.naturalWidth === 0).map(i => i.getAttribute('src')));
  if (missing.length) console.error(`render.mjs: ${missing.length} image(s) did not load: ${missing.slice(0,3).join(', ')}`);

  mkdirSync(dirname(resolve(out)), { recursive: true });
  const target = selector ? page.locator(selector).first() : page;
  await target.screenshot({ path: resolve(out), omitBackground: transparent, type: 'png',
    ...(selector ? {} : { clip: { x: 0, y: 0, width, height } }) });
} finally {
  rmSync(tmp, { force: true });
  await browser.close();
}

const { statSync } = await import('node:fs');
const kb = Math.round(statSync(resolve(out)).size / 1024);
console.log(`${out}  ${width * scale}×${height * scale}px  ${kb}KB`);
if (kb > 250 && !has('quiet')) {
  console.log('  (over 250KB — fine for a crest, heavy for anything in the first paint)');
}
