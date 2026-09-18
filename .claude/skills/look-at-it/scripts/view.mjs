// Open a page in the real browser and screenshot it, so it can be READ rather than guessed at.
//
//   node view.mjs <url> <out.jpg> [extraScrolls] [--viewport]
//
// Defaults to a full-page shot (slice it with chunk.py before reading). --viewport takes just the
// first screen, which is what you want when judging a first impression.
//
// No user-agent spoofing: the default identifies this as an automated browser, which is honest and
// loads these sites fine. TLS is fully verified — run trust-proxy-ca.sh once if HTTPS fails.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [url, out, scrollsArg] = process.argv.slice(2);
if (!url || !out) { console.error('usage: node view.mjs <url> <out.jpg> [extraScrolls] [--viewport]'); process.exit(1); }
const scrolls = Number(scrollsArg) || 0;
const viewportOnly = process.argv.includes('--viewport');
const local = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/.test(url);

// Find the Chromium that is actually installed; the path carries a build number that changes.
const { readdirSync, existsSync } = await import('node:fs');
let exe = null;
for (const d of readdirSync('/opt/pw-browsers')) {
  const cand = `/opt/pw-browsers/${d}/chrome-linux/chrome`;
  if (existsSync(cand)) { exe = cand; break; }
}
if (!exe) { console.error('no chromium found under /opt/pw-browsers'); process.exit(1); }

const b = await chromium.launch({
  executablePath: exe,
  // Localhost is in no_proxy; sending it through the proxy would just fail.
  ...(local ? {} : { proxy: { server: process.env.HTTPS_PROXY || 'http://127.0.0.1:44665' } }),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
p.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));

try {
  const r = await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log('status', r && r.status(), '| final url', p.url());
  console.log('title', JSON.stringify((await p.title()).slice(0, 120)));
  await p.waitForTimeout(5000);

  // A full-page screenshot skips loading="lazy" images, and img.complete does not mean decoded.
  // Without this you end up describing a layout that never rendered.
  const settle = async () => {
    await p.evaluate(() => document.querySelectorAll('img').forEach((i) => { i.loading = 'eager'; }));
    await p.evaluate(async () => { await Promise.all([...document.querySelectorAll('img')].map((i) => i.decode().catch(() => {}))); });
    await p.waitForTimeout(1200);
  };
  await settle();

  mkdirSync(dirname(out), { recursive: true });
  await p.screenshot({ path: out, type: 'jpeg', quality: 88, fullPage: !viewportOnly });
  console.log('saved', out);

  for (let i = 1; i <= scrolls; i++) {
    await p.evaluate(() => window.scrollBy(0, Math.round(window.innerHeight * 0.9)));
    await p.waitForTimeout(2000);
    await settle();
    const o = out.replace(/\.jpg$/, `-${i}.jpg`);
    await p.screenshot({ path: o, type: 'jpeg', quality: 88 });
    console.log('saved', o);
  }
  if (errors.length) console.log('page errors:', errors.slice(0, 5));
} catch (e) {
  console.error('FAILED:', String(e.message).slice(0, 300));
  console.error('If this is ERR_CERT_AUTHORITY_INVALID, run trust-proxy-ca.sh once.');
  console.error('If the proxy returned 403/407 the host is blocked by policy — report it, do not retry.');
  process.exitCode = 1;
}
await b.close();
