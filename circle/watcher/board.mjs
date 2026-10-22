// Putting finds on the board: judge them, post the new ones, move the last-seen clock on the ones
// that were already there.
//
// This used to be the end of pass() in index.mjs. It is a module of its own because a second door
// now leads to it: a member's tap can read Interval (interval-scan.mjs) and what that read finds
// has to be judged by the same rules and posted through the same post_deal as a RedWeek week —
// same floor, same ceiling, same dedupe, same seen_at — rather than by a copy of them.
//
// Nothing here is new. It moved, and `CFG` and `DRY` became arguments.

import { worthPosting, asDeal, resolveStay, capPerResortMonth, dedupeKey } from './judge.mjs';

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
export async function refreshSeen(circle, refs) {
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

/**
 * Judge `found` against `catalog` and post what is worth posting. Returns `{ found, posted, refreshed }`.
 * `found` rows already carry a `stayId` when the caller knows the place (a scan of one resort does);
 * the rest are placed by name.
 */
export async function judgeAndPost({ circle, found, catalog, cfg, log, dry = false }) {
  // Attach the live catalog row by name, because ids differ between the bundled catalog and
  // the database. A find that cannot be placed can never be posted — a deal must belong to a
  // stay — so the Interval ones are named in the log for Victor to add in the Desk.
  if (catalog) for (const f of found) f.stayId = resolveStay(f, catalog);
  const ivUnplaced = found.filter(f => f.source === 'interval' && !f.stayId);
  if (ivUnplaced.length) {
    const names = [...new Set(ivUnplaced.map(f => f.resortName || f.ourName || '(no name read)'))].slice(0, 8);
    log(`Interval: ${ivUnplaced.length} week${ivUnplaced.length === 1 ? '' : 's'} at places not in the catalog — add them in the Desk to see them here: ${names.join('; ')}`);
  }
  const good = capPerResortMonth(found.filter(f => worthPosting(f, catalog, cfg)), cfg.maxPerResortMonth);
  const ivGood = good.filter(f => f.source === 'interval').length;
  log(`${found.length} found, ${good.length} worth posting — ${ivGood} from Interval (every one at our places), ${good.length - ivGood} owner week${good.length - ivGood === 1 ? '' : 's'}`
    + (cfg.mustBeatOurs ? ` at least ${Math.round(cfg.beatBy * 100)}% under the public rate` : '')
    + `, cheapest ${cfg.maxPerResortMonth} a resort a month`);

  if (dry) {
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
    const deal = asDeal(f, cfg, settings);
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
    log(`  ${weeks(clocks.asked)} seen again — 0 clocks moved. Either those rows are no longer live, or nothing has granted this account the write — supabase/migrations/20261022_stay_taps.sql does, and has to be pasted into the SQL editor once; until then the board shows them at their first sighting.`);
  }
  return { found: good, posted, refreshed: clocks.moved };
}
