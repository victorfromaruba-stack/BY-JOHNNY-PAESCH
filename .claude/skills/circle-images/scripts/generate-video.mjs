#!/usr/bin/env node
/**
 * A short video loop, through Google's Veo models.
 *
 *   node generate-video.mjs --prompt "..." --out /tmp/hero.mp4 [--ref hero.jpg] [--seconds 6]
 *
 * Pass --ref to use a still as the FIRST FRAME. That is what lets the same image serve as the
 * <video poster>: the first paint and the first frame are identical, so there is no jump when
 * the video takes over, and a member on bad data who never gets the video still sees the shot
 * the page was designed around.
 *
 * Veo is a long-running operation — it returns a job, not a file — so this polls until done.
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { extname, resolve } from 'node:path';

const key = process.env.NANOBANANA_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
if (!key) { console.error('Set NANOBANANA_GEMINI_API_KEY or GEMINI_API_KEY'); process.exit(1); }
const flag = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };

const prompt = flag('prompt'); const out = flag('out');
if (!prompt || !out) { console.error('usage: --prompt "..." --out path.mp4 [--ref img] [--seconds 6]'); process.exit(1); }
const model = flag('model', 'veo-3.1-fast-generate-preview');
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

const instance = { prompt };
const ref = flag('ref');
if (ref) {
  if (!existsSync(ref)) { console.error(`reference not found: ${ref}`); process.exit(1); }
  instance.image = { bytesBase64Encoded: readFileSync(resolve(ref)).toString('base64'),
                     mimeType: MIME[extname(ref).toLowerCase()] || 'image/jpeg' };
}
// Some Veo variants reject generateAudio outright, so it is opt-in rather than assumed. It
// matters little here: a hero loop is muted in the player anyway, and a muted track is a few
// KB. Pass --audio to keep it where the model allows.
const parameters = { aspectRatio: flag('aspect', '16:9'), durationSeconds: Number(flag('seconds', 6)) };
if (process.argv.includes('--no-audio')) parameters.generateAudio = false;

const base = 'https://generativelanguage.googleapis.com/v1beta';
let res = await fetch(`${base}/models/${model}:predictLongRunning?key=${key}`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ instances: [instance], parameters }),
});
if (!res.ok) { console.error(`start failed ${res.status}: ${(await res.text()).slice(0, 500)}`); process.exit(1); }
let op = await res.json();
console.error(`job ${op.name?.split('/').pop() || '?'} started (${model}, ${parameters.durationSeconds}s)`);

const started = Date.now();
while (!op.done) {
  if (Date.now() - started > 10 * 60_000) { console.error('gave up after 10 minutes'); process.exit(1); }
  await new Promise(r => setTimeout(r, 10_000));
  const r2 = await fetch(`${base}/${op.name}?key=${key}`);
  if (!r2.ok) { console.error(`poll failed ${r2.status}`); process.exit(1); }
  op = await r2.json();
  process.stderr.write('.');
}
process.stderr.write('\n');
if (op.error) { console.error('failed:', JSON.stringify(op.error).slice(0, 400)); process.exit(1); }

const vid = op.response?.generateVideoResponse?.generatedSamples?.[0]?.video
         || op.response?.generatedVideos?.[0]?.video || op.response?.videos?.[0];
const uri = vid?.uri || vid?.gcsUri;
if (!uri && !vid?.videoBytes) {
  console.error('no video in response:', JSON.stringify(op.response || op).slice(0, 600)); process.exit(1);
}
let buf;
if (vid?.videoBytes) buf = Buffer.from(vid.videoBytes, 'base64');
else {
  const dl = await fetch(uri.includes('key=') ? uri : `${uri}${uri.includes('?') ? '&' : '?'}key=${key}`);
  if (!dl.ok) { console.error(`download failed ${dl.status}`); process.exit(1); }
  buf = Buffer.from(await dl.arrayBuffer());
}
writeFileSync(out, buf);
const kb = Math.round(buf.length / 1024);
console.log(`${out}  ${kb}KB  (${model}, ${parameters.durationSeconds}s, ${parameters.aspectRatio})`);
if (kb > 2048) console.log(`  — ${kb}KB is heavy for a hero on mobile data. Shorten it or drop the resolution.`);
