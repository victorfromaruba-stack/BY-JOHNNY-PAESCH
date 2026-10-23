// RedWeek: owner rentals at a resort.
//
// No login and no browser. Every listing card carries its own data attributes — check-in,
// check-out, nights, bedrooms, sleeps, view, price, price per night — so this reads structured
// values rather than guessing at text. One request per resort, and it identifies itself.

import { readFileSync, writeFileSync, existsSync, unlinkSync, readdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, basename } from 'node:path';

// The address, the user agent, the list of resorts, the challenge test and robots.txt reading are shared with
// the VPS's fetcher (vps/fetch.mjs): one copy, so a direct read and the VPS's read can never ask differently.
import { BASE, UA, ARUBA, WALL, robotsAllows, pauseMs, isTimeout, rentalsPath } from './vps/rules.mjs';
export { BASE, UA, ARUBA, WALL, robotsAllows, pauseMs, isTimeout };

// Apostrophes, accents and "&" differ between sites and our data. One normaliser for the whole
// app, so the watcher and the website agree on which resort a name means.
export { sameName } from '../js/core/names.js';

const day = (s) => (/^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : null);
const num = (s) => { const n = Number(String(s).replace(/[^0-9.]/g, '')); return Number.isFinite(n) ? n : 0; };

/**
 * Pull the listings out of a rentals page. Exported so it can be tested against saved HTML
 * without going near the network — fixtures-redweek-surfclub.html is that page, and
 * redweek.test.mjs is the trial. `node --test redweek.test.mjs` before you touch this.
 */
export function parseRentals(html, { slug, ourName = null } = {}) {
  const out = [];
  // Each card opens with its attributes; take the tag and the chunk of markup after it. The
  // ceiling was 2,500 characters, and the biggest cards run to 5,600 — the lookahead simply
  // failed on those and the listing vanished, silently, at a rate of ten out of every fifty-four
  // bookable weeks. It is generous now and still bounded, so a malformed page cannot run away.
  const re = /<div class="([^"]*posting-card[^"]*)"([^>]*)>([\s\S]{0,12000}?)(?=<div class="[^"]*posting-card|<\/section|$)/g;
  let m;
  while ((m = re.exec(html))) {
    const [, cls, attrs, body] = m;
    const a = Object.fromEntries([...attrs.matchAll(/data-([\w-]+)="([^"]*)"/g)].map(x => [x[1], x[2]]));
    if (!a.price_per_night || !a.check_in) continue;
    const from = day(a.check_in), to = day(a.check_out);
    if (!from || !to) continue;
    // data-price is the subtotal; the card also prints an all-in total that includes fees.
    const shown = body.match(/\$([\d,]+)\s*total/i);
    const total = shown ? num(shown[1]) : num(a.price);
    const nights = Number(a.nights) || 0;
    const unit = (body.match(/>\s*((?:Studio|\d\s*Bedroom)[^<]{0,44})</i) || [, ''])[1].trim();
    // The posting id: its own link when the card has one, the id RedWeek puts on the action
    // button when it does not. Never the price — a listing that drops a dollar is the same week.
    const id = (a['posting-path'] || '').split('/').pop()
      || (body.match(/title="(R\d+)"/) || [])[1]
      || `${slug}-${a.check_in}-${a.check_out}`;
    out.push({
      source: 'redweek', slug, ourName,
      externalId: id,
      url: a['posting-path'] ? BASE + a['posting-path'] : `${BASE}/resort/${slug}/timeshare-rentals`,
      from, to, nights,
      bedrooms: Number(a.bedrooms) || 0, bathrooms: Number(a.bathrooms) || 0,
      sleeps: Number(a.sleeps) || 0, view: a.view || '',
      unit: unit || (Number(a.bedrooms) ? `${a.bedrooms} Bedroom` : 'Studio'),
      // The site's own per-night figure is the subtotal divided out; the total it prints
      // includes the fees. Comparing one against the other put a nightly ceiling on a number
      // nobody pays, so the nightly here is the total spread across the nights — what it costs.
      usdNightly: nights > 0 && total > 0 ? Math.round((total / nights) * 100) / 100 : num(a.price_per_night),
      usdBeforeFees: num(a.price_per_night),
      usdTotal: total,
      // RedWeek leaves sold listings on the page and marks the card.
      taken: /posting-not-available|unavailable/.test(cls) || /\bRented!?\b/i.test(body),
      // What an available card actually carries is posting-protected — RedWeek standing behind
      // the payment. `posting-verified` is only ever on a card that is already gone, so reading
      // that one meant this said "false" on every single week the watcher could post.
      protected: /posting-protected/.test(cls),
    });
  }
  return out;
}

// ---- When RedWeek says no, that is the end of it -------------------------------------------
//
// A 403, a challenge page, or a robots.txt that disallows the page is not a hiccup to retry: it
// is the site telling a program to leave. The interval-board skill's line is that none of those
// is a puzzle, so none of them is treated as one. The first one writes a stop file, and from then
// on nothing in the watcher — the half-hourly pass or a member's tap — asks RedWeek anything until
// Victor deletes that file. A 429 is different (slow down, not go away) and keeps its own handling.

/** Thrown when RedWeek has told us to stop. `stop` is how callers tell it from an ordinary failure. */
export class RedWeekStop extends Error { constructor(why) { super(why); this.stop = true; } }

let STOP_FILE = null;
/** Where the stop is remembered across restarts. Unset (the tests) it lives for the process only. */
export const useStopFile = (path) => { STOP_FILE = path; memory = null; };
let memory = null;
/** The stop in force, `{ at, why }`, or null. A file that exists but cannot be read still counts. */
export function stopped() {
  if (memory) return memory;
  if (!STOP_FILE || !existsSync(STOP_FILE)) return null;
  try { return JSON.parse(readFileSync(STOP_FILE, 'utf8')); } catch { return { at: null, why: 'the stop file is there' }; }
}
function stop(why) {
  memory = { at: new Date().toISOString(), why };
  if (STOP_FILE) { try { writeFileSync(STOP_FILE, JSON.stringify(memory, null, 1), { mode: 0o600 }); } catch { /* memory still holds it */ } }
  throw new RedWeekStop(why);
}

// ---- When RedWeek does not answer at all, wait a day ---------------------------------------
//
// Since 22 Oct 2026 every request from this server to RedWeek times out: it has stopped answering this
// address. Victor's decision was to wait, not to route around it. A connection timeout is treated like a
// block: the FIRST one stops the rest of the pass and writes a back-off (.redweek-backoff.json, `until` a
// day on), and every RedWeek path checks it before it asks anything — the two daily scans, a by-hand
// --once, anything. Nothing retries in a loop. When the day is up the next request is ONE probe
// (robots.txt, fetched fresh): if it answers, the back-off is cleared and the read goes on; if it times
// out, another day. A person can end it early by deleting the file.

export const BACKOFF_MS = 24 * 3600e3;
/** Thrown while RedWeek is backed off. `stop` makes sweep() end the pass; `backoff` tells callers it is not a block. */
export class RedWeekBackoff extends Error { constructor(why, until) { super(why); this.stop = true; this.backoff = true; this.until = until; } }

let BACKOFF_FILE = null, backoffMemory = null;
/** Where the back-off is remembered across restarts. Unset (the tests) it lives for the process only. */
export const useBackoffFile = (path) => { BACKOFF_FILE = path; backoffMemory = null; };
/**
 * The back-off in force or run out, `{ at, until, why, expired }`, or null when there is none. A file that
 * exists but cannot be read still holds (until a day from now, every time it is asked): it fails closed.
 */
export function backoff(now = Date.now()) {
  let b = backoffMemory;
  if (BACKOFF_FILE) {
    b = null;
    if (existsSync(BACKOFF_FILE)) {
      try { b = JSON.parse(readFileSync(BACKOFF_FILE, 'utf8')); }
      catch { b = { at: null, until: new Date(now + BACKOFF_MS).toISOString(), why: 'the back-off file is there' }; }
    }
  }
  if (!b) return null;
  return { ...b, expired: !(Date.parse(b.until) > now) };
}
function startBackoff(why, now = Date.now()) {
  backoffMemory = { at: new Date(now).toISOString(), until: new Date(now + BACKOFF_MS).toISOString(), why };
  if (BACKOFF_FILE) { try { writeFileSync(BACKOFF_FILE, JSON.stringify(backoffMemory, null, 1), { mode: 0o600 }); } catch { /* memory still holds it */ } }
  return new RedWeekBackoff(`RedWeek did not answer (${why}) — backing off until ${backoffMemory.until}`, backoffMemory.until);
}
/** The probe answered: resume. */
export function clearBackoff() {
  backoffMemory = null;
  if (BACKOFF_FILE) { try { unlinkSync(BACKOFF_FILE); } catch { /* already gone */ } }
}

let robots = { at: 0, txt: '' };
async function checkRobots(path, timeoutMs) {
  if (Date.now() - robots.at > 864e5) {
    const res = await fetch(`${BASE}/robots.txt`, { signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': UA, accept: 'text/plain' } });
    if (res.status === 403) stop('RedWeek refused robots.txt with a 403');
    // A missing robots.txt (4xx) allows everything; a broken one (5xx) is not an answer, so wait.
    if (res.status >= 500) throw new Error(`RedWeek robots.txt returned ${res.status}`);
    robots = { at: Date.now(), txt: res.ok ? await res.text() : '' };
  }
  if (!robotsAllows(robots.txt, path)) stop(`RedWeek's robots.txt disallows ${path}`);
}
/** For the tests: forget the robots.txt that was read. */
export const _forgetRobots = () => { robots = { at: 0, txt: '' }; };

/** One resort's live rentals. Returns only what is still bookable. */
export async function rentals(slug, { includeTaken = false, timeoutMs = 30000 } = {}) {
  const held = stopped();
  if (held) throw new RedWeekStop(`RedWeek stopped us${held.at ? ` on ${held.at}` : ''}: ${held.why}`);
  // Backed off: not one request. Run out: this request is the single probe, and robots.txt is it.
  const bo = backoff();
  if (bo && !bo.expired) throw new RedWeekBackoff(`RedWeek did not answer on ${bo.at || 'an earlier pass'} (${bo.why}) — backed off until ${bo.until}`, bo.until);
  if (bo) robots = { at: 0, txt: '' };
  const path = rentalsPath(slug);
  const url = BASE + path;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    await checkRobots(path, timeoutMs);
    if (bo) clearBackoff();                                 // the probe was answered: carry on
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': UA, accept: 'text/html' } });
    if (res.status === 429) throw new Error('RedWeek is rate-limiting us — slow down.');
    if (res.status === 403) stop(`RedWeek answered 403 for ${slug}`);
    if (!res.ok) throw new Error(`RedWeek returned ${res.status} for ${slug}`);
    const html = await res.text();
    const all = parseRentals(html, { slug, ourName: ARUBA[slug] ?? null });
    if (!all.length && WALL.test(html)) stop(`RedWeek served a challenge page for ${slug}`);
    return includeTaken ? all : all.filter(x => !x.taken);
  } catch (err) {
    if (!err.stop && isTimeout(err)) throw startBackoff(`connection timed out on ${slug}`);
    throw err;
  } finally { clearTimeout(timer); }
}

// ---- Source: the VPS ------------------------------------------------------------------------
//
// RedWeek stopped answering this server's address on 22 Oct 2026 and answers Victor's VPS (board #3). So the
// VPS asks (vps/fetch.mjs, 05:50 and 17:50 Aruba) and leaves the raw pages in /srv/redweek/out; here they are
// pulled over the tailnet with a read-only key and read by the SAME parseRentals, judged and posted by the same
// code as a direct read, with each week's seen_at the time the VPS fetched its page. Nothing of the Circle's
// leaves this box: the VPS holds no credential and does no parsing.
//
// Rules, in the order they apply:
//   - the stop file holds, whichever way the pages come (RedWeek's no is not a route problem);
//   - a run the VPS stopped on a 403 / challenge / robots.txt is RedWeek's no, via the VPS: it writes the stop file here too;
//   - a run it stopped on a timeout or a 429 is RedWeek not answering: nothing is read, and not directly either;
//   - a missing pull, no run, or a run older than two hours: nothing is read. Only then, and only when the
//     back-off of the direct path is not holding, does a direct read happen (sweepVps returns null, and sweep goes on);
//   - an old copy is never presented as a new one: seen_at is the page's own fetchedAt, never the time of the pull.

export const VPS_MAX_AGE_MS = 2 * 3600e3;
/** The VPS's copy is missing, too old, or says RedWeek is not answering. `held`: a direct read is not the answer to it either. */
export class VpsMissing extends Error {
  constructor(why, { held = false, until = null } = {}) { super(why); this.stop = true; this.vps = true; this.held = held; this.until = until; }
}
const RUN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/;
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const arubaStamp = (iso) => { const d = new Date(Date.parse(iso) - 4 * 3600e3).toISOString(); return `${d.slice(8, 10)}/${d.slice(5, 7)} ${d.slice(11, 16)}`; };

/**
 * Pull the VPS's out/ directory into `dir`: rsync over ssh, as user `redweek` with a key that can only read it
 * (the VPS forces `rrsync -ro /srv/redweek/out`, from this address only). The host key is pinned in `knownHosts`.
 */
export function pullFromVps({ dir, host, user = 'redweek', key, knownHosts, timeoutMs = 120000, exec = execFile }) {
  const ssh = `ssh -i ${key} -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${knownHosts} -o ConnectTimeout=15`;
  return new Promise((resolve, reject) => {
    exec('rsync', ['-rt', '--delete', '--exclude=.tmp-*', '-e', ssh, `${user}@${host}:/`, `${dir}/`], { timeout: timeoutMs }, (err, _out, stderr) => {
      if (err) reject(new VpsMissing(`could not pull from the VPS: ${String(stderr || err.message).trim().split('\n')[0].slice(0, 200)}`));
      else resolve();
    });
  });
}

/**
 * The newest run in `dir` (already pulled), read for `slugs`: `{ name, runAt, results }`, one result per slug —
 * `{ slug, html, fetchedAt }` or `{ slug, err }`. Throws RedWeekStop when the VPS was told to stop, VpsMissing when
 * there is nothing to go on. A page whose size or sha256 does not match the manifest is not read.
 */
export function readVpsRun(dir, slugs, { now = Date.now(), maxAgeMs = VPS_MAX_AGE_MS } = {}) {
  let names = [];
  try { names = readdirSync(dir).filter((d) => RUN.test(d)).sort(); } catch { /* no directory yet */ }
  const name = names.pop();
  if (!name) throw new VpsMissing('no run has come from the VPS yet');
  let man;
  try { man = JSON.parse(readFileSync(join(dir, name, 'manifest.json'), 'utf8')); }
  catch { throw new VpsMissing(`the newest run from the VPS (${name}) has no readable manifest`); }
  const mark = man.stop;
  if (mark?.kind === 'stop') stop(`RedWeek told the VPS to stop (${mark.why})`);
  if (mark) throw new VpsMissing(`RedWeek did not answer the VPS: ${mark.why}`, { held: true });
  const age = now - Date.parse(man.runAt);
  if (!(age <= maxAgeMs)) throw new VpsMissing(`the newest run from the VPS is from ${man.runAt || 'an unknown time'}, over ${maxAgeMs / 3600e3} hours old`);
  if (age < -10 * 60e3) throw new VpsMissing(`the newest run from the VPS is dated ${man.runAt}, in the future: the clocks disagree`);

  const pages = new Map((man.pages || []).map((p) => [p.slug, p]));
  const results = slugs.map((slug) => {
    const p = pages.get(slug);
    if (!p) return { slug, err: new Error(`the VPS run has no page for ${slug}`) };
    if (p.status !== 200 || !p.file) return { slug, err: new Error(`RedWeek returned ${p.status || 'nothing'} for ${slug} on the VPS`) };
    let buf;
    try { buf = readFileSync(join(dir, name, basename(p.file))); } catch { return { slug, err: new Error(`the VPS page for ${slug} did not arrive`) }; }
    if (buf.length !== p.bytes || sha256(buf) !== p.sha256) return { slug, err: new Error(`the VPS page for ${slug} does not match its checksum`) };
    const at = Date.parse(p.fetchedAt);
    if (!Number.isFinite(at) || at > now + 10 * 60e3) return { slug, err: new Error(`the VPS page for ${slug} carries no usable time`) };
    return { slug, html: buf.toString('utf8'), fetchedAt: new Date(at).toISOString() };
  });
  return { name, runAt: man.runAt, results };
}

/**
 * sweep()'s VPS branch. Returns the weeks found, `[]` when it reported why nothing was read (through onResort, as a
 * direct read would), or null when the VPS copy is missing and nothing forbids RedWeek being read directly.
 */
export async function sweepVps(slugs, { dir, pull = null, now = Date.now(), maxAgeMs, onResort = () => {}, includeTaken = false, log = () => {} } = {}) {
  let run;
  try {
    const held = stopped();
    if (held) throw new RedWeekStop(`RedWeek stopped us${held.at ? ` on ${held.at}` : ''}: ${held.why}`);
    if (pull) await pull();
    run = readVpsRun(dir, slugs, { now, maxAgeMs });
  } catch (err) {
    if (!err.stop) throw err;
    if (err.vps) {
      const bo = backoff(now);
      const until = err.until || (bo && !bo.expired ? bo.until : null);
      if (err.held || until) { err.held = true; err.until = until; onResort(slugs[0], 0, err); return []; }
      log(`RedWeek: ${err.message} — the back-off does not hold, so reading it directly instead`);
      return null;
    }
    onResort(slugs[0], 0, err);                              // RedWeek's no, or the stop file: the pass ends here
    return [];
  }
  const found = [];
  for (const r of run.results) {
    if (r.err) { onResort(r.slug, 0, r.err); continue; }
    const all = parseRentals(r.html, { slug: r.slug, ourName: ARUBA[r.slug] ?? null });
    if (!all.length && WALL.test(r.html)) {
      try { stop(`RedWeek served a challenge page for ${r.slug} (read via the VPS)`); } catch (err) { onResort(r.slug, 0, err); break; }
    }
    const rows = all.map((l) => ({ ...l, seenAt: r.fetchedAt, via: 'vps', seenNote: `Read off RedWeek's own page via the VPS at ${arubaStamp(r.fetchedAt)} Aruba time` }));
    const list = includeTaken ? rows : rows.filter((x) => !x.taken);
    found.push(...list);
    onResort(r.slug, rows.filter((x) => !x.taken).length, null, { fetchedAt: r.fetchedAt, via: 'vps' });
  }
  return found;
}

/**
 * Every resort we care about, one at a time with a pause. Politeness, not performance.
 * `source: 'vps'` reads the pages the VPS fetched (`vps: { dir, pull }`) instead of asking RedWeek from here.
 */
export async function sweep(slugs = Object.keys(ARUBA), { source = 'direct', vps = {}, pauseMs: pause = pauseMs(), onResort = () => {}, includeTaken = false, log = () => {} } = {}) {
  if (source === 'vps') {
    const got = await sweepVps(slugs, { ...vps, onResort, includeTaken, log });
    if (got) return got;
  }
  const found = [];
  let wait = pause;
  for (const slug of slugs) {
    try {
      const list = await rentals(slug, { includeTaken });
      found.push(...list);
      // How many are OPEN; with includeTaken the list also carries the rented ones, which a re-check of
      // the board needs in order to take their rows down.
      onResort(slug, list.filter((x) => !x.taken).length, null);
      wait = pause;                         // it answered; back to the ordinary pace
    } catch (err) {
      onResort(slug, 0, err);
      // Told to go away, or not answering at all: the other resorts are the same site and get the same answer.
      if (err.stop) break;
      // Being told to slow down and then carrying on at the same rate is how a watcher gets
      // itself blocked. Each refusal doubles the wait, up to two minutes.
      if (/rate-limit|429/i.test(err.message)) wait = Math.min(wait * 2, 120_000);
    }
    if (slug !== slugs[slugs.length - 1]) await new Promise(r => setTimeout(r, wait));
  }
  return found;
}
