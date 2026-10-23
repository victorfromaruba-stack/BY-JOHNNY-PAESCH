#!/usr/bin/env node
// The Circle's watcher. Runs on Victor's VPS, checks what is open, puts the good ones on the
// board so Ian and Victor can book them the moment they appear.
//
//   node index.mjs --once      one pass, then stop  (start here)
//   node index.mjs             every WATCH_EVERY_MIN minutes, forever
//   node index.mjs --dry       find and print, post nothing
//   node index.mjs --redweek   one RedWeek pass (read, judge, post, re-check the board) and stop; never touches Interval. With --dry, posts nothing
//   node index.mjs --dump      save what a signed-in Interval session sees, then stop
//   node index.mjs --interval-read --confirm   one read of Aruba Getaways on a saved session (never signs in; see intervalRead)
//
// RedWeek needs no login and is read by two scheduled passes a day, at 06:00 and 18:00 Aruba time
// (WATCH_REDWEEK_TIMES): every resort, ten seconds apart, the whole board compared with it. A timeout
// stops the pass and backs RedWeek off for a day. With WATCH_REDWEEK_SOURCE=vps the pages are fetched by Victor's
// VPS ten minutes earlier and pulled from it (vps/fetch.mjs, README "RedWeek from the VPS"); this box asks RedWeek nothing. Interval is signed into only on a run a person
// started — --once or --dump — and never by the service; a member's tap can scan it, inside the caps
// (interval-scan.mjs). See "Interval by hand" below.
//
// Everything it needs is in .env next to this file. Nothing is written down anywhere else.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sweep, ARUBA, useStopFile, stopped, backoff, useBackoffFile, pullFromVps } from './redweek.mjs';
// The two daily times RedWeek is read at, and whether the last of them has been served.
import { parseTimes, due, lastSlot, nextSlot, arubaClock } from './schedule.mjs';
import { Interval } from './interval.mjs';
import { Circle } from './circle.mjs';
import { loadEnv } from './dotenv.mjs';
import { putCard as putCardTo } from './cards.mjs';
// The Interval scan a member's tap can set off (Victor, 22 Oct 2026), its browser, and its full stop. Off until WATCH_INTERVAL_SCAN says on.
import { makeIntervalScanner, makeStopAnnouncer, useIntervalStopFile, intervalStopped } from './interval-scan.mjs';
import { IntervalSession } from './interval-session.mjs';
// Which catalog place a name belongs to. The rest of judge.mjs (what goes up, and what it looks like) runs in board.mjs.
import { resolveStay, inHorizon } from './judge.mjs';
// What happens to finds once they are found: judged, posted, last-seen clocks moved. Shared with the Interval scan.
import { judgeAndPost, verifyBoard } from './board.mjs';
// How many times in a row Interval said no. Pure, and on trial in pace.test.mjs. The `due`
// gate it also exports is not read here any more: nothing signs in on a timer for it to hold
// back. What is left is the count, which is what the next run by hand wants to be told.
import { loadPace, savePace, refused as refusedPace, failed as failedPace, accepted as acceptedPace, cardFor } from './pace.mjs';
// What a member opening a stay sets off: the dates they are looking for go to the Interval scan (inside its
// caps), and a nudge to Victor's phone when Interval is stale there. No RedWeek read, no sign-in of its own. See taps.mjs.
import { loadState as loadTapState, saveState as saveTapState, noteSwept, noteRedweekScan, lastRedweekRead, noteBoard, decideBoard, slugFor, handleTaps, makePusher, flushHeld, tellOrHold } from './taps.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// Where the Interval pace lives between passes and across restarts. Git-ignored, like .env.
const PACE_FILE = join(HERE, '.interval-pace.json');
// RedWeek's "no". While this file exists nothing reads RedWeek; only Victor deletes it.
const STOP_FILE = join(HERE, '.redweek-stop.json');
// RedWeek's silence: a request that timed out. While this file says `until` is ahead nothing reads RedWeek;
// when it has run out, ONE probe decides whether to resume. A person can end it early by deleting it.
const BACKOFF_FILE = join(HERE, '.redweek-backoff.json');
// When each resort was last read, which taps have cost a read this hour, who was nudged and when.
const TAPS_FILE = join(HERE, '.taps-state.json');
// Interval's "no", written by the scan (interval-scan.mjs). While this file exists nothing asks Interval
// anything, by a tap or by hand; only Victor deletes it. Beside it: the scan's caps and counters, and the
// saved session (cookies, 0600). All three are git-ignored.
const IV_STOP_FILE = join(HERE, '.interval-stop.json');
const IV_STATE_FILE = join(HERE, '.interval-scan.json');
const IV_SESSION_FILE = join(HERE, '.interval-session.json');
const args = new Set(process.argv.slice(2));
const ONCE = args.has('--once'), DRY = args.has('--dry'), DUMP = args.has('--dump'), REDWEEK = args.has('--redweek');

// .env, beside this file. Shared with the tests (dotenv.mjs) so they run with the same choices.
loadEnv(join(HERE, '.env'));

// Where RedWeek is read from. 'vps': Victor's VPS fetches the pages twice a day and this box pulls them over the
// tailnet with a read-only key (redweek.mjs, "Source: the VPS"). 'direct' (the default): this box asks RedWeek itself.
const SOURCE = /^vps$/i.test(process.env.WATCH_REDWEEK_SOURCE || '') ? 'vps' : 'direct';
const VPS_DIR = process.env.WATCH_VPS_DIR || join(HERE, '.vps-redweek');
const VPS = {
  dir: VPS_DIR,
  pull: () => pullFromVps({
    dir: VPS_DIR, host: process.env.WATCH_VPS_HOST || '100.122.79.25', user: process.env.WATCH_VPS_USER || 'redweek',
    key: process.env.WATCH_VPS_KEY || '/root/.ssh/vps_redweek', knownHosts: process.env.WATCH_VPS_KNOWN_HOSTS || '/root/.ssh/vps_redweek_known_hosts',
  }),
};

// A number the file actually set, even when it set it to zero. `Number(x) || d` would read
// WATCH_BEAT_BY_PCT=0 as "unset" and quietly put the default of 15% back.
const num = (k, d) => {
  const n = Number(process.env[k]);
  return process.env[k] !== undefined && process.env[k] !== '' && Number.isFinite(n) ? n : d;
};
const flag = (k, d) => (process.env[k] === undefined || process.env[k] === '' ? d : !/^(false|no|0|off)$/i.test(process.env[k]));
const CFG = {
  everyMin:      num('WATCH_EVERY_MIN', 30),
  maxNightly:    num('WATCH_MAX_NIGHTLY_USD', 0),   // 0 = no ceiling
  // The sanity ceiling, apart from the one above: a price over this a night is a broken listing, not a find.
  maxPlausibleNightly: num('WATCH_MAX_PLAUSIBLE_NIGHTLY_USD', 1500),
  minNights:     num('WATCH_MIN_NIGHTS', 0),
  onlyOurStays:  flag('WATCH_ONLY_OUR_STAYS', true),
  pointsPerUsd:  num('CIRCLE_POINTS_PER_DOLLAR', 100),
  // Owner weeks (RedWeek) go up only when they undercut the resort's PUBLIC rate by this much,
  // and only the cheapest few per resort per month. Interval is never filtered: every Getaway at
  // one of our places is news. Without the cap it finds a hundred open weeks a day, which is a
  // list, not news.
  mustBeatOurs:  flag('WATCH_MUST_BEAT_OURS', true),
  beatBy:        num('WATCH_BEAT_BY_PCT', 15) / 100,
  maxPerResortMonth: num('WATCH_MAX_PER_RESORT_MONTH', 3),
  // How far ahead the RedWeek scan reports on, in days (Victor, 22 Oct 2026: the board is never only "next week").
  // The scan reads each resort's whole page, so this is what it says about, not a limit on what it posts.
  horizonDays:   num('WATCH_HORIZON_DAYS', 90),
  // The longest a refused Interval sign-in waits before the next attempt. A day by default.
  intervalRetryMaxMin: num('WATCH_INTERVAL_RETRY_MAX_MIN', 24 * 60),
};

// When RedWeek is read: twice a day, Aruba time. WATCH_EVERY_MIN no longer sets this.
const TIMES = parseTimes(process.env.WATCH_REDWEEK_TIMES);

const log = (...a) => console.log(new Date().toISOString().slice(0, 19).replace('T', ' '), ...a);

// The card for Victor's dashboard: cards.mjs, through premanifest-bot's alerts module.
const putCard = (key, card) => putCardTo(key, card, log);
const intervalCard = (state) => putCard('interval-watcher', cardFor(state));
const redweekCard = (held) => putCard('redweek-watcher', held && { title: 'RedWeek told the watcher to stop', detail: `${held.why}. Nothing reads RedWeek until circle/watcher/.redweek-stop.json is deleted.`, since: held.at || undefined });

const tapState = loadTapState(TAPS_FILE);
const pusher = makePusher();
useStopFile(STOP_FILE);
useBackoffFile(BACKOFF_FILE);
useIntervalStopFile(IV_STOP_FILE);

// Tell the stay page that RedWeek was read: one row per place, which it prints as "Checked 4 min
// ago". Only for resorts that answered; a read that failed is not a check. Whatever happens to the
// rest of the pass, the read itself happened, so this runs on every way out of it.
const warned = new Map();
const warnOnce = (key, text) => { if (Date.now() - (warned.get(key) || 0) > 36e5) { warned.set(key, Date.now()); log(text); } };
async function stampChecked(circle, ctx) {
  try {
    if (!DRY && circle && ctx.catalog && ctx.ok.length) {
      for (const slug of ctx.ok) {
        const id = resolveStay({ ourName: ARUBA[slug] }, ctx.catalog);
        if (!id) continue;
        const info = ctx.info.get(slug);
        try { await circle.markChecked(id, info ? { at: info.fetchedAt, via: info.via } : undefined); }
        catch (err) { warnOnce('checks', `  could not record that ${slug} was read (${err.message}) — the stay page will not say "Checked" until supabase/migrations/20261022_stay_taps.sql is applied`); break; }
      }
    }
    if (circle?.noVia) warnOnce('via', 'the database does not take the time and source of a RedWeek check yet — paste supabase/migrations/20261026_redweek_via.sql into the SQL editor. Until then the Stays line reads "RedWeek checked at <the time the watcher recorded it>" without "(via VPS)".');
  } finally { try { saveTapState(TAPS_FILE, tapState); } catch (err) { log(`  could not save ${TAPS_FILE} (${err.message})`); } }
}

async function announceStop(err) {
  log(`RedWeek: STOPPED — ${err.message}. Nothing will read RedWeek again until ${STOP_FILE} is deleted.`);
  redweekCard(stopped());
  await tellOrHold(tapState, pusher, { title: 'RedWeek told the watcher to stop', priority: 4,
    body: `${err.message}. The watcher has stopped reading RedWeek and will not try again. Delete .redweek-stop.json in circle/watcher to let it${SOURCE === 'vps' ? ' (and /srv/redweek/state/halt.json on the VPS)' : ''}.` }, log);
}


/**
 * What is holding RedWeek back right now, or null: the stop file (it told us to go away) or a back-off that has
 * not run out (it did not answer). Both mean the same thing to everything that would ask it anything.
 */
function redweekHold() {
  const s = stopped();
  if (s) return { kind: 'stop', why: `stopped${s.at ? ` since ${s.at}` : ''} (${s.why}); delete ${STOP_FILE} to let it` };
  // The back-off is about this box's own requests. Reading the VPS's copy makes none, so it does not hold that;
  // sweep() weighs it itself when the copy is missing and a direct read would be the fallback.
  if (SOURCE === 'vps') return null;
  const b = backoff();
  if (b && !b.expired) return { kind: 'backoff', why: `did not answer${b.at ? ` on ${b.at}` : ''} (${b.why}); backed off until ${b.until}`, until: b.until };
  return null;
}

/**
 * Tell the Circle whether RedWeek is reachable, so a week's seven days stop running while it is not (the
 * 20261022_source_outage.sql functions) and the Stays page can say so. `since` is the last time RedWeek was
 * known to answer — the watcher's own last read. Idempotent, quiet when the migration is not applied yet.
 */
async function reportRedweek(circle, down, why) {
  if (DRY || !circle) return;
  try {
    if (down) await circle.markSourceUnreachable('redweek', lastRedweekRead(tapState), why);
    else await circle.markSourceReachable('redweek');
  } catch (err) {
    if (err.code === 'PGRST202' || err.status === 404) warnOnce('outage', "RedWeek's reachability was not recorded: paste supabase/migrations/20261022_source_outage.sql into the SQL editor. Until then the seven-day clock keeps running while RedWeek is out.");
    else warnOnce('outage-err', `could not record RedWeek's reachability (${err.message})`);
  }
}

/**
 * One look at the world. `redweek: false` is the pass a member's tap on the Stays list asks for: it reads no
 * RedWeek at all (RedWeek is read twice a day) and re-checks the board against what the Circle already holds —
 * the floor and the ceiling on every watched price, the seven-day rule. `fromTap` keeps the by-hand Interval
 * chain below out of reach: a member's tap never enters it.
 */
async function pass(circle, opts = {}) {
  const ctx = { ok: [], info: new Map(), catalog: null };       // info: slug -> { fetchedAt, via } for a page read off a copy
  try { return await passBody(circle, opts, ctx); }
  finally { await stampChecked(circle, ctx); }
}

async function passBody(circle, { redweek = true, fromTap = false } = {}, ctx) {
  const found = [];

  const slugs = CFG.onlyOurStays ? Object.keys(ARUBA).filter(s => ARUBA[s]) : Object.keys(ARUBA);
  let wall = null, silent = null, gone = null;
  let rwAll = [];           // everything RedWeek showed this pass, rented weeks included: the re-check of the board reads it
  if (redweek) {
    const hold = redweekHold();
    if (hold) {
      // One line a pass, and not one request. The Circle is told so the weeks are shown as last seen and their clock waits.
      log(`RedWeek: ${hold.kind === 'stop' ? 'stopped' : 'backed off'} — ${hold.why}. Not read this pass; the board's RedWeek weeks stay as last seen.`);
      if (hold.kind === 'stop') redweekCard(stopped());
      await reportRedweek(circle, true, hold.kind === 'stop' ? 'RedWeek told the watcher to stop' : 'RedWeek did not answer');
    } else {
      if (SOURCE !== 'vps' && backoff()) log('RedWeek: the back-off has run out — one probe request decides whether to resume');
      log(SOURCE === 'vps' ? "RedWeek: pulling the VPS's copy of the pages" : 'RedWeek: scanning');
      noteRedweekScan(tapState);
      rwAll = await sweep(slugs, {
        includeTaken: true,        // rented weeks are what take a row down; worthPosting never lets one up
        source: SOURCE, vps: VPS, log,
        onResort: (slug, n, err, info) => {
          log(`  ${err ? 'x' : ' '} ${slug.padEnd(44)} ${err ? err.message : `${n} open${info ? ` (fetched ${info.fetchedAt.slice(11, 16)}Z via ${info.via.toUpperCase()})` : ''}`}`);
          if (err?.vps) gone = err;
          else if (err?.backoff) silent = err;
          else if (err?.stop) wall = err;
          else if (!err) { ctx.ok.push(slug); if (info) ctx.info.set(slug, info); noteSwept(tapState, slug, info ? Date.parse(info.fetchedAt) : Date.now()); }
        },
      });
      found.push(...rwAll);
      if (wall) await announceStop(wall);
      else if (gone) log(`RedWeek: nothing read this pass — ${gone.message}${gone.until ? `; this box is backed off until ${gone.until}, so it does not read RedWeek directly either` : ''}. The board's RedWeek weeks stay as last seen.`);
      else if (silent) log(`RedWeek: did not answer — the rest of this pass is skipped, and nothing asks it again until ${silent.until}`);
      else if (ctx.ok.length) redweekCard(null);
      if (ctx.ok.length) await reportRedweek(circle, false);
      else if (wall || silent || gone) await reportRedweek(circle, true, wall ? 'RedWeek told the watcher to stop' : gone ? gone.message.slice(0, 160) : 'RedWeek did not answer');
    }
  }

  // INTERVAL, BY HAND AND ONLY BY HAND.
  //
  // Interval is off unless it is deliberately switched on, and having a username set is not
  // deliberate enough. RedWeek needs no login, works today, and finds around 138 open weeks a
  // pass across the six resorts — so the timer does the watcher's job either way, and Interval
  // is a separate decision rather than a blocker. See the README on what that decision involves.
  //
  // The part of that decision the code does not get to make: a sign-in to Interval on a timer
  // is the exact pattern their bot management exists to catch, and the penalty in the
  // membership terms is termination, not a warning. Victor's VIP Gold membership is the
  // Circle's entire supply of cheap weeks — lose it and there is no board left to keep fresh.
  // The browser client goes further still: its own comments describe waiting out Radware's
  // interstitial until the __uzm cookies are minted. That is working around bot management, and
  // it was happening unattended every half hour on a machine nobody watches, because the
  // service loop imported it like any other pass.
  //
  // So the sign-in happens on a run a person started and at no other time. `--once` and
  // `--dump` behave exactly as they did. The service sweeps RedWeek and says plainly what it is
  // not doing. WATCH_INTERVAL=on still carries Victor's decision that Interval is worth
  // looking at; it no longer means a timer looks on his behalf.
  //
  // The pace file (pace.mjs) outlives this: its refusal count is what the next run by hand is
  // told on the way in. Its wait is not consulted, because nothing is waiting to try.
  const wantsInterval = /^(1|on|true|yes)$/i.test(process.env.WATCH_INTERVAL || '');
  const pace = loadPace(PACE_FILE);
  const byHand = (ONCE || DUMP) && !REDWEEK;           // --redweek is a run by hand that never signs in to Interval
  const refusalsSaid = (n) => `${n} time${n === 1 ? '' : 's'} in a row`;
  if (fromTap) {
    // A member's tap. Not a word about Interval here, and no way into the sign-in below.
  } else if (!wantsInterval) {
    log('Interval: off (WATCH_INTERVAL is not set) — RedWeek only');
  } else if (intervalStopped()) {
    // The scan's full stop covers a sign-in by hand too: whatever Interval put up is still there.
    log(`Interval: stopped (${intervalStopped().why}) — not signing in. Delete ${IV_STOP_FILE} to let it.`);
  } else if (!process.env.INTERVAL_USER) {
    log('Interval: no INTERVAL_USER set, skipping');
  } else if (!byHand) {
    log('Interval: signed into by hand only, never on this timer — run `node index.mjs --once` when you want a look. RedWeek is read at its two scans a day.'
      + (pace.refusals ? ` (the last attempt was refused, ${refusalsSaid(pace.refusals)})` : ''));
  } else {
    let iv = null;
    try {
      // Interval needs a real browser and RedWeek does not. Two of the three things standing
      // between us and the Getaway pages — the script that moves the session to the VIP host,
      // and the Radware challenge that mints the __uzm cookies — only happen in a page. Set
      // WATCH_INTERVAL_MODE=fetch to use the old plain-HTTP client, which is kept because its
      // anonymous fetches are what the dump compares against.
      const mode = process.env.WATCH_INTERVAL_MODE || 'browser';
      log(`Interval: signing in (${mode})`);
      if (mode === 'browser') {
        const { IntervalBrowser } = await import('./interval-browser.mjs');
        iv = new IntervalBrowser({ username: process.env.INTERVAL_USER, password: process.env.INTERVAL_PASS });
      } else {
        iv = new Interval({ username: process.env.INTERVAL_USER, password: process.env.INTERVAL_PASS });
      }
      if (DUMP) {
        const dir = join(HERE, 'dump');
        mkdirSync(dir, { recursive: true });
        for (const [p, html] of Object.entries(await iv.dump())) {
          const f = join(dir, p.replace(/\W+/g, '_') + '.html');
          writeFileSync(f, html);
          log(`  saved ${f}  (${html.length} bytes)`);
        }
        // Say plainly whether it got in. The note file carries the detail; this is the line
        // you read on the terminal without opening anything.
        const note = (await import('node:fs')).readFileSync(join(dir, '02_what_happened.html'), 'utf8');
        const got = /signed in:\s+true/.test(note);
        log(got ? '  signed in — the Getaway pages are in dump/, send them over.'
                : '  Interval did NOT sign us in: the pages behind the login still offer a way IN.');
        // The dump now fetches the same pages twice — once signed in, once with no login at
        // all — so this line is the answer rather than the start of another guess.
        if (/IDENTICAL to the anonymous fetch/.test(note)) {
          log('  Every page came back byte-identical to the anonymous fetch, so the password was not accepted.');
        }
        log('  02_what_happened.html has every hop and the two runs side by side.');
        log('  No password is in any of those files.');
        return { found: [], posted: 0 };
      }
      const today = new Date(), plus = new Date(Date.now() + num('WATCH_WINDOW_DAYS', 120) * 864e5);
      const soon = new Date(Date.now() + num('WATCH_INTERVAL_SOON_DAYS', 14) * 864e5);
      const iso = (d) => d.toISOString().slice(0, 10);
      // The next fortnight first, on its own: a Getaway that starts today or this week is the one
      // Victor rings about now, and a results page for four months may not carry it (one page,
      // sorted their way). Then the long window. The same week from both is one find.
      const near = await iv.getaways({ from: iso(today), to: iso(soon), guests: num('WATCH_GUESTS', 2) });
      const far = await iv.getaways({ from: iso(today), to: iso(plus), guests: num('WATCH_GUESTS', 2) });
      const seenIds = new Set();
      const got = [...near, ...far].filter(g => { const k = g.externalId || `${g.resortName}|${g.from}|${g.to}`; if (seenIds.has(k)) return false; seenIds.add(k); return true; });
      log(`  ${got.length} Getaway weeks (${near.length} check in within ${num('WATCH_INTERVAL_SOON_DAYS', 14)} days)`);
      // ourName is what the catalog is matched on below. Interval calls it resortName, and
      // without this every Getaway week would fail to price and be dropped by onlyOurStays.
      found.push(...got.map(g => ({ ...g, stayId: null, ourName: g.resortName || null })));
      // It got in. Whatever the pace was, it is every pass again.
      if (pace.refusals) log(`  Interval signed the watcher in after ${pace.refusals} refusal${pace.refusals === 1 ? '' : 's'} — back to every pass`);
      savePace(PACE_FILE, acceptedPace());
      intervalCard(acceptedPace());
    } catch (err) {
      if (err.needsDump) {
        // It signed in; only the search page is unset. Not a refusal, so not a longer wait.
        log(`  Interval: ${err.message}`);
        savePace(PACE_FILE, acceptedPace());
        intervalCard(acceptedPace());
      } else if (err.needsBrowser) {
        // Every failed run counts toward the card, not only a refusal: a browser that will not
        // start was as silent for eight days as a refused password, and read just as routine.
        const next = failedPace(pace, { said: err.message });
        savePace(PACE_FILE, next); intervalCard(next);
        log(`  Interval needs a browser: ${err.message}`);
        log(`  Install it with: npx playwright install ${process.env.WATCH_BROWSER || 'chromium'}   (or set WATCH_INTERVAL_MODE=fetch)`);
      } else if (err.refused) {
        const next = refusedPace(pace, { everyMin: CFG.everyMin, maxMin: CFG.intervalRetryMaxMin, said: err.message });
        savePace(PACE_FILE, next); intervalCard(next);
        log(`  Interval refused the sign-in (${refusalsSaid(next.refusals)}): ${err.message}`);
        // No "next try" line any more: nothing tries on its own, so naming an hour would be
        // promising something no timer is going to keep.
        log('  Nothing retries this on its own. RedWeek carries on every pass.');
      } else {
        const next = failedPace(pace, { said: err.message });
        savePace(PACE_FILE, next); intervalCard(next);
        log(`  Interval failed (${next.failures} in a row): ${err.message}`);
      }
    } finally {
      // A browser left running would hold memory on a small VPS for as long as the watcher
      // lives, and the watcher lives for months.
      await iv?.close?.().catch(() => {});
    }
  }

  // The catalog, always — not only when the filter is on. It is what turns a find into a
  // catalog row, so skipping it left every find without a stayId, and WATCH_ONLY_OUR_STAYS then
  // threw all of them away: asking for everything got you nothing at all.
  let catalog = null;
  if (!circle) log('no CIRCLE_URL set — nothing to price against');
  else {
    try {
      const rows = await circle.stays();
      catalog = new Map(rows.map(r => [r.id, r]));
      ctx.catalog = catalog;
      log(`catalog: ${catalog.size} places to price against`);
    } catch (err) { log(`could not read the catalog (${err.message})`); }
  }

  // Judge, post, move the clocks: board.mjs, the same door a member's Interval scan goes through. The board pass a
  // tap asks for reads no RedWeek, so it has nothing to judge.
  const res = redweek ? await judgeAndPost({ circle, found, catalog, cfg: CFG, log, dry: DRY }) : { found: [], posted: 0 };
  if (redweek && ctx.ok.length) {
    const near = res.found.filter((f) => inHorizon(f, CFG.horizonDays)).length;
    log(`RedWeek: ${near} of the ${res.found.length} weeks worth posting check in within the next ${CFG.horizonDays} days`);
  }
  // And then the other half of being honest about age: every live week already on the board, not only the
  // ones that were just posted, is compared with what its source shows now (verify.mjs) — RedWeek's with what
  // this scan read, the rest by their price and their age. The seven days of a RedWeek week do not run while
  // RedWeek is out (source_outages), here as in the database.
  if (circle && catalog) {
    try {
      let outages = [];
      try { outages = await circle.outages(); } catch { /* none known: the migration may not be applied yet */ }
      res.verify = await verifyBoard({ circle, catalog, listings: rwAll, okSlugs: ctx.ok, full: true, apply: !DRY, cfg: CFG, log, outages, slugOf: (stayId) => slugFor({ id: stayId }, catalog), warn: warnOnce });
      if (!DRY) noteBoard(tapState);
    } catch (err) { log(`board: could not re-check the live weeks (${err.message})`); }
  }
  return res;
}

// A dry run still signs in, because judging a find needs the catalog to judge it against.
// It reads and prints; the posting step is what --dry skips.
const circle = DUMP || !process.env.CIRCLE_URL ? null : new Circle({
  url: process.env.CIRCLE_URL, key: process.env.CIRCLE_KEY,
  username: process.env.CIRCLE_USER, password: process.env.CIRCLE_PASS,
});

// Everything that reads the board or posts to it goes through one lane. The half-hourly pass and
// a member's tap would otherwise both read what is already on the board, both find a week missing
// and both post it — the overlap the comment below was written about, arriving by another door.
let lane = Promise.resolve();
const serial = (fn) => (lane = lane.then(fn, fn));

async function run() {
  try { await pass(circle); }
  catch (err) { log('pass failed:', err.message); }
}

// setInterval would start the next pass whether or not the last one finished. A slow sweep —
// RedWeek not answering, a hung socket — would then overlap itself, and two passes reading the
// board at the same time would both find a week missing and both post it. The next pass is
// scheduled when this one is done, so there is only ever one.
//
// Members opening stays. Every WATCH_TAP_POLL_SEC (30) the watcher asks the database for the taps
// that arrived since it last asked — a place and a time, nothing about who — and acts on each
// place once. Not Realtime: that is a websocket client this box does not have, for a gap of
// thirty seconds nobody would feel. If the function is not installed yet (the migration has not
// been pasted into the SQL editor) it says so once an hour and asks again every ten minutes.
const tapEverySec = Math.min(120, Math.max(15, num('WATCH_TAP_POLL_SEC', 30)));
// The Interval scan. Off unless WATCH_INTERVAL_SCAN is on — Victor's word, after the stay_taps migration is
// applied. What it posts goes through the same board.mjs door as everything else, in the same lane.
const scannerFor = (opts) => makeIntervalScanner({
  stateFile: IV_STATE_FILE,
  makeSession: () => new IntervalSession({ stateFile: IV_SESSION_FILE }),
  post: ({ finds, catalog }) => serial(() => judgeAndPost({ circle, found: finds, catalog, cfg: CFG, log })),
  onStop: makeStopAnnouncer({ putCard, tell: (msg) => tellOrHold(tapState, pusher, msg, log) }),
  onGood: () => putCard('interval-watcher', null),
  log, ...opts,
});
const scanInterval = scannerFor({ armed: () => flag('WATCH_INTERVAL_SCAN', false) });

async function pollTaps() {
  let next = tapEverySec * 1000;
  try {
    if (await flushHeld(tapState, pusher, log)) saveTapState(TAPS_FILE, tapState);
    const taps = await circle.takeTaps();
    if (taps.length) {
      const rows = await circle.stays();
      const catalog = new Map(rows.map(r => [r.id, r]));
      await handleTaps({
        taps, catalog, state: tapState,
        deps: {
          log, pusher,
          intervalLastSeen: (id) => circle.intervalLastSeen(id),
          // The member's dates go to the scan: it searches Interval for them (inside its caps, when it is switched on).
          scanInterval: (stay, window) => scanInterval(stay, catalog, window),
          scanAruba: (window) => scanInterval.aruba(catalog, window),
          // The Stays list: the board re-checked, unless a full check finished in the last 15 minutes (a tap's or
          // the scan's), which is re-asked once this one has its turn in the lane. It reads no RedWeek: that is the
          // scan's, twice a day.
          verifyBoard: () => serial(async () => {
            if (!decideBoard(tapState, Date.now()).go) return { verified: 0, repriced: 0, retired: 0, skipped: true };
            const r = await pass(circle, { redweek: false, fromTap: true });
            return r?.verify || { verified: 0, repriced: 0, retired: 0 };
          }),
        },
      });
      saveTapState(TAPS_FILE, tapState);
    }
  } catch (err) {
    if (err.code === 'PGRST202' || err.status === 404) {
      warnOnce('taps', 'taps: the database has no take_stay_taps yet — paste supabase/migrations/20261022_stay_taps.sql into the SQL editor. Asking again in ten minutes.');
      next = 10 * 60_000;
    } else warnOnce('taps-err', `taps: could not collect them (${err.message})`);
  }
  setTimeout(pollTaps, next);
}

/**
 * ONE read of Interval's Aruba Getaways, started by a person and NOT by a member's tap — which is outside
 * the permission on file (interval-board skill, "The line": a member's tap only). It exists for the day
 * Victor says in his own words to do it, and refuses without --confirm. It never signs in: it uses the
 * session saved in .interval-session.json by whoever signed in, and when there is none, or it has expired,
 * it says so and stops. Same caps, same full stop, same board door as a tap's scan.
 */
async function intervalRead() {
  if (!args.has('--confirm')) {
    log('Interval read: not run. This is a read of Interval that no member asked for, which the permission on file does not cover. Pass --confirm only when Victor has said to do it, in his own words.');
    return;
  }
  if (!circle) { log('Interval read: no CIRCLE_URL set — nothing to post to.'); return; }
  const catalog = new Map((await circle.stays()).map((r) => [r.id, r]));
  const r = await scannerFor({ armed: () => true, canSignIn: false, maxSearches: 1 }).aruba(catalog);
  log(`Interval read: ${r.ran ? `${r.rows} Aruba weeks read, ${r.posted} new on the board, ${r.refreshed} last-seen clocks moved${r.unplaced ? `, ${r.unplaced} at places not in the catalog` : ''}` : `nothing read — ${r.why}`}`);
}

if (args.has('--interval-read')) {
  await intervalRead();
} else if (ONCE || DUMP || REDWEEK) {
  await run();
} else {
  // RedWeek: two scheduled passes a day. A restart does not read it again — it reads only if the most recent
  // scheduled time was not served (the last scan is in the state file), so restarting the service twenty
  // times in an afternoon is no more RedWeek traffic than not restarting it.
  const scheduleNext = () => {
    const at = nextSlot(TIMES, Date.now());
    log(`next RedWeek scan at ${arubaClock(at)} Aruba time (${TIMES.map((m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`).join(' and ')} every day)`);
    setTimeout(async () => { await serial(run); scheduleNext(); }, Math.max(1000, at - Date.now()));
  };
  const forever = async () => {
    if (due(TIMES, tapState.redweekScan, Date.now())) await serial(run);
    else log(`RedWeek: the ${arubaClock(lastSlot(TIMES, Date.now()))} scan has been done (last scan ${tapState.redweekScan}) — not reading it again for a restart`);
    scheduleNext();
  };
  if (circle && !DRY) {
    log(`taps: listening every ${tapEverySec}s for members opening a stay`);
    log(`Interval scan on a tap: ${flag('WATCH_INTERVAL_SCAN', false) ? 'ON' : 'off (WATCH_INTERVAL_SCAN is not on) — the Grab nudge only'}${intervalStopped() ? ` — and STOPPED: ${intervalStopped().why}` : ''}`);
    setTimeout(pollTaps, tapEverySec * 1000);
  }
  await forever();
}
