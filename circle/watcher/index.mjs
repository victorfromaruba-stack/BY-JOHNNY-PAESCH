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
import { sweep, ARUBA, sameName } from './redweek.mjs';
import { Interval } from './interval.mjs';
import { Circle } from './circle.mjs';
// The app's own season rules, not a copy of them. Carnival moves with Easter, and a second
// implementation would drift — which is exactly how the watcher would end up judging a week
// against the wrong rate.
import { seasonFor } from '../js/core/money.js';

const HERE = dirname(fileURLToPath(import.meta.url));
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
  // Only shout about something cheaper than what the Circle already charges. Without this it
  // finds a hundred open weeks a day, which is a list, not news.
  mustBeatOurs:  flag('WATCH_MUST_BEAT_OURS', true),
  beatBy:        num('WATCH_BEAT_BY_PCT', 15) / 100,
};

/**
 * What the Circle would charge for this week, in dollars. Null when we do not carry it.
 *
 * Priced a night at a time. Taking the season of the check-in date and multiplying got the
 * shoulder weeks badly wrong: a week beginning 17 December is three Summer nights and four at
 * the Peak rate, and pricing all seven as Summer made an ordinary listing look like a steal.
 */
function ourPrice(stay, from, nights) {
  if (!stay) return null;
  const rates = { low: stay.rate_low_usd, high: stay.rate_high_usd, peak: stay.rate_peak_usd };
  const start = Date.parse(`${from}T12:00:00Z`);
  if (!Number.isFinite(start) || !(nights > 0)) return null;
  let total = 0;
  for (let i = 0; i < nights; i++) {
    const night = new Date(start + i * 864e5).toISOString().slice(0, 10);
    const n = Number(rates[seasonFor(`${night}T12:00:00Z`)]);
    if (!Number.isFinite(n) || n <= 0) return null;   // one unpriced night and we cannot judge it
    total += n;
  }
  return total;
}
const log = (...a) => console.log(new Date().toISOString().slice(0, 19).replace('T', ' '), ...a);

/** Worth telling the Circle about? */
function worthPosting(f, catalog) {
  if (f.taken) return false;
  if (CFG.onlyOurStays && !f.stayId) return false;         // not in the catalog, cannot be priced
  if (CFG.minNights && f.nights < CFG.minNights) return false;
  if (CFG.maxNightly && f.usdNightly > CFG.maxNightly) return false;
  if (!(f.usdTotal > 0) || !f.from || !f.to) return false;
  // Price it whether or not the filter is on, so the saving can be shown either way.
  const ours = ourPrice(catalog?.get(f.stayId), f.from, f.nights || 1);
  if (ours != null) { f.ourPrice = ours; f.saves = Math.round(ours - f.usdTotal); }
  if (!CFG.mustBeatOurs) return true;
  // "We could not price it" used to mean "post it anyway", which is the wrong way round: the
  // whole promise of this filter is that everything on the board undercuts our own rate, and a
  // week nobody could price does not. Silence is the honest answer.
  if (ours == null) return false;
  return f.usdTotal <= ours * (1 - CFG.beatBy);
}

const asDeal = (f) => {
  // RedWeek rows carry the resort under `ourName` (the catalog's spelling), Interval's under
  // `resortName`. Taking only one of them left every RedWeek deal on the board titled "3 Bedroom
  // Villa, Ocean view" with no hint of where it was.
  const place = f.resortName || f.ourName || '';
  return {
    stayId: f.stayId, from: f.from, to: f.to, nights: f.nights,
    usdTotal: f.usdTotal, pointsPerDollar: CFG.pointsPerUsd,
    // externalId is already unique within a source; prefixing here and there gave
    // "interval:interval:…" and, worse, let two resorts sharing a week and a price collide.
    sourceRef: String(f.externalId).startsWith(`${f.source}:`) ? String(f.externalId) : `${f.source}:${f.externalId}`,
    source: f.source, url: f.url || '',
    title: [place, f.unit].filter(Boolean).join(' · ') || 'A week that came up',
    note: [f.unit, f.sleeps ? `sleeps ${f.sleeps}` : '', f.view, f.protected ? 'RedWeek protects the payment' : '',
             f.saves > 0 ? `$${f.saves} under our rate` : ''].filter(Boolean).join(' · '),
    retailUsd: f.ourPrice || null,
  };
};

async function pass(circle) {
  const found = [];

  log('RedWeek: sweeping');
  const slugs = CFG.onlyOurStays ? Object.keys(ARUBA).filter(s => ARUBA[s]) : Object.keys(ARUBA);
  const rw = await sweep(slugs, {
    onResort: (slug, n, err) => log(`  ${err ? 'x' : ' '} ${slug.padEnd(44)} ${err ? err.message : `${n} open`}`),
  });
  found.push(...rw);

  if (process.env.INTERVAL_USER) {
    try {
      log('Interval: signing in');
      const iv = new Interval({ username: process.env.INTERVAL_USER, password: process.env.INTERVAL_PASS });
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
    } catch (err) {
      if (err.needsDump) log(`  Interval: ${err.message}`);
      else log(`  Interval failed: ${err.message}`);
    }
  } else {
    log('Interval: no INTERVAL_USER set, skipping');
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
  // the database. Without this nothing can be priced and everything looks like a bargain.
  if (catalog) {
    for (const f of found) {
      if (f.stayId) continue;
      const row = f.ourName ? [...catalog.values()].find(r => sameName(r.name, f.ourName)) : null;
      if (row) f.stayId = row.id;
    }
  }
  const good = found.filter(f => worthPosting(f, catalog));
  log(`${found.length} found, ${good.length} worth posting${CFG.mustBeatOurs && catalog ? ` (at least ${Math.round(CFG.beatBy * 100)}% under our rate)` : ''}`);

  if (DRY) {
    log('dry run — nothing is posted');
    for (const f of good.sort((a, b) => (b.saves || 0) - (a.saves || 0)).slice(0, 20)) {
      log(`  ${f.from} → ${f.to}  ${String(f.nights).padStart(2)}n  $${String(f.usdNightly).padStart(7)}/n  $${String(f.usdTotal).padStart(7)}${f.saves ? `  saves $${f.saves}` : ''}  ${f.unit || ''}`);
    }
    return { found: good, posted: 0 };
  }

  if (!circle) { log('no CIRCLE_URL set — nothing to post to. Use --dry, or fill in .env.'); return { found: good, posted: 0 }; }
  const already = await circle.knownRefs();
  let posted = 0;
  for (const f of good) {
    const deal = asDeal(f);
    if (already.has(deal.sourceRef)) continue;
    try { await circle.post(deal); posted++; log(`  posted ${deal.title} ${deal.from} $${f.usdTotal}`); }
    catch (err) { log(`  could not post ${deal.sourceRef}: ${err.message}`); }
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
