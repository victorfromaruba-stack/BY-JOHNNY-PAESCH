// The watcher's judgement: which finds go on the board, and what they look like when they do.
//
// Pure functions, nothing read from the environment, so `node --test` can put every rule on
// trial with a hand-built find and a hand-built catalog. The daemon in index.mjs feeds them.
//
// The rule, in one paragraph. Interval is the Circle's own channel — a Getaway at one of our
// places is news whatever it costs, so every one at a catalog stay is posted. RedWeek is an
// owner asking a price; it is worth a member's attention when it is well under the resort's
// PUBLIC rate, and the cheapest few per resort per month are enough — sixty owner weeks a pass is
// a list, not news. The comparison used to be against the Circle's OWN rate, which is anchored
// to a $90 Getaway that no owner will ever undercut, and so in months of running the watcher
// never posted a single thing. A find at a resort the catalog does not carry can never be posted
// at all: a deal must belong to a stay.

import { rateBandFor } from '../js/core/money.js';
import { normName, sameName, nameWithin } from '../js/core/names.js';

/**
 * What the Circle would charge for this week, in dollars, or null when it cannot be priced.
 *
 * Priced a night at a time. Taking the check-in date's rate and multiplying got the shoulder
 * weeks badly wrong: a week beginning 17 December is three nights at the cheap rate and four at
 * the Christmas one, and pricing all seven as cheap made an ordinary listing look like a steal.
 */
export function ourPrice(stay, from, nights) {
  if (!stay) return null;
  const rates = { low: stay.rate_low_usd, high: stay.rate_high_usd, peak: stay.rate_peak_usd };
  const start = Date.parse(`${from}T12:00:00Z`);
  if (!Number.isFinite(start) || !(nights > 0)) return null;
  let total = 0;
  for (let i = 0; i < nights; i++) {
    const night = new Date(start + i * 864e5).toISOString().slice(0, 10);
    const n = Number(rates[rateBandFor(`${night}T12:00:00Z`)]);
    if (!Number.isFinite(n) || n <= 0) return null;   // one unpriced night and we cannot judge it
    total += n;
  }
  return total;
}

/** The resort's own public rate for these nights — the bar a "cheap" owner week has to clear. */
export function retailPrice(stay, nights) {
  const r = Number(stay?.retail_usd);
  return Number.isFinite(r) && r > 0 && nights > 0 ? r * nights : null;
}

/**
 * Which catalog row a find belongs to, by name. RedWeek rows arrive with `ourName` already in
 * the catalog's spelling; Interval rows carry `resortName` read off a heading, and `text` — the
 * run of page text the row was cut from — for when the heading regex caught only part of the
 * name. Exact (normalised) first, then contains, either way round.
 */
export function resolveStay(f, catalog) {
  if (f.stayId) return f.stayId;
  if (!catalog) return null;
  const rows = [...catalog.values()];
  const nm = f.ourName || f.resortName || '';
  let row = nm ? rows.find(r => sameName(r.name, nm)) : null;
  // The catalog's name inside the site's longer one ("Eagle Aruba Resort & Casino") is safe. The
  // site's name inside ours ("Aruba Surf Club") is only trusted when it is a real name and not a
  // fragment — "Aruba" alone would sit inside every stay on the island.
  const specific = normName(nm).split(' ').length >= 2 && normName(nm).length >= 10;
  if (!row && nm) row = rows.find(r => nameWithin(nm, r.name) || (specific && nameWithin(r.name, nm)));
  if (!row && f.text) row = rows.find(r => nameWithin(f.text, r.name));
  return row?.id || null;
}

/** Worth telling the Circle about? Prices the find on the way through (`ourPrice`, `retailPrice`, `saves`). */
export function worthPosting(f, catalog, cfg) {
  if (f.taken) return false;
  if (!f.stayId) return false;                                 // post_deal needs a stay; nothing to be done here
  if (!f.from || !f.to) return false;
  if (cfg.minNights && f.nights < cfg.minNights) return false;
  if (cfg.maxNightly && f.usdNightly > cfg.maxNightly) return false;
  const stay = catalog?.get(f.stayId);
  const ours = ourPrice(stay, f.from, f.nights || 1);
  if (ours != null) { f.ourPrice = ours; f.saves = f.usdTotal > 0 ? Math.round(ours - f.usdTotal) : null; }
  const retail = retailPrice(stay, f.nights || 1);
  if (retail != null) f.retailPrice = retail;
  // Interval: always, as long as it can be priced one way or the other. A Getaway whose price
  // the parser missed still goes up, at our own rate, with a note saying so.
  if (f.source === 'interval') return f.usdTotal > 0 || ours != null;
  if (!(f.usdTotal > 0)) return false;
  if (!cfg.mustBeatOurs) return true;
  if (retail == null) return false;                            // no public rate on file: nothing honest to compare with
  return f.usdTotal <= retail * (1 - cfg.beatBy);
}

/**
 * The cheapest `n` owner weeks per resort per check-in month. Interval finds are never capped —
 * every one is news. Order within the cap is by the nightly ask, so a cheap week is never
 * squeezed out by a dearer one that happened to be parsed first.
 */
export function capPerResortMonth(finds, n = 3) {
  if (!(n > 0)) return finds.slice();
  const kept = [];
  const buckets = new Map();
  const nightly = (f) => (f.usdNightly > 0 ? f.usdNightly : f.usdTotal / Math.max(1, f.nights || 1));
  for (const f of finds.slice().sort((a, b) => nightly(a) - nightly(b))) {
    if (f.source === 'interval') { kept.push(f); continue; }
    const key = `${f.stayId}|${String(f.from).slice(0, 7)}`;
    const c = buckets.get(key) || 0;
    if (c >= n) continue;
    buckets.set(key, c + 1);
    kept.push(f);
  }
  return kept;
}

const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;

/**
 * A find as post_deal wants it. Null when there is no honest price at all.
 *
 * Points are ALL-IN — the owner's ask, times points to the dollar, plus the Circle's share —
 * which is the same arithmetic the website uses for a live VakayMood card. The watcher used to
 * leave the share out, so the identical week was fifteen per cent cheaper on the board than on
 * the live card beside it.
 */
export function asDeal(f, cfg, settings = {}) {
  const ppd = Number(settings.pointsPerDollar) || cfg.pointsPerUsd || 100;
  const rate = Number(settings.serviceRate) || 0;
  const pricedByUs = !(f.usdTotal > 0);
  const usd = pricedByUs ? (f.source === 'interval' && f.ourPrice > 0 ? f.ourPrice : 0) : f.usdTotal;
  if (!(usd > 0)) return null;
  // RedWeek rows carry the resort under `ourName` (the catalog's spelling), Interval's under
  // `resortName`. Taking only one of them left every RedWeek deal titled "3 Bedroom Villa, Ocean
  // view" with no hint of where it was.
  const place = f.resortName || f.ourName || '';
  const unit = f.unit || f.unitCode || '';
  const nightly = f.usdNightly > 0 ? f.usdNightly : usd / Math.max(1, f.nights || 1);
  const owner = f.source === 'redweek' || f.source === 'vakaymood';
  return {
    stayId: f.stayId, from: f.from, to: f.to, nights: f.nights,
    usdTotal: usd, pointsTotal: Math.round(usd * ppd * (1 + rate)),
    // externalId is already unique within a source; prefixing here and there gave
    // "interval:interval:…" and, worse, let two resorts sharing a week and a price collide.
    sourceRef: String(f.externalId).startsWith(`${f.source}:`) ? String(f.externalId) : `${f.source}:${f.externalId}`,
    source: f.source, url: f.url || '', unit,
    // An owner's ask is titled as what it is. "Saving" is a word for the card to earn against the
    // public rate, not for the title to claim.
    title: owner
      ? [place, unit, `owner asking ${money(nightly)} a night on ${f.source === 'redweek' ? 'RedWeek' : 'VakayMood'}`].filter(Boolean).join(' · ')
      : [place, unit].filter(Boolean).join(' · ') || 'A week that came up',
    note: [unit, f.sleeps ? `sleeps ${f.sleeps}` : '', f.view, f.protected ? 'RedWeek protects the payment' : '',
           pricedByUs ? 'Interval showed no price — this is our own rate for those nights; Victor confirms before he quotes' : '',
           !pricedByUs && f.saves > 0 ? `${money(f.saves)} under our rate` : ''].filter(Boolean).join(' · '),
    // The resort's public rate for these nights, so the card's "under the public rate" line is
    // exactly that — not the Circle's own rate dressed up as retail.
    retailUsd: f.retailPrice || null,
    // A week that has started cannot be booked. Off the board by itself on the check-in day.
    expiresAt: `${f.from}T12:00:00Z`,
  };
}

/** The same week from two sources is one week. Stay, nights, and the unit as words. */
export const dedupeKey = (d) => `${d.stayId}|${d.from}|${d.to}|${normName(d.unit || '')}`;
