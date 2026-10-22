// The Interval scan that runs when a member taps a stay.
//
// Victor, 22 Oct 2026, 09:40 and 09:50 (INBOX.md; the interval-board skill, "The line"): "I want the
// watch to watch it moment a member clicks on stays." and "What I want it also scans interval when
// someone clicks stays." He was told the penalty is termination of the VIP Gold membership. The
// permission is for a member's tap and nothing else, and its guardrails are part of it:
//
//   - sign in on the VIP host as the account in the locked box, the way the 17 Oct fixture was
//     obtained (iv-login.js / iv-map.js); add no new evasion                 -> interval-session.mjs
//   - reuse the saved session; at most 3 sign-ins a day                      -> decideSignIn()
//   - 1 scan per resort per 30 minutes, 10 an hour overall; a tap inside the
//     window is served from the last scan                                     -> decideScan()
//   - FULL STOP on a captcha, a challenge, a lock, an "unusual activity" page, a 403, or two refused
//     sign-ins in a row: write the stop flag, raise the interval-watcher card, ONE push to his
//     phone saying why, and never try again until a person deletes the flag   -> classify(), the scanner
//   - when Interval is stopped or capped, the Grab nudge still fires          -> taps.mjs
//
// Dates (Victor, 22 Oct 2026: "I'd like to see a month or two in advance"): a tap carries the dates the member is
// looking for, and the scan searches Getaways for THOSE dates — the form's "Earliest/Latest Travel Date". Interval
// shows at most three rows per resort on a results page, soonest first, so a search over two months shows the next
// three weeks and stops. The scan therefore goes on: when a resort showed a full page, it searches again from that
// resort's last check-in, up to five searches in all. That is still ONE scan: one count against the 30-minute and
// hourly caps, one session, one sign-in at most — a window of 60 days is not 60 scans, and not 8 either.
//
// Nothing here runs on a timer. The only caller is handleTaps() in taps.mjs, through index.mjs, and
// only while WATCH_INTERVAL_SCAN is switched on — which it is not until Victor says so.
//
// Every decision below is a function of a small state file and a clock, so the caps and the stops
// can be argued with in interval-scan.test.mjs without a browser. A state file that exists but cannot
// be read FAILS CLOSED: the caps live in it, so a lost counter must mean "not now", never "zero".

import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { sameName } from './redweek.mjs';
import { readsAsSignedIn } from './interval.mjs';
import { parseGetaways, pageStats, reachedNearby, PAGE_ROWS } from './interval-getaways.mjs';
import { ORIGIN } from './interval-session.mjs';
import { resolveStay } from './judge.mjs';

export const IV_CAPS = Object.freeze({
  resortGapMin: 30,      // one scan per resort per this many minutes, however many taps
  perHour: 10,           // and this many scans an hour in all
  signInsPerDay: 3,      // sign-ins in any rolling 24 hours — attempts, whether or not they worked
  signInGapMin: 30,      // and never two within this long, so two resorts tapped at once are not two attempts
  refusalsToStop: 2,     // refused sign-ins in a row before the stop
});
const MIN = 60e3, HOUR = 3600e3, DAY = 24 * HOUR;

// ---------------------------------------------------------------- the dates: one scan, several searches
export const SCAN = Object.freeze({
  defaultDays: 60,       // a tap with no dates (an older phone) is scanned for today to this many days on
  maxDays: 366,          // and no window is longer than a year
  maxSearches: 5,        // searches in ONE scan: the first, and up to four more for later check-in dates
  maxPages: 3,           // result pages followed after a search, for the island-wide read only
});
const arubaDay = (ms) => new Date(ms - 4 * HOUR).toISOString().slice(0, 10);       // Aruba is UTC-4, no daylight time
const addDay = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const isDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(`${s}T12:00:00Z`));

/**
 * The dates one scan searches for: the member's window, moved to start no earlier than today and cut to a
 * year; and with no usable window (a tap from an older phone, dates the wrong way round, dates that are
 * over) today to `SCAN.defaultDays` on. `asked` says whether it was the member's own.
 */
export function planWindow(win, now = Date.now()) {
  const today = arubaDay(now);
  if (!win || !isDay(win.from) || !isDay(win.to) || win.to < win.from || win.to < today) {
    return { from: today, to: addDay(today, SCAN.defaultDays), asked: false };
  }
  const from = win.from < today ? today : win.from;
  const cap = addDay(from, SCAN.maxDays);
  return { from, to: win.to > cap ? cap : win.to, asked: true };
}

/** Resorts whose page was full, so that later weeks may exist: the rows were cut at PAGE_ROWS, not run out. */
export const saturated = (stats, watch = () => true) =>
  stats.filter((s) => !s.nearby && watch(s.code) && s.rows >= PAGE_ROWS && s.lastCheckIn);

/**
 * Where the NEXT search of this scan starts, or null when nothing is left to look for. The earliest "last
 * check-in" among the resorts that showed a full page is the date up to which nothing is missing; the next
 * search starts there (the same day again, not the day after, so a week at that date that was cut off the
 * bottom is still met). Always moves forward, and never past the window.
 */
export function nextCursor(stats, cursor, to, watch = () => true) {
  const sat = saturated(stats, watch);
  if (!sat.length) return null;
  const last = sat.map((s) => s.lastCheckIn).sort()[0];
  const next = last > cursor ? last : addDay(last, 1);
  const forward = next > cursor ? next : addDay(cursor, 1);
  return forward > to ? null : forward;
}

// ---------------------------------------------------------------- which resort is this stay
/**
 * Interval's own resort codes for the Aruba places the Circle has, with Interval's name for each.
 * Only codes that were READ off a real page: the six from the 17 Oct Aruba search (CPV, DP1, RBK,
 * DV2, LC2, TD4) and DCB from Victor's own screen (interval-board skill). A resort whose code has
 * not been seen is not here, and a tap on it gets the Grab nudge exactly as before. Add a line
 * when a real page shows one — never a guess: a wrong code files another resort's weeks here.
 */
export const INTERVAL_ARUBA = Object.freeze({
  DCB: "Marriott's Aruba Surf Club",
  LC2: 'Eagle Aruba Resort',
  RBK: 'Radisson Blu Aruba',
  CPV: 'Caribbean Palm Village',
  DP1: 'Divi Aruba Phoenix Beach Resort',
  DV2: 'Divi Village Golf and Beach Resort',
  TD4: 'Divi Dutch Village Beach Resort',
});

/** The Interval code for a catalog stay, or null. By the whole name (apostrophes and accents aside) — not "contains". */
export function codeFor(stay, catalog) {
  const row = catalog?.get?.(stay.id) || stay;
  for (const [code, name] of Object.entries(INTERVAL_ARUBA)) if (sameName(row.name, name)) return code;
  return null;
}

// ---------------------------------------------------------------- memory across restarts
export const emptyIvState = () => ({ scans: {}, scanLog: [], signIns: [], refusals: 0, last: {}, cardUp: false });

/** Missing is a first run. Present but unreadable is `broken`, and a broken file stops the scan. */
export function loadIvState(file) {
  if (!existsSync(file)) return emptyIvState();
  try { return { ...emptyIvState(), ...JSON.parse(readFileSync(file, 'utf8')) }; }
  catch { return { ...emptyIvState(), broken: true }; }
}
export function saveIvState(file, state) {
  const { broken, ...clean } = state;
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(clean, null, 1), { mode: 0o600 });
  renameSync(tmp, file);
}

const minsAgo = (now, at) => { const m = Math.floor((now - at) / MIN); return m < 1 ? 'less than a minute' : `${m} min`; };

/**
 * May this resort be scanned now? `covered` means a scan that worked is still current AND searched these dates:
 * serve from it. A scan inside the 30 minutes that searched other dates does not cover this member's, and is
 * not repeated until the 30 minutes are up (the cap is Victor's, and the dates do not move it).
 */
export function decideScan(state, code, now = Date.now(), caps = IV_CAPS, window = null) {
  if (state.broken) return { go: false, covered: false, why: 'the scan\'s state file cannot be read, so its caps cannot be kept — not scanning until it is fixed or deleted' };
  const at = Date.parse(state.scans?.[code] || '');
  if (Number.isFinite(at) && now - at < caps.resortGapMin * MIN) {
    const last = state.last?.[code];
    if (!last?.ok) return { go: false, covered: false, why: `scanned ${minsAgo(now, at)} ago and it did not complete — not asking Interval again yet` };
    const want = planWindow(window, now), had = last.covers;
    if (!had || had.from > want.from || had.to < want.to) {
      const was = had ? `${had.from} to ${had.to}` : 'dates that were not recorded';
      return { go: false, covered: false, why: `scanned ${minsAgo(now, at)} ago for ${was}; ${want.from} to ${want.to} reaches beyond that — not asking Interval again before ${caps.resortGapMin} minutes are up` };
    }
    return { go: false, covered: true, why: `scanned ${minsAgo(now, at)} ago — served from that scan` };
  }
  const recent = (state.scanLog || []).filter((t) => now - Date.parse(t) < HOUR);
  if (recent.length >= caps.perHour) return { go: false, covered: false, why: `${recent.length} Interval scans in the last hour (cap ${caps.perHour})` };
  return { go: true };
}
export function noteScan(state, code, now = Date.now()) {
  const iso = new Date(now).toISOString();
  (state.scans ||= {})[code] = iso;
  state.scanLog = [...(state.scanLog || []).filter((t) => now - Date.parse(t) < HOUR), iso];
}

/** May a sign-in be attempted now? Counted as attempts: a sign-in that crashed halfway still reached Interval. */
export function decideSignIn(state, now = Date.now(), caps = IV_CAPS) {
  const recent = (state.signIns || []).map(Date.parse).filter((t) => now - t < DAY);
  if (recent.length >= caps.signInsPerDay) return { go: false, why: `${recent.length} sign-ins in the last 24 hours (cap ${caps.signInsPerDay})` };
  const last = Math.max(0, ...recent);
  if (last && now - last < caps.signInGapMin * MIN) return { go: false, why: `signed in ${minsAgo(now, last)} ago — not again for ${caps.signInGapMin} min` };
  return { go: true };
}
export function noteSignIn(state, now = Date.now()) {
  state.signIns = [...(state.signIns || []).filter((t) => now - Date.parse(t) < DAY), new Date(now).toISOString()];
}

// ---------------------------------------------------------------- the full stop
// Same pattern as redweek.mjs: remembered in memory and in a 0600 file, so a restart still knows,
// and only a person deleting the file lets it go.
let STOP_FILE = null, memory = null;
export const useIntervalStopFile = (path) => { STOP_FILE = path; memory = null; };
/** The stop in force, `{ at, why }`, or null. A file that exists but cannot be read still counts. */
export function intervalStopped() {
  if (memory && (!STOP_FILE || existsSync(STOP_FILE))) return memory;
  memory = null;
  if (!STOP_FILE || !existsSync(STOP_FILE)) return null;
  try { return JSON.parse(readFileSync(STOP_FILE, 'utf8')); } catch { return { at: null, why: 'the stop file is there' }; }
}
function writeStop(why) {
  memory = { at: new Date().toISOString(), why };
  if (STOP_FILE) { try { writeFileSync(STOP_FILE, JSON.stringify(memory, null, 1), { mode: 0o600 }); } catch { /* memory still holds it */ } }
}
export class IntervalStop extends Error { constructor(why) { super(why); this.stop = true; } }

/**
 * What a bot wall or a lock looks like in the words of a page. Believed on any page the scan reads:
 * a real Getaways page has none of these (the saved 17 Oct search is a test), and a false stop costs
 * Victor one deleted file, where a missed one costs him the membership.
 */
export const WALL = new RegExp([
  'captcha', 'cf-challenge', 'challenge-platform', 'just a moment', 'access denied', 'pardon our interruption',
  'unusual (?:activity|traffic)', 'suspicious activity', 'are you a (?:robot|human)', "verify you(?:'re| are) (?:a )?human",
  'bot (?:manager|detected|protection)', 'automated (?:access|traffic|queries|requests)', 'too many (?:attempts|requests|failed)',
  '(?:account|membership|access|log.?in|sign.?in)[^.\\n]{0,40}(?:locked|suspended|disabled|blocked|restricted)',
  '(?:locked|suspended|disabled|blocked)[^.\\n]{0,20}(?:account|membership)',
].join('|'), 'i');
const SAID_NO = /invalid|incorrect|not recogni[sz]ed|does not match|try again/i;

/**
 * Read one page the session returned: `{ stop }` with the reason, `{ signedIn: true }`, or
 * `{ signedIn: false, said }`. `snap` is { status, title, text, html, captcha, holding }.
 */
export function classify(snap = {}) {
  const words = `${snap.title || ''}\n${snap.text || ''}`;
  if (snap.status === 403) return { stop: 'Interval answered 403' };
  if (snap.status === 429) return { stop: 'Interval answered 429, too many requests' };
  if (snap.captcha) return { stop: 'Interval put up a captcha' };
  const hit = WALL.exec(words);
  if (hit) return { stop: `Interval's page said "${hit[0].toLowerCase().slice(0, 60)}"` };
  if (snap.holding) return { stop: 'Interval kept the browser on a "Please wait" page that did not clear' };
  if (readsAsSignedIn(snap.html || '') === true) return { signedIn: true };
  return { signedIn: false, said: (SAID_NO.exec(words) || [])[0] || null };
}

// ---------------------------------------------------------------- weeks, as finds
/** This resort's weeks off a Getaways results page: its own code, never the "areas surrounding" ones. */
export const weeksFor = (html, code) => parseGetaways(html).filter((w) => w.code === code && !w.nearby);

const arubaStamp = (ms) => { const d = new Date(ms - 4 * HOUR).toISOString(); return `${d.slice(8, 10)}/${d.slice(5, 7)} ${d.slice(11, 16)}`; };

/**
 * The finds the board takes. The reference is the one the Grab path writes for the same week
 * (interval:<place>:<from>:<to> — ingest-deal), so a week grabbed by hand and the same week scanned
 * are ONE week, and the scan moves the clock on it instead of posting it twice. The price is the
 * week's own, in dollars: Interval sells whole weeks, and nothing here divides it into a night
 * except `usdNightly`, which the judge uses for its floor and ceiling.
 */
export function toFinds(weeks, stay, now = Date.now()) {
  return weeks.filter((w) => w.nights > 0 && w.week > 0).map((w) => ({
    source: 'interval', stayId: stay.id, ourName: stay.name, resortName: stay.name,
    from: w.from, to: w.to, nights: w.nights,
    unit: w.allInclusive ? 'All inclusive' : '',
    usdTotal: w.week, usdNightly: Math.round((w.week / w.nights) * 100) / 100,
    externalId: `interval:${stay.id}:${w.from}:${w.to}`,
    url: `${ORIGIN}/web/cs?a=1013&resortCode=${w.code}`,
    seenNote: `Read off Interval's Getaways search at ${arubaStamp(now)} Aruba time, when a member opened this place. Victor confirms it is still there before he quotes anyone`,
  }));
}

export const ARUBA = 'ARUBA';

/**
 * Every week on an Aruba results page that belongs to a place the catalog has: Interval's code first
 * (the exact name in INTERVAL_ARUBA), then the name on the page, the way the board places every other
 * find. The rest — a place not in the catalog — is named, never posted: a week must belong to a stay.
 */
export function arubaFinds(html, catalog, now = Date.now()) {
  const rows = [...catalog.values()];
  const stayOf = (w) => {
    const ours = INTERVAL_ARUBA[w.code];
    const byCode = ours && rows.find((r) => sameName(r.name, ours));
    if (byCode) return byCode;
    const id = resolveStay({ resortName: w.resort }, catalog);
    return id ? catalog.get(id) : null;
  };
  const weeks = parseGetaways(html), finds = [], unplaced = [];
  for (const w of weeks) {
    const stay = stayOf(w);
    if (stay) finds.push(...toFinds([w], stay, now)); else unplaced.push(`${w.resort || w.code} (${w.code})`);
  }
  return { finds, rows: weeks.length, unplaced };
}

// ---------------------------------------------------------------- the push and the card when it stops
/**
 * What happens ONCE, on the call that writes the flag: the interval-watcher card goes up, and one
 * push says it stopped and why — held until seven if it is the middle of the night (tellOrHold).
 * Later taps find the flag and say nothing.
 */
export function makeStopAnnouncer({ putCard, tell }) {
  return async (why) => {
    putCard('interval-watcher', {
      title: 'Interval stopped the watcher',
      detail: `${why}. Nothing touches Interval until circle/watcher/.interval-stop.json is deleted.`,
      since: intervalStopped()?.at || undefined,
    });
    await tell({ title: 'Interval stopped the watcher', priority: 4,
      body: `${why}. No more Interval scans until you delete .interval-stop.json in circle/watcher. The Grab nudge still works.` });
  };
}

// ---------------------------------------------------------------- the scan
class Soft extends Error {}          // something went wrong that is not a stop: say it, count it, do not retry

/**
 * Build the scan a tap runs. Returns `async scan(stay, catalog)` -> `{ ran, covered, stopped?, why?, rows?, posted?, refreshed? }`:
 *   ran      a Getaways search was actually made
 *   covered  Interval has been read for this place within the window and it worked, so there is
 *            nothing for Victor to go and look at (taps.mjs then skips the Grab nudge)
 *
 * `makeSession()` is the browser (interval-session.mjs), `post({ finds, catalog })` is the
 * board's door (board.mjs), `onStop(why)` raises the card and the push. All three are injected so
 * the proof can run the whole path against stubs.
 */
export function makeIntervalScanner({ armed = () => true, stateFile, makeSession, post, onStop, onGood = async () => {},
                                      log = () => {}, now = Date.now, caps = IV_CAPS, canSignIn = true, maxSearches = SCAN.maxSearches }) {
  let busy = false;
  /**
   * One scan, whatever it searches for. `key` is what the caps count it under (a resort code, or ARUBA
   * for the whole-island read); `search(session, { from, to })` makes ONE search for those check-in dates;
   * `finds(html)` turns a results page into `{ finds, rows, unplaced }`; `watch(code)` says which resorts'
   * full pages mean "there may be more weeks". `window` is the member's dates (or null). Everything between
   * is the box: stopped?, capped?, session, sign-in cap, full stop. The searches after the first are part
   * of the same scan, not new ones.
   */
  async function run(key, { search, finds: gather, catalog, window = null, watch = () => true, paged = false }) {
    const code = key;
    const held = intervalStopped();
    if (held) return { ran: false, covered: false, stopped: true, why: `stopped${held.at ? ` since ${held.at}` : ''} (${held.why}) — delete .interval-stop.json to let it` };
    if (busy) return { ran: false, covered: false, why: 'another scan is still running' };
    const state = loadIvState(stateFile);
    const t = now();
    const d = decideScan(state, code, t, caps, window);
    if (!d.go) return { ran: false, covered: d.covered, why: d.why };
    const plan = planWindow(window, t);

    busy = true;
    let session = null, spent = false;
    // The counters are written BEFORE the request they limit, so a crash mid-request has still spent it.
    const persist = () => { try { saveIvState(stateFile, state); return true; } catch (err) { log(`  Interval: could not save ${stateFile} (${err.message})`); return false; } };
    const record = (r) => { state.last[code] = { at: new Date(t).toISOString(), ...r }; persist(); };
    try {
      session = makeSession();
      await session.open();            // a missing browser or an empty locked box fails here, before any Interval traffic
      noteScan(state, code, t); spent = true;
      if (!persist()) throw new Soft('the scan\'s caps could not be written down, so it did not go');

      let signedIn = false;
      if (session.hasSaved()) {
        log(`  Interval: reusing the saved session`);
        const snap = await session.landing();
        const v = classify(snap);
        if (v.stop) throw new IntervalStop(v.stop);
        signedIn = !!v.signedIn;
        if (!signedIn) { session.forget(); log('  Interval: the saved session has expired'); }
      }
      if (!signedIn && !canSignIn) {
        // A run that is not a member's tap (the one-off whole-island read) never signs in: it uses the
        // session somebody else saved, and when there is none it says so and stops there.
        record({ ok: false, why: 'no usable saved session' });
        return { ran: false, covered: false, noSession: true, why: 'there is no usable saved Interval session, and this run does not sign in' };
      }
      if (!signedIn) {
        const sd = decideSignIn(state, t, caps);
        if (!sd.go) { record({ ok: false, why: sd.why }); return { ran: false, covered: false, why: `needs a sign-in, and ${sd.why}` }; }
        noteSignIn(state, t);
        if (!persist()) throw new Soft('the sign-in cap could not be written down, so it did not go');
        log('  Interval: signing in');
        const si = await session.signIn({ guard: (snap) => !!classify(snap).stop });
        const v = classify(si);
        if (v.stop) throw new IntervalStop(v.stop);
        if (si.noForm) throw new Soft('the sign-in form was not on the login page');
        if (!v.signedIn) {
          state.refusals = (state.refusals || 0) + 1;
          persist();
          if (state.refusals >= caps.refusalsToStop) throw new IntervalStop(`Interval refused the sign-in ${state.refusals} times in a row`);
          throw new Soft(`Interval did not sign the watcher in${v.said ? ` (it said "${v.said}")` : ''}; a second refusal in a row stops the scan for good`);
        }
        state.refusals = 0; persist();
        await session.save();
        log('  Interval: signed in, session saved');
        const lp = await session.landing();
        const lv = classify(lp);
        if (lv.stop) throw new IntervalStop(lv.stop);
        if (!lv.signedIn) throw new Soft('signed in, but the next page read as signed out');
      }

      // The searches of this scan. Each is judged on its own: a wall, a stop or a signed-out page ends it.
      const check = (res) => {
        const v = classify(res);
        if (v.stop) throw new IntervalStop(v.stop);
        if (!v.signedIn) { session.forget(); throw new Soft('the session was signed out by the time the search ran'); }
      };
      const found = new Map(), placeless = [];
      let weeks = 0, searches = 0, cursor = plan.from, coversTo = plan.to;
      log(`  Interval: searching ${code === ARUBA ? 'Aruba' : code} for ${plan.from} to ${plan.to}${plan.asked ? '' : ' (no dates were given)'}`);
      for (;;) {
        const pages = [await search(session, { from: cursor, to: plan.to })];
        check(pages[0]);
        if (searches === 0) await session.save();
        // The island-wide read can run to several pages of ten resorts. Follow the page's own "Next Page" while the
        // places are still the ones asked for — never into "Areas Surrounding" — and never past the page cap.
        while (paged && pages.length < SCAN.maxPages && !reachedNearby(pages.at(-1).html)) {
          const more = await session.nextPage();
          if (!more) break;
          check(more);
          pages.push(more);
        }
        searches++;
        for (const pg of pages) {
          const g = gather(pg.html, t);
          weeks += g.rows;
          for (const f of g.finds) if (!found.has(f.externalId)) found.set(f.externalId, f);
          placeless.push(...(g.unplaced || []));
        }
        const stats = pages.flatMap((pg) => pageStats(pg.html));
        const next = nextCursor(stats, cursor, plan.to, watch);
        if (!next) break;
        if (searches >= maxSearches) {
          // Stopped by the cap, not by running out: say how far the weeks are known, so nothing claims the rest.
          coversTo = saturated(stats, watch).map((s) => s.lastCheckIn).sort()[0] || coversTo;
          log(`  Interval: ${searches} searches is the most one scan makes — weeks are known up to ${coversTo}, not to ${plan.to}`);
          break;
        }
        log(`  Interval: a resort showed a full page, so there may be more weeks — searching again from ${next}`);
        cursor = next;
      }
      const finds = [...found.values()], unplaced = placeless;
      if (unplaced.length) log(`  Interval: ${unplaced.length} week${unplaced.length === 1 ? '' : 's'} at places not in the catalog — add them in the Desk to see them here: ${[...new Set(unplaced)].slice(0, 8).join('; ')}`);
      let out = { posted: 0, refreshed: 0 };
      try { if (finds.length) out = await post({ finds, catalog }) || out; }
      catch (err) { throw new Soft(`Interval was read (${weeks} week${weeks === 1 ? '' : 's'}) but the board would not take them: ${err.message}`); }
      const wasUp = state.cardUp; state.cardUp = false;
      record({ ok: true, rows: weeks, posted: out.posted || 0, refreshed: out.refreshed || 0, searches, covers: { from: plan.from, to: coversTo } });
      if (wasUp) await onGood();
      return { ran: true, covered: true, rows: weeks, posted: out.posted || 0, refreshed: out.refreshed || 0, unplaced: unplaced.length, searches, window: { from: plan.from, to: plan.to } };
    } catch (err) {
      if (err instanceof IntervalStop) {
        writeStop(err.message);
        state.cardUp = true;
        record({ ok: false, why: err.message });
        log(`  Interval: STOPPED — ${err.message}. Nothing will ask Interval again until the stop file is deleted.`);
        try { await onStop(err.message); } catch (e) { log(`  Interval: the stop is written but telling Victor failed (${e.message})`); }
        return { ran: true, covered: false, stopped: true, why: err.message };
      }
      const why = String(err.message || err).split('\n')[0].slice(0, 240);
      record({ ok: false, why });
      return { ran: spent, covered: false, why };
    } finally {
      busy = false;
      await session?.close().catch(() => {});
    }
  }

  const off = { ran: false, covered: false, why: 'the Interval scan is switched off (WATCH_INTERVAL_SCAN is not on)' };

  /** A member opened this place, looking for `window`: scan its resort, by its code, for those dates. */
  const scan = async (stay, catalog, window = null) => {
    if (!armed()) return off;
    const code = codeFor(stay, catalog);
    if (!code) return { ran: false, covered: false, why: 'no Interval resort code is on file for this place' };
    return run(code, {
      catalog, window,
      search: (session, range) => session.search(code, range),
      finds: (html, t) => { const weeks = weeksFor(html, code); return { finds: toFinds(weeks, stay, t), rows: weeks.length }; },
      watch: (c) => c === code,
    });
  };

  /**
   * A member opened the Stays LIST, looking for `window`: Getaways searches for Aruba — the form as Interval
   * offers it, "Single Destination: Aruba" — and every week at a place the catalog has goes to the board. It is
   * one scan under the key ARUBA with the same caps (one per 30 minutes, ten an hour), so a list opened ten times
   * is one read.
   */
  scan.aruba = async (catalog, window = null) => {
    if (!armed()) return off;
    return run(ARUBA, {
      catalog, window, paged: true,
      search: (session, range) => session.search('Aruba', { city: true, ...range }),
      finds: (html, t) => arubaFinds(html, catalog, t),
      watch: (c) => Object.hasOwn(INTERVAL_ARUBA, c),
    });
  };
  return scan;
}
