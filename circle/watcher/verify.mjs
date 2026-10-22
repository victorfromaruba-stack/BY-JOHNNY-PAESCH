// Re-checking the board: every live week against the place it lives.
//
// Victor, 22 Oct 2026, after a screenshot of a Barceló week "owner asking $9 a night", last seen
// 16 Oct, at No. 1 on Stays: the board must be honest about its own age. The watcher used to look at
// RedWeek every half hour and then only touch the few weeks it had decided to POST; the other
// seventy-odd live rows kept whatever "seen" and price they were posted with, for as long as they
// were on the board. Now every live RedWeek row is compared with what RedWeek shows for its resort
// in the same read:
//
//   still listed, not rented   its last-seen clock moves; if the asking price has changed the row is
//                              repriced, with the title that carries it
//   rented                     retired: "gone from RedWeek on 22 Oct"
//   no longer listed           retired the same way — but only when the page can be trusted to be the
//                              whole list (it listed something, and the absences are not most of the
//                              resort's rows at once). A page that came back empty, or short, is not
//                              proof that thirty weeks vanished in half an hour; the seven-day rule
//                              catches those if they really are gone
//   price not credible         any watched row — RedWeek, Interval, VakayMood — whose price a night is
//                              under the floor or over the ceiling (judge.mjs) is retired: a figure can
//                              be parsed correctly and still be impossible
//
// A resort that did not answer verifies nothing: no clock moves, nothing retires. This file is pure —
// it decides; index.mjs and circle.mjs act — so every one of those rules is on trial in
// verify.test.mjs without a network.

import { implausiblyCheap, implausiblyDear } from './judge.mjs';

/** "22 Oct", in Aruba (UTC-4, no daylight time) — the day a week was found gone. */
export const arubaDay = (ms) => {
  const d = new Date(ms - 4 * 3600e3);
  return `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]}`;
};

/** What a row costs a night in dollars, from its points: all-in points are dollars × points-to-the-dollar × (1 + the Circle's share). */
export function rowUsdNightly(row, settings = {}) {
  const ppd = Number(settings.pointsPerDollar) || 100;
  const rate = Number(settings.serviceRate) || 0;
  const nights = Math.max(1, Number(row.nights) || 1);
  const points = Number(row.points_total);
  return points > 0 ? points / (ppd * (1 + rate)) / nights : 0;
}

export const WATCHED = Object.freeze(['redweek', 'interval', 'vakaymood']);

/**
 * `rows`      live deals: { source, source_ref, stay_id, points_total, nights, title }
 * `redweek`   Map<slug, { ok, listings }> — `listings` is what rentals() returned WITH the rented ones
 * `slugOf`    (stay_id) -> the RedWeek slug of that place, or null
 * `dealOf`    (listing, stayId) -> the deal the watcher would post for it now ({ pointsTotal, title, note }) or null
 * Returns { seen, reprice, retire, counts }.
 */
export function planVerify({ rows, redweek, slugOf, dealOf, settings = {}, now = Date.now(), cfg = {} }) {
  const seen = [], reprice = [], retire = [];
  const retiring = new Set();
  const day = arubaDay(now);
  const out = (ref, why, kind) => { if (!retiring.has(ref)) { retiring.add(ref); retire.push({ ref, why, kind }); } };

  // Rows of each resort that are on the board, so "most of them at once" can be judged.
  const bySlug = new Map();
  for (const r of rows) {
    if (r.source !== 'redweek' || !r.source_ref) continue;
    const slug = slugOf(r.stay_id);
    if (slug) (bySlug.get(slug) || bySlug.set(slug, []).get(slug)).push(r);
  }

  for (const [slug, mine] of bySlug) {
    const reading = redweek.get(slug);
    if (!reading?.ok) continue;                                   // it did not answer: nothing is learned
    const byRef = new Map(reading.listings.map((l) => [`redweek:${l.externalId}`, l]));
    const gone = [];
    for (const r of mine) {
      const l = byRef.get(r.source_ref);
      if (!l) { gone.push(r); continue; }
      if (l.taken) { out(r.source_ref, `gone from RedWeek on ${day}`, 'rented'); continue; }
      const deal = dealOf(l, r.stay_id);
      if (deal && implausiblyCheap({ nights: l.nights, usdNightly: l.usdNightly, usdTotal: l.usdTotal }, cfg)) {
        out(r.source_ref, `price not credible: $${Math.round(l.usdNightly)} a night on RedWeek`, 'price');
        continue;
      }
      if (deal && implausiblyDear({ nights: l.nights, usdNightly: l.usdNightly, usdTotal: l.usdTotal }, cfg)) {
        out(r.source_ref, `price not credible: $${Math.round(l.usdNightly)} a night on RedWeek`, 'price');
        continue;
      }
      seen.push(r.source_ref);
      if (deal && deal.pointsTotal > 0 && deal.pointsTotal !== Number(r.points_total)) {
        reprice.push({ ref: r.source_ref, points: deal.pointsTotal, title: deal.title, note: deal.note, was: Number(r.points_total) });
      }
    }
    // Absent: only believed when the page listed something and the absences are fewer than half the rows.
    const everything = reading.listings.length > 0;
    if (gone.length && everything && gone.length * 2 <= mine.length) {
      for (const r of gone) out(r.source_ref, `gone from RedWeek on ${day}`, 'absent');
    }
  }

  // The price of every watched row, whatever its source, against the floor and the ceiling.
  for (const r of rows) {
    if (!WATCHED.includes(r.source) || !r.source_ref || retiring.has(r.source_ref)) continue;
    const usd = rowUsdNightly(r, settings);
    if (!(usd > 0)) continue;
    const f = { nights: r.nights, usdNightly: usd, usdTotal: usd * (r.nights || 1) };
    if (implausiblyCheap(f, cfg) || implausiblyDear(f, cfg)) {
      out(r.source_ref, `price not credible: $${Math.round(usd)} a night`, 'price');
    }
  }

  // A reprice for a row that is being retired is moot.
  const live = reprice.filter((x) => !retiring.has(x.ref));
  return {
    seen: seen.filter((ref) => !retiring.has(ref)), reprice: live, retire,
    counts: { verified: seen.length + retire.filter((x) => x.kind === 'rented' || x.kind === 'absent').length, repriced: live.length, retired: retire.length },
  };
}
