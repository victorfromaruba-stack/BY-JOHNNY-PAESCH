#!/usr/bin/env node
// The Circle's watcher. Runs on Victor's VPS, checks what is open, puts the good ones on the
// board so Ian and Victor can book them the moment they appear.
//
//   node index.mjs --once      one pass, then stop  (start here)
//   node index.mjs             every WATCH_EVERY_MIN minutes, forever
//   node index.mjs --dry       find and print, post nothing
//   node index.mjs --dump      save what a signed-in Interval session sees, then stop
//
// Everything it needs is in .env next to this file. Nothing is written down anywhere else.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sweep, ARUBA } from './redweek.mjs';
import { Interval } from './interval.mjs';
import { Circle } from './circle.mjs';
// Which finds go up, and what they look like when they do. Pure, and on trial in judge.test.mjs.
import { worthPosting, asDeal, resolveStay, capPerResortMonth, dedupeKey } from './judge.mjs';
// How soon to ask Interval again after it said no. Pure, and on trial in pace.test.mjs.
import { loadPace, savePace, refused as refusedPace, accepted as acceptedPace, due as paceDue, backoffMinutes } from './pace.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// Where the Interval pace lives between passes and across restarts. Git-ignored, like .env.
const PACE_FILE = join(HERE, '.interval-pace.json');
const args = new Set(process.argv.slice(2));
const ONCE = args.has('--once'), DRY = args.has('--dry'), DUMP = args.has('--dump');

// .env, read plainly. No dependency for a dozen lines of parsing.
//
// The trailing comments matter: .env.example writes `WATCH_MUST_BEAT_OURS=true   # only post…`,
// and taking the rest of the line whole would make the value "false   # …", which is not the
// string "false" — so turning a switch off would silently leave it on. An unquoted value ends
// at the first #; a quoted one keeps whatever is inside the quotes.
for (const line of (existsSync(join(HERE, '.env')) ? readFileSync(join(HERE, '.env'), 'utf8') : '').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (!m || process.env[m[1]]) continue;
  const raw = m[2].trim();
  const quoted = raw.match(/^(["'])([\s\S]*?)\1/);
  process.env[m[1]] = quoted ? quoted[2] : raw.replace(/\s+#.*$/, '').trim();
}

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

async function pass(circle) {
  const found = [];

  log('RedWeek: sweeping');
  const slugs = CFG.onlyOurStays ? Object.keys(ARUBA).filter(s => ARUBA[s]) : Object.keys(ARUBA);
  const rw = await sweep(slugs, {
    onResort: (slug, n, err) => log(`  ${err ? 'x' : ' '} ${slug.padEnd(44)} ${err ? err.message : `${n} open`}`),
  });
  found.push(...rw);

  // Interval is off unless it is deliberately switched on, and having a username set is not
  // deliberate enough. RedWeek needs no login, works today, and finds around 138 open weeks a
  // pass across the six resorts — so the watcher does its job either way, and Interval is a
  // separate decision rather than a blocker. See the README on what that decision involves.
  //
  // The pace (pace.mjs): a refused sign-in doubles the wait before the next attempt, up to a
  // day, and a sign-in that works puts it back to every pass. A run by hand — --once, --dump —
  // is a deliberate attempt and always goes ahead; the service is what honours the wait.
  const wantsInterval = /^(1|on|true|yes)$/i.test(process.env.WATCH_INTERVAL || '');
  const pace = loadPace(PACE_FILE);
  const stamp = (iso) => new Date(iso).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  if (!wantsInterval) {
    log('Interval: off (WATCH_INTERVAL is not set) — RedWeek only');
  } else if (!process.env.INTERVAL_USER) {
    log('Interval: no INTERVAL_USER set, skipping');
  } else if (!ONCE && !DUMP && !paceDue(pace)) {
    const inMin = Math.max(0, Math.ceil((Date.parse(pace.nextTryAt) - Date.now()) / 60_000));
    log(`Interval: the sign-in was refused ${pace.refusals} time${pace.refusals === 1 ? '' : 's'} in a row — next try ${stamp(pace.nextTryAt)}, ${inMin} min from now; RedWeek still runs every pass`);
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
      const iso = (d) => d.toISOString().slice(0, 10);
      const got = await iv.getaways({ from: iso(today), to: iso(plus), guests: num('WATCH_GUESTS', 2) });
      log(`  ${got.length} Getaway weeks`);
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
        log('  Install it with: npx playwright install firefox   (or set WATCH_INTERVAL_MODE=fetch)');
      } else if (err.refused) {
        const next = refusedPace(pace, { everyMin: CFG.everyMin, maxMin: CFG.intervalRetryMaxMin, said: err.message });
        savePace(PACE_FILE, next);
        log(`  Interval refused the sign-in (${next.refusals} in a row): ${err.message}`);
        log(`  next try ${stamp(next.nextTryAt)} — ${backoffMinutes(next.refusals, CFG.everyMin, { maxMin: CFG.intervalRetryMaxMin })} minutes from now; RedWeek carries on every pass`);
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
  for (const f of good) {
    const deal = asDeal(f, CFG, settings);
    if (!deal) { log(`  could not price ${f.source} ${f.from} at ${f.resortName || f.ourName || '?'} — skipped`); continue; }
    if (already.refs.has(deal.sourceRef) || already.weeks.has(dedupeKey(deal))) continue;
    try {
      await circle.post(deal); posted++;
      already.refs.add(deal.sourceRef); already.weeks.add(dedupeKey(deal));
      log(`  posted ${deal.title} ${deal.from} $${deal.usdTotal} → ${deal.pointsTotal} pts`);
    } catch (err) { log(`  could not post ${deal.sourceRef}: ${err.message}`); }
    await new Promise(r => setTimeout(r, 400));
  }
  log(`${posted} new on the board`);
  return { found: good, posted };
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
