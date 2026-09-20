#!/usr/bin/env node
// The Circle's watcher. Runs on Victor's VPS, checks what is open, puts the good ones on the
// board so Ian and Victor can book them the moment they appear.
//
//   node index.mjs --once      one pass, then stop  (start here)
//   node index.mjs             every WATCH_EVERY_MIN minutes, forever
//   node index.mjs --dry       find and print, post nothing
//   node index.mjs --dump      save what a signed-in Interval session sees, then stop
//
// The timer sweeps RedWeek, which needs no login. Interval is signed into only on a run a
// person started — --once or --dump — and never by the service. See "Interval by hand" below.
//
// Everything it needs is in .env next to this file. Nothing is written down anywhere else.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sweep, ARUBA } from './redweek.mjs';
import { Interval } from './interval.mjs';
import { Circle } from './circle.mjs';
import { loadEnv } from './dotenv.mjs';
// Which finds go up, and what they look like when they do. Pure, and on trial in judge.test.mjs.
import { worthPosting, asDeal, resolveStay, capPerResortMonth, dedupeKey } from './judge.mjs';
// How many times in a row Interval said no. Pure, and on trial in pace.test.mjs. The `due`
// gate it also exports is not read here any more: nothing signs in on a timer for it to hold
// back. What is left is the count, which is what the next run by hand wants to be told.
import { loadPace, savePace, refused as refusedPace, accepted as acceptedPace } from './pace.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// Where the Interval pace lives between passes and across restarts. Git-ignored, like .env.
const PACE_FILE = join(HERE, '.interval-pace.json');
const args = new Set(process.argv.slice(2));
const ONCE = args.has('--once'), DRY = args.has('--dry'), DUMP = args.has('--dump');

// .env, beside this file. Shared with the tests (dotenv.mjs) so they run with the same choices.
loadEnv(join(HERE, '.env'));

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
  // The longest a refused Interval sign-in waits before the next attempt. A day by default.
  intervalRetryMaxMin: num('WATCH_INTERVAL_RETRY_MAX_MIN', 24 * 60),
};

const log = (...a) => console.log(new Date().toISOString().slice(0, 19).replace('T', ' '), ...a);

/**
 * Move the last-seen clock on the weeks this pass found on the page again.
 *
 * A row on the board carries two times: when it was first posted here, and when it was last
 * seen where it lives. The board shows the second one, and after two days it says it out loud —
 * "Last seen 3 days ago. Victor looks again before he books" (js/views/deals.js). The watcher
 * sweeps RedWeek every half hour and confirms these same weeks are still on the page, and until
 * now it wrote nothing when it did: anything already posted was skipped and that was the end of
 * it. So seen_at stayed at first sighting for ever, and since RedWeek is 78 of the 85 weeks on
 * the board, most of the board was telling members it was older than it is — about weeks the
 * watcher had confirmed forty-eight times that day. A row that is wrong about its own age is
 * worse than no row at all: browsing without having to ask is the entire point of the board.
 *
 * This is the watcher's half of a rule the Grab path already keeps. ingest-deal writes
 * `{ seen_at: now }` the moment it meets a week it has posted before (supabase/functions/
 * ingest-deal/index.ts). Two writers of one column, one rule, and only one of them kept it.
 *
 * Live rows only. A week Victor has taken down is not a listing any more, and a retired row
 * with a moving clock would read as alive in the Desk's own lists.
 *
 * It counts what came BACK, not what it asked for. The watcher signs in as an ordinary member —
 * the bot account holds no role and there is no service key on the VPS — and `deals` is behind
 * row-level security. An update that no policy allows does not fail loudly: Postgres filters the
 * rows away and PostgREST answers with nothing changed. Counting the rows the database returns
 * is the difference between a log line that is true and one that merely reads well.
 */
async function refreshSeen(circle, refs) {
  if (!refs.length) return { asked: 0, moved: 0, said: '' };
  const now = new Date().toISOString();
  let moved = 0, said = '';
  // In batches: a pass can see a hundred weeks again, and a URL is not the place to put a
  // hundred references at once.
  for (let i = 0; i < refs.length; i += 50) {
    const batch = refs.slice(i, i + 50);
    // JSON.stringify quotes each reference the way PostgREST wants them inside in.(…), so a
    // reference carrying a comma cannot become two.
    const list = encodeURIComponent(batch.map(r => JSON.stringify(String(r))).join(','));
    const res = await circle.call(`/rest/v1/deals?status=eq.live&source_ref=in.(${list})&select=source_ref`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', prefer: 'return=representation' },
      body: JSON.stringify({ seen_at: now }),
    });
    if (!res.ok) {
      said = `the Circle answered ${res.status}: ${String(await res.text().catch(() => '')).slice(0, 160)}`;
      break;
    }
    const rows = await res.json().catch(() => []);
    moved += Array.isArray(rows) ? rows.length : 0;
  }
  return { asked: refs.length, moved, said };
}

async function pass(circle) {
  const found = [];

  log('RedWeek: sweeping');
  const slugs = CFG.onlyOurStays ? Object.keys(ARUBA).filter(s => ARUBA[s]) : Object.keys(ARUBA);
  const rw = await sweep(slugs, {
    onResort: (slug, n, err) => log(`  ${err ? 'x' : ' '} ${slug.padEnd(44)} ${err ? err.message : `${n} open`}`),
  });
  found.push(...rw);

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
  const byHand = ONCE || DUMP;
  const refusalsSaid = (n) => `${n} time${n === 1 ? '' : 's'} in a row`;
  if (!wantsInterval) {
    log('Interval: off (WATCH_INTERVAL is not set) — RedWeek only');
  } else if (!process.env.INTERVAL_USER) {
    log('Interval: no INTERVAL_USER set, skipping');
  } else if (!byHand) {
    log('Interval: signed into by hand only, never on this timer — run `node index.mjs --once` when you want a look. RedWeek runs every pass.'
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
    } catch (err) {
      if (err.needsDump) {
        // It signed in; only the search page is unset. Not a refusal, so not a longer wait.
        log(`  Interval: ${err.message}`);
        savePace(PACE_FILE, acceptedPace());
      } else if (err.needsBrowser) {
        log(`  Interval needs a browser: ${err.message}`);
        log(`  Install it with: npx playwright install ${process.env.WATCH_BROWSER || 'chromium'}   (or set WATCH_INTERVAL_MODE=fetch)`);
      } else if (err.refused) {
        const next = refusedPace(pace, { everyMin: CFG.everyMin, maxMin: CFG.intervalRetryMaxMin, said: err.message });
        savePace(PACE_FILE, next);
        log(`  Interval refused the sign-in (${refusalsSaid(next.refusals)}): ${err.message}`);
        // No "next try" line any more: nothing tries on its own, so naming an hour would be
        // promising something no timer is going to keep.
        log('  Nothing retries this on its own. RedWeek carries on every pass.');
      } else log(`  Interval failed: ${err.message}`);
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
      log(`catalog: ${catalog.size} places to price against`);
    } catch (err) { log(`could not read the catalog (${err.message})`); }
  }

  // Attach the live catalog row by name, because ids differ between the bundled catalog and
  // the database. A find that cannot be placed can never be posted — a deal must belong to a
  // stay — so the Interval ones are named in the log for Victor to add in the Desk.
  if (catalog) for (const f of found) f.stayId = resolveStay(f, catalog);
  const ivUnplaced = found.filter(f => f.source === 'interval' && !f.stayId);
  if (ivUnplaced.length) {
    const names = [...new Set(ivUnplaced.map(f => f.resortName || f.ourName || '(no name read)'))].slice(0, 8);
    log(`Interval: ${ivUnplaced.length} week${ivUnplaced.length === 1 ? '' : 's'} at places not in the catalog — add them in the Desk to see them here: ${names.join('; ')}`);
  }
  const good = capPerResortMonth(found.filter(f => worthPosting(f, catalog, CFG)), CFG.maxPerResortMonth);
  const ivGood = good.filter(f => f.source === 'interval').length;
  log(`${found.length} found, ${good.length} worth posting — ${ivGood} from Interval (every one at our places), ${good.length - ivGood} owner week${good.length - ivGood === 1 ? '' : 's'}`
    + (CFG.mustBeatOurs ? ` at least ${Math.round(CFG.beatBy * 100)}% under the public rate` : '')
    + `, cheapest ${CFG.maxPerResortMonth} a resort a month`);

  if (DRY) {
    log('dry run — nothing is posted');
    for (const f of good.sort((a, b) => (a.usdNightly || 0) - (b.usdNightly || 0)).slice(0, 30)) {
      log(`  ${f.source.padEnd(8)} ${f.from} → ${f.to}  ${String(f.nights).padStart(2)}n  $${String(f.usdNightly).padStart(7)}/n  $${String(f.usdTotal).padStart(7)}${f.retailPrice ? `  public $${f.retailPrice}` : ''}${f.saves ? `  vs ours ${f.saves > 0 ? '−' : '+'}$${Math.abs(f.saves)}` : ''}  ${f.unit || f.unitCode || ''}`);
    }
    return { found: good, posted: 0 };
  }

  if (!circle) { log('no CIRCLE_URL set — nothing to post to. Use --dry, or fill in .env.'); return { found: good, posted: 0 }; }
  // Points are all-in at the Circle's own two numbers. Posting without them would put a week on
  // the board fifteen per cent cheaper than the website shows the same week — so no settings,
  // no posts.
  let settings;
  try { settings = await circle.settings(); }
  catch (err) { log(`could not read the Circle's settings (${err.message}) — nothing posted this pass`); return { found: good, posted: 0 }; }
  const already = await circle.knownRefs();
  let posted = 0;
  // The weeks this pass met on the page that are already on the board. Meeting one again is
  // news — it is the whole difference between "posted on Monday" and "still there this
  // morning" — so it is no longer thrown away with the `continue`.
  const seenAgain = new Set();
  for (const f of good) {
    const deal = asDeal(f, CFG, settings);
    if (!deal) { log(`  could not price ${f.source} ${f.from} at ${f.resortName || f.ourName || '?'} — skipped`); continue; }
    if (already.refs.has(deal.sourceRef) || already.weeks.has(dedupeKey(deal))) {
      // Only ever by the source's own reference. A week matched on the WEEK key is the same
      // week standing on somebody else's page — an owner lists on RedWeek and on VakayMood
      // alike — and the row on the board belongs to that other page, which this pass never
      // read. Moving its clock would be the app saying it had seen something it had not.
      if (deal.sourceRef && already.refs.has(deal.sourceRef)) seenAgain.add(deal.sourceRef);
      continue;
    }
    try {
      await circle.post(deal); posted++;
      already.refs.add(deal.sourceRef); already.weeks.add(dedupeKey(deal));
      log(`  posted ${deal.title} ${deal.from} $${deal.usdTotal} → ${deal.pointsTotal} pts`);
    } catch (err) { log(`  could not post ${deal.sourceRef}: ${err.message}`); }
    await new Promise(r => setTimeout(r, 400));
  }
  log(`${posted} new on the board`);

  const clocks = await refreshSeen(circle, [...seenAgain]);
  const weeks = (n) => `${n} week${n === 1 ? '' : 's'}`;
  if (clocks.said) {
    log(`  ${weeks(clocks.asked)} were on the page again — their last-seen clocks were NOT moved: ${clocks.said}`);
  } else if (clocks.moved) {
    log(`  ${weeks(clocks.asked)} seen again — ${clocks.moved} last-seen clock${clocks.moved === 1 ? '' : 's'} moved`);
  } else if (clocks.asked) {
    // Say the true thing rather than the tidy one. Zero rows came back changed, and from here
    // there is no way to tell whether those rows have stopped being live or whether nothing
    // grants this account the write — `deals` carries a read policy and, as supabase/schema.sql
    // stands, no write policy that would let the watcher move seen_at.
    log(`  ${weeks(clocks.asked)} seen again — 0 clocks moved. Either those rows are no longer live, or nothing in supabase/schema.sql lets this account write deals.seen_at; the board will keep showing them at their first sighting until it does.`);
  }
  return { found: good, posted, refreshed: clocks.moved };
}

// A dry run still signs in, because judging a find needs the catalog to judge it against.
// It reads and prints; the posting step is what --dry skips.
const circle = DUMP || !process.env.CIRCLE_URL ? null : new Circle({
  url: process.env.CIRCLE_URL, key: process.env.CIRCLE_KEY,
  username: process.env.CIRCLE_USER, password: process.env.CIRCLE_PASS,
});

async function run() {
  try { await pass(circle); }
  catch (err) { log('pass failed:', err.message); }
}

// setInterval would start the next pass whether or not the last one finished. A slow sweep —
// RedWeek not answering, a hung socket — would then overlap itself, and two passes reading the
// board at the same time would both find a week missing and both post it. The next pass is
// scheduled when this one is done, so there is only ever one.
if (ONCE || DUMP) {
  await run();
} else {
  const forever = async () => {
    await run();
    log(`next pass in ${CFG.everyMin} minutes`);
    setTimeout(forever, Math.max(1, CFG.everyMin) * 60_000);
  };
  await forever();
}
