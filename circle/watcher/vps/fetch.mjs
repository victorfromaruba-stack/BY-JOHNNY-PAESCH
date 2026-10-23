#!/usr/bin/env node
// RedWeek's public rentals pages, fetched on the VPS and left as raw HTML for the primary to pull.
//
//   node /srv/redweek/fetch.mjs        one run: every resort, ten seconds apart, then stop
//
// Why the VPS: RedWeek stopped answering the primary's address on 22 Oct 2026 and answers the VPS's (board #3).
// This file does the asking and nothing else — no parsing, no judging, no credential of the Circle's: the
// primary pulls what is written here (rsync, read-only), reads it with the same parseRentals it always used,
// and does all the judging and posting itself.
//
// It asks exactly as the primary's redweek.mjs does, because both read vps/rules.mjs: the same user agent, the
// same resorts, robots.txt read first and obeyed, GET only, one page per resort, WATCH_REDWEEK_PAUSE_SEC (10 s)
// between resorts. And the interval-board skill's line holds here too: a 403, a challenge page or a robots.txt
// that disallows is a full stop, not a puzzle. The run ends there and writes /srv/redweek/state/halt.json; nothing asks RedWeek
// again until a person deletes it. A 429, a timeout or a broken robots.txt ends the run and waits a day.
//
// Each run is a directory, out/2026-10-23T09-50-03Z/ (UTC), holding one <slug>.html per resort and a
// manifest.json: when it ran, one entry per page { slug, file, url, fetchedAt, status, bytes, sha256 }, and
// `stop` — null, or why the run ended early. The directory appears whole (written aside, then renamed), and
// runs older than seven days are removed.

import { mkdirSync, writeFileSync, renameSync, readdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE, UA, OUR_SLUGS, WALL, robotsAllows, pauseMs, isTimeout, rentalsPath } from './rules.mjs';

const DAY = 864e5;
export const KEEP_DAYS = 7;
const iso = (ms) => new Date(ms).toISOString();
/** 2026-10-23T09:50:03.123Z -> 2026-10-23T09-50-03Z: sorts as time, and is a safe file name. */
export const stampOf = (ms) => iso(ms).replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');
export const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/;
const stampMs = (name) => Date.parse(name.replace(/T(\d\d)-(\d\d)-(\d\d)Z$/, 'T$1:$2:$3Z'));
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readHalt(file) {
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return { kind: 'stop', at: null, why: 'halt.json is there but unreadable' }; }   // fails closed
}

/**
 * One run. `base`, `out` and `halt` have no defaults on purpose: the command line below supplies the real ones,
 * so a test that forgets one fails here instead of reaching redweek.com.
 */
export async function run({ base, out, halt, slugs = OUR_SLUGS, pause = pauseMs(), timeoutMs = 30000, ua = UA, log = console.log, now = Date.now } = {}) {
  if (!base || !out || !halt) throw new Error('run() needs base, out and halt');
  const t0 = now();
  const stamp = stampOf(t0);
  mkdirSync(out, { recursive: true });
  const tmp = join(out, `.tmp-${stamp}`);
  mkdirSync(tmp, { recursive: true });
  const m = { runAt: iso(t0), finishedAt: null, ua, slugs: [...slugs], robots: null, pages: [], stop: null, complete: false };
  const stopRun = (kind, slug, why, status = null) => { m.stop = { kind, slug, status, why, at: iso(now()) }; log(`STOP (${kind}): ${why}`); };

  const held = readHalt(halt);
  const waiting = held && (held.kind === 'backoff' ? Date.parse(held.until) > t0 : true);
  if (waiting) {
    // Not one request. The manifest says why, so the primary can tell a halted VPS from a broken one.
    m.stop = { kind: held.kind, slug: null, status: null, at: held.at, until: held.until, held: true, why: `still in force since ${held.at}: ${held.why}` };
    log(`not asking RedWeek: ${m.stop.why}`);
  } else {
    const get = async (path, accept) => {
      const res = await fetch(base + path, { method: 'GET', signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': ua, accept } });
      const buf = Buffer.from(await res.arrayBuffer());
      return { status: res.status, buf, at: iso(now()) };
    };
    // robots.txt first, once: it is also the single probe after a day's wait.
    let robots = '';
    try {
      const r = await get('/robots.txt', 'text/plain');
      m.robots = { url: base + '/robots.txt', fetchedAt: r.at, status: r.status, bytes: r.buf.length, sha256: sha256(r.buf) };
      if (r.status === 403) stopRun('stop', null, 'RedWeek refused robots.txt with a 403', 403);
      else if (r.status === 429 || r.status >= 500) stopRun('backoff', null, `RedWeek answered robots.txt with ${r.status}`, r.status);
      else robots = r.status < 300 ? r.buf.toString('utf8') : '';      // a missing robots.txt allows everything
    } catch (err) { stopRun('backoff', null, `robots.txt: ${isTimeout(err) ? 'connection timed out' : err.message}`); }

    for (const [i, slug] of slugs.entries()) {
      if (m.stop) break;
      const path = rentalsPath(slug);
      if (!robotsAllows(robots, path, ua)) { stopRun('stop', slug, `RedWeek's robots.txt disallows ${path}`); break; }
      const page = { slug, file: null, url: base + path, fetchedAt: null, status: 0, bytes: 0, sha256: null };
      m.pages.push(page);
      try {
        const r = await get(path, 'text/html');
        Object.assign(page, { fetchedAt: r.at, status: r.status, bytes: r.buf.length, sha256: sha256(r.buf) });
        const html = r.buf.toString('utf8');
        if (r.status === 429) stopRun('backoff', slug, `RedWeek is rate-limiting us (429 for ${slug})`, 429);
        else if (r.status === 403) stopRun('stop', slug, `RedWeek answered 403 for ${slug}`, 403);
        else if (r.status !== 200) page.error = `RedWeek returned ${r.status} for ${slug}`;
        else if (!/posting-card/.test(html) && WALL.test(html)) { page.challenge = true; stopRun('stop', slug, `RedWeek served a challenge page for ${slug}`, 200); }
        else { page.file = `${slug}.html`; writeFileSync(join(tmp, page.file), r.buf); }
      } catch (err) {
        page.fetchedAt = iso(now()); page.error = err.message;
        if (isTimeout(err)) stopRun('backoff', slug, `connection timed out on ${slug}`);
      }
      log(`${slug} ${page.status || 'no answer'} ${page.bytes}B${page.error ? ` (${page.error})` : ''}`);
      if (!m.stop && i < slugs.length - 1) await sleep(pause);
    }
  }

  m.complete = !m.stop && m.pages.length === slugs.length && m.pages.every((p) => p.file);
  m.finishedAt = iso(now());
  writeFileSync(join(tmp, 'manifest.json'), JSON.stringify(m, null, 1));
  renameSync(tmp, join(out, stamp));

  // Remember a stop; a day's wait that has run out and been answered (robots.txt above) is over.
  if (m.stop && !m.stop.held) {
    const hard = m.stop.kind === 'stop';
    writeFileSync(halt, JSON.stringify({ kind: m.stop.kind, at: m.stop.at, why: m.stop.why, ...(hard ? {} : { until: iso(t0 + DAY) }) }, null, 1));
  } else if (held && !waiting) rmSync(halt, { force: true });

  for (const d of readdirSync(out)) {                                    // seven days, and no old half-written run
    const t = d.startsWith('.tmp-') ? stampMs(d.slice(5)) : STAMP.test(d) ? stampMs(d) : NaN;
    if (t < t0 - KEEP_DAYS * DAY) rmSync(join(out, d), { recursive: true, force: true });
  }
  return m;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const stamp = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
  const m = await run({ base: BASE, out: '/srv/redweek/out', halt: '/srv/redweek/state/halt.json', log: (...a) => console.log(stamp(), ...a) });
  console.log(stamp(), m.complete ? `done: ${m.pages.length} resorts` : m.stop ? `stopped: ${m.stop.why}` : 'finished, but not every resort answered');
  process.exitCode = m.stop ? 2 : m.complete ? 0 : 1;
}
