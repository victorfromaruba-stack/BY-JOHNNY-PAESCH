// RedWeek: owner rentals at a resort.
//
// No login and no browser. Every listing card carries its own data attributes — check-in,
// check-out, nights, bedrooms, sleeps, view, price, price per night — so this reads structured
// values rather than guessing at text. One request per resort, and it identifies itself.

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';

const BASE = 'https://www.redweek.com';
// A crawler saying who it is, and how to be told to stop, is the polite convention and makes a
// block less likely. Whose address that is, though, is not this file's to decide: set
// WATCH_CONTACT in .env and it goes in, leave it out and nothing personal is sent or published.
const UA = process.env.WATCH_UA
  || `InnerHotelCircleWatcher/1.0 (private travel club${process.env.WATCH_CONTACT ? `; contact ${process.env.WATCH_CONTACT}` : ''})`;

/**
 * Every Aruba resort RedWeek lists, read off their own search page, mapped to the name our
 * catalog uses. Names, not ids: on the live backend every stay has a fresh uuid, so a bundled
 * id like stay_surfclub matches nothing there.
 */
export const ARUBA = Object.freeze({
  'P4872-marriotts-aruba-surf-club': "Marriott's Aruba Surf Club",
  'P148-marriotts-aruba-ocean-club': "Marriott's Aruba Ocean Club",
  'P6494-renaissance-wind-creek-aruba-ocean': 'Renaissance Wind Creek Aruba Resort',
  'P134-barcelo-aruba': 'Barceló Aruba',
  'P146-eagle-aruba-resort': 'Eagle Aruba Resort',
  'P6631-amsterdam-manor-beach-resort': 'Amsterdam Manor Beach Resort',
  'P137-divi-aruba-phoenix-beach-resort': null,
  'P144-divi-dutch-village-beach-resort': null,
  'P5400-divi-village-golf-and-beach-resort': null,
  'P139-caribbean-palm-village': null,
  'P140-casa-del-mar-beach-resort': null,
  'P141-costa-linda-beach-resort': null,
  'P145-la-cabana-beach-resort': null,
  'P147-la-quinta-beach-resort': null,
  'P149-paradise-beach-villas': null,
  'P151-playa-linda-beach-resort': null,
  'P135-aruba-beach-club': null,
  'P4734-the-mill-resort-suites': null,
});

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
const TIMEOUT_CODES = new Set(['UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'ETIMEDOUT', 'ESOCKETTIMEDOUT']);
/** A request that never got an answer: our own clock ran out, or undici's connect/headers/body timer did. */
export function isTimeout(err) {
  const c = err?.cause || err;
  return err?.name === 'AbortError' || err?.name === 'TimeoutError' || TIMEOUT_CODES.has(c?.code) || TIMEOUT_CODES.has(err?.code);
}

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

// What a bot wall looks like when it arrives with a 200. Only believed on a page with no listings
// at all, because a real resort page never shows one of these and a resort with nothing open does
// not need to be mistaken for a wall.
const WALL = /captcha|cf-challenge|challenge-platform|just a moment|access denied|unusual traffic|are you a (?:robot|human)|px-captcha|verify you are human/i;

/**
 * May a program that identifies as `ua` read `path`, by this robots.txt? Longest matching rule
 * wins and Allow beats Disallow on a tie (RFC 9309). The group naming us wins over `*`.
 */
export function robotsAllows(txt, path, ua = UA) {
  const me = String(ua).split(/[\/\s]/)[0].toLowerCase();
  const groups = [];
  let cur = null, lastWasAgent = false;
  for (const raw of String(txt || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'user-agent') {
      if (!lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(v.toLowerCase()); lastWasAgent = true;
    } else if ((k === 'allow' || k === 'disallow') && cur) {
      cur.rules.push({ allow: k === 'allow', path: v }); lastWasAgent = false;
    } else lastWasAgent = false;
  }
  const mine = groups.filter(g => g.agents.includes(me));
  const rules = (mine.length ? mine : groups.filter(g => g.agents.includes('*'))).flatMap(g => g.rules);
  let best = null;
  for (const r of rules) {
    if (!r.path) continue;                                  // "Disallow:" with nothing means allow all
    const re = new RegExp('^' + r.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
    if (!re.test(path)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  return !best || best.allow;
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
  const path = `/resort/${slug}/timeshare-rentals`;
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

/**
 * The pause between two resorts, in ms: WATCH_REDWEEK_PAUSE_SEC, 10 s when it is not set. It was 2.5 s while
 * the watcher read RedWeek every half hour; it reads twice a day now, and slowly (Victor, 22 Oct 2026).
 */
export function pauseMs() {
  const raw = process.env.WATCH_REDWEEK_PAUSE_SEC;
  const s = raw === undefined || raw === '' ? NaN : Number(raw);
  return Number.isFinite(s) && s >= 0 ? s * 1000 : 10000;
}

/** Every resort we care about, one at a time with a pause. Politeness, not performance. */
export async function sweep(slugs = Object.keys(ARUBA), { pauseMs: pause = pauseMs(), onResort = () => {}, includeTaken = false } = {}) {
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
