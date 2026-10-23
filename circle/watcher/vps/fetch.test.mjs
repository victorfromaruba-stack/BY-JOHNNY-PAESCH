// The VPS fetcher, against a stub server on this machine. Nothing here can reach redweek.com: fetch is wrapped
// first thing, and anything not aimed at 127.0.0.1 throws and is counted by the last test.
//
//   node --test circle/watcher/vps/fetch.test.mjs

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { run, STAMP, stampOf } from './fetch.mjs';
import { OUR_SLUGS, UA, rentalsPath } from './rules.mjs';

const realFetch = globalThis.fetch;
const outside = [];
before(() => {
  globalThis.fetch = (url, init) => {
    if (!String(url).startsWith('http://127.0.0.1:')) { outside.push(String(url)); throw new Error(`test tried to reach ${String(url).slice(0, 60)}`); }
    return realFetch(url, init);
  };
});
after(() => { globalThis.fetch = realFetch; });

const PAGE = readFileSync(new URL('../fixtures-redweek-surfclub.html', import.meta.url));
const ROBOTS = 'User-agent: *\nDisallow: /members/\n';
const PAUSE = 120;

/** A stub RedWeek. `behave(path, n)` may return { status, body } or 'hang'; the default is a healthy site. */
async function withStub(behave, fn) {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push({ method: req.method, path: req.url, ua: req.headers['user-agent'], at: Date.now() });
    const n = hits.filter((h) => h.path === req.url).length;
    const r = behave(req.url, n) ?? (req.url === '/robots.txt' ? { status: 200, body: ROBOTS } : { status: 200, body: PAGE });
    if (r === 'hang') return;                                           // never answers
    res.writeHead(r.status, { 'content-type': 'text/html' });
    res.end(r.body ?? '');
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  const dir = mkdtempSync(join(tmpdir(), 'rw-fetch-'));
  try { await fn({ base, hits, out: join(dir, 'out'), halt: join(dir, 'halt.json'), dir }); }
  finally { server.closeAllConnections(); server.close(); rmSync(dir, { recursive: true, force: true }); }
}
const go = (ctx, o = {}) => run({ base: ctx.base, out: ctx.out, halt: ctx.halt, pause: PAUSE, timeoutMs: 2000, log: () => {}, ...o });
const runs = (out) => readdirSync(out).filter((d) => STAMP.test(d)).sort();
const manifestOf = (out, d) => JSON.parse(readFileSync(join(out, d, 'manifest.json'), 'utf8'));
const pagePath = (slug) => rentalsPath(slug);

test('a good run: every resort, in order, GET only, with our user agent, paced, and a manifest that matches the files', async () => {
  await withStub(() => null, async (ctx) => {
    const m = await go(ctx);
    assert.equal(m.complete, true);
    assert.equal(m.stop, null);
    assert.deepEqual(ctx.hits.map((h) => h.path), ['/robots.txt', ...OUR_SLUGS.map(pagePath)], 'robots.txt first, then each resort once, in the primary\'s order');
    assert.ok(ctx.hits.every((h) => h.method === 'GET'));
    assert.ok(ctx.hits.every((h) => h.ua === UA), 'the user agent the primary uses');
    const pageHits = ctx.hits.slice(1);
    for (let i = 1; i < pageHits.length; i++) assert.ok(pageHits[i].at - pageHits[i - 1].at >= PAUSE - 15, `pause before resort ${i + 1}`);

    const [d] = runs(ctx.out);
    assert.equal(runs(ctx.out).length, 1);
    assert.deepEqual(readdirSync(ctx.out), [d], 'no half-written directory is left beside it');
    const man = manifestOf(ctx.out, d);
    assert.equal(man.complete, true);
    assert.equal(man.pages.length, OUR_SLUGS.length);
    assert.equal(man.robots.status, 200);
    for (const p of man.pages) {
      assert.deepEqual(Object.keys(p).sort(), ['bytes', 'fetchedAt', 'file', 'sha256', 'slug', 'status', 'url']);
      const file = readFileSync(join(ctx.out, d, p.file));
      assert.equal(p.status, 200);
      assert.equal(p.bytes, file.length);
      assert.equal(p.sha256, createHash('sha256').update(file).digest('hex'));
      assert.equal(p.url, ctx.base + pagePath(p.slug));
      assert.ok(Date.parse(p.fetchedAt) >= Date.parse(man.runAt) && Date.parse(p.fetchedAt) <= Date.parse(man.finishedAt));
    }
    assert.ok(!existsSync(ctx.halt), 'a good run leaves no stop behind');
  });
});

test('a 403 ends the run on the spot, remembers it, and the next run asks nobody anything', async () => {
  await withStub((path) => (path === pagePath(OUR_SLUGS[2]) ? { status: 403, body: 'Forbidden' } : null), async (ctx) => {
    const m = await go(ctx);
    assert.equal(m.complete, false);
    assert.equal(m.stop.kind, 'stop');
    assert.equal(m.stop.slug, OUR_SLUGS[2]);
    assert.equal(m.stop.status, 403);
    assert.deepEqual(ctx.hits.map((h) => h.path), ['/robots.txt', ...OUR_SLUGS.slice(0, 3).map(pagePath)], 'the fourth resort is never asked for');
    assert.equal(m.pages[2].file, null, 'a refused page is not kept as a listing');
    assert.equal(JSON.parse(readFileSync(ctx.halt, 'utf8')).kind, 'stop');

    const before = ctx.hits.length;
    const again = await go(ctx, { now: () => Date.now() + 5e3 });
    assert.equal(ctx.hits.length, before, 'halted: not one request');
    assert.equal(again.stop.kind, 'stop');
    assert.equal(again.stop.held, true);
    assert.equal(runs(ctx.out).length, 2, 'it still writes a manifest, so the primary can say why');
    // and a day later it is still halted: only a person deletes halt.json
    await go(ctx, { now: () => Date.now() + 3 * 864e5 });
    assert.equal(ctx.hits.length, before);
  });
});

test('a 429 ends the run and waits a day; after the day, robots.txt is the one probe, and a good answer resumes', async () => {
  let limited = true;
  await withStub((path) => (limited && path === pagePath(OUR_SLUGS[1]) ? { status: 429, body: 'slow down' } : null), async (ctx) => {
    const m = await go(ctx);
    assert.equal(m.stop.kind, 'backoff');
    assert.equal(m.stop.status, 429);
    assert.equal(ctx.hits.length, 3, 'robots.txt, resort one, resort two (429) — nothing after');
    const halt = JSON.parse(readFileSync(ctx.halt, 'utf8'));
    assert.ok(Math.abs(Date.parse(halt.until) - Date.parse(m.runAt) - 864e5) < 2000, 'a day');

    const n = ctx.hits.length;
    assert.equal((await go(ctx, { now: () => Date.now() + 3600e3 })).stop.held, true);
    assert.equal(ctx.hits.length, n, 'inside the day: nothing asked');

    limited = false;
    const later = await go(ctx, { now: () => Date.now() + 25 * 3600e3 });
    assert.equal(later.complete, true);
    assert.equal(ctx.hits[n].path, '/robots.txt', 'the first request after the wait is robots.txt');
    assert.ok(!existsSync(ctx.halt), 'answered: the wait is over');
  });
});

test('a challenge page with a 200 is a full stop, and is not kept as a listing', async () => {
  const wall = '<html><title>Just a moment...</title><body>Please verify you are human<div id="cf-challenge"></div></body></html>';
  await withStub((path) => (path === pagePath(OUR_SLUGS[1]) ? { status: 200, body: wall } : null), async (ctx) => {
    const m = await go(ctx);
    assert.equal(m.stop.kind, 'stop');
    assert.equal(m.pages[1].challenge, true);
    assert.equal(m.pages[1].file, null);
    assert.equal(ctx.hits.length, 3);
    assert.equal(JSON.parse(readFileSync(ctx.halt, 'utf8')).kind, 'stop');
  });
});

test('a resort page with no weeks open is not a wall just because it is short', async () => {
  await withStub((path) => (path === pagePath(OUR_SLUGS[0]) ? { status: 200, body: '<section class="postings"></section>' } : null), async (ctx) => {
    const m = await go(ctx);
    assert.equal(m.stop, null);
    assert.equal(m.complete, true);
  });
});

test('a connection that never answers ends the run and waits a day', async () => {
  await withStub((path) => (path === pagePath(OUR_SLUGS[1]) ? 'hang' : null), async (ctx) => {
    const m = await go(ctx, { timeoutMs: 250 });
    assert.equal(m.stop.kind, 'backoff');
    assert.match(m.stop.why, /timed out on/);
    assert.equal(ctx.hits.length, 3, 'nothing after the one that hung');
    assert.ok(JSON.parse(readFileSync(ctx.halt, 'utf8')).until);
  });
});

test('robots.txt is obeyed: a Disallow on the resorts, or a 403 on robots.txt itself, is a stop before any page', async () => {
  await withStub((path) => (path === '/robots.txt' ? { status: 200, body: 'User-agent: *\nDisallow: /resort/\n' } : null), async (ctx) => {
    const m = await go(ctx);
    assert.equal(m.stop.kind, 'stop');
    assert.match(m.stop.why, /robots\.txt disallows/);
    assert.deepEqual(ctx.hits.map((h) => h.path), ['/robots.txt']);
  });
  await withStub((path) => (path === '/robots.txt' ? { status: 403, body: 'no' } : null), async (ctx) => {
    const m = await go(ctx);
    assert.equal(m.stop.kind, 'stop');
    assert.equal(ctx.hits.length, 1);
  });
  await withStub((path) => (path === '/robots.txt' ? { status: 404, body: '' } : null), async (ctx) => {
    assert.equal((await go(ctx)).complete, true, 'no robots.txt allows everything');
  });
});

test('one resort answering 500 is recorded and the run carries on, incomplete, with nothing halted', async () => {
  await withStub((path) => (path === pagePath(OUR_SLUGS[1]) ? { status: 500, body: 'oops' } : null), async (ctx) => {
    const m = await go(ctx);
    assert.equal(m.stop, null);
    assert.equal(m.complete, false);
    assert.equal(m.pages.length, OUR_SLUGS.length);
    assert.equal(m.pages[1].status, 500);
    assert.equal(m.pages[1].file, null);
    assert.ok(!existsSync(ctx.halt));
  });
});

test('seven days are kept: older runs and old half-written ones go, newer ones and strangers stay', async () => {
  await withStub(() => null, async (ctx) => {
    const now = Date.parse('2026-10-23T09:50:00Z');
    mkdirSync(ctx.out, { recursive: true });
    const old = stampOf(now - 8 * 864e5), fresh = stampOf(now - 6 * 864e5);
    for (const d of [old, fresh, `.tmp-${old}`]) mkdirSync(join(ctx.out, d));
    writeFileSync(join(ctx.out, 'notes.txt'), 'not ours');
    await go(ctx, { now: () => now });
    assert.deepEqual(readdirSync(ctx.out).sort(), [fresh, 'notes.txt', stampOf(now)].sort());
  });
});

test('run() will not guess where to ask or where to write', async () => {
  await assert.rejects(() => run({}), /needs base, out and halt/);
});

test('in the end, nothing in this file reached a real host', () => {
  assert.deepEqual(outside, []);
});
