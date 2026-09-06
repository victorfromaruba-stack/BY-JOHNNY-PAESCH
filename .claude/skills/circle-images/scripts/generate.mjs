#!/usr/bin/env node
/**
 * Generated imagery, through Google's Gemini image models.
 *
 *   node generate.mjs --prompt "..." --out circle/assets/hero.jpg \
 *       [--aspect 16:9] [--ref a.jpg] [--model gemini-3-pro-image]
 *
 * Aspect ratios the models take: 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9.
 *
 * The key is read from NANOBANANA_GEMINI_API_KEY or GEMINI_API_KEY and NEVER written anywhere.
 * This site is a public repository served by GitHub Pages, so a key in the app would be a key
 * given away — which is why generation happens here, at build time, and only the finished
 * picture is committed. Nothing in circle/ ever calls this.
 *
 * `--ref` passes existing images in, which is how you edit rather than start over: hand it the
 * current hero and ask for the same scene at dusk, and you keep the composition.
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve, extname } from 'node:path';

const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };
const all = (n) => argv.reduce((a, v, i) => (v === `--${n}` ? [...a, argv[i + 1]] : a), []);

const key = process.env.NANOBANANA_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
if (!key) {
  console.error('No key. Set GEMINI_API_KEY (get one free at https://aistudio.google.com/apikey).');
  process.exit(1);
}
const prompt = flag('prompt');
const out = flag('out');
if (!prompt || !out) { console.error('usage: --prompt "..." --out path.jpg [--ref img] [--model m]'); process.exit(1); }

// flash-image is the cheap workhorse (~$0.04); the pro model is worth it for a hero that a
// stranger's first impression rests on.
const model = flag('model', process.env.NANOBANANA_MODEL || 'gemini-2.5-flash-image');

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const parts = [{ text: prompt }];
for (const r of all('ref')) {
  if (!existsSync(r)) { console.error(`reference not found: ${r}`); process.exit(1); }
  parts.push({ inline_data: { mime_type: MIME[extname(r).toLowerCase()] || 'image/jpeg',
                              data: readFileSync(resolve(r)).toString('base64') } });
}

const ctrl = new AbortController();
const timer = setTimeout(() => ctrl.abort(), 180000);
let res;
try {
  res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
    method: 'POST', signal: ctrl.signal,
    headers: { 'content-type': 'application/json' },
    // The model ignores an aspect ratio asked for in prose — it has to be configured. Without
    // this every hero comes back square and gets cropped into something nobody composed.
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { imageConfig: { aspectRatio: flag('aspect', '1:1') } },
    }),
  });
} finally { clearTimeout(timer); }

const body = await res.json().catch(() => ({}));
if (!res.ok) {
  // Never echo the URL back on failure — the key is in it.
  console.error(`${model} refused: ${body?.error?.message || res.status}`);
  process.exit(1);
}

const cand = body?.candidates?.[0]?.content?.parts || [];
const img = cand.find((p) => p.inlineData || p.inline_data);
if (!img) {
  const said = cand.map((p) => p.text).filter(Boolean).join(' ').slice(0, 300);
  console.error(`No image came back${said ? `: ${said}` : '.'}`);
  process.exit(1);
}
const data = img.inlineData?.data || img.inline_data?.data;
mkdirSync(dirname(resolve(out)), { recursive: true });
writeFileSync(resolve(out), Buffer.from(data, 'base64'));
const kb = Math.round(Buffer.from(data, 'base64').length / 1024);
console.log(`${out}  ${kb}KB  (${model})`);
if (kb > 300) console.log(`  — ${kb}KB. Run shrink.py on it before it goes near the first paint.`);
