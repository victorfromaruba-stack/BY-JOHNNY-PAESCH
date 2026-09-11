// Owner-rented weeks open on VakayMood, as deals.
//
// VakayMood is the one source the app can genuinely watch by machine: a free public API with
// CORS open to any origin, so the member's own browser makes the call and there is no key and no
// server in the middle. What it carries is owner rentals at the timeshare resorts the Circle
// already books — a studio at the Surf Club, a one-bedroom at the Ocean Club. It is NOT Interval:
// what Victor finds on Interval reaches members through the board, posted by him or by the
// watcher on his VPS.
//
// This used to be its own screen with seven filters, then a section of Deals with the same seven,
// and a second card shape next to the board's. Victor: "I only need the best deals on the market."
// So it is now one function — openWeeks() — that returns what is open in the SAME shape as a
// posted deal, and the Stays page lists both in one list, cheapest a night first. One card, one
// button, one sort.
//
// Two things it is careful about:
//   · the points on an owner's week are that owner's price at face value plus the Circle's share
//     — the number the Circle would actually charge if Victor books that week at that price. It
//     never invents a "saving" against a room we do not have on file;
//   · it never claims to have booked anything, and never says "available". A week is open on
//     VakayMood at the time shown; asking for it goes through the same quote as everything else.

import { fmtUsd2 } from '../core/util.js';
import { availability, toDeal, RESORTS } from '../data/vakaymood.js';

/** The resorts VakayMood carries that are also in the catalog — the ones the Circle can price and book. */
export const CATALOG_RESORTS = Object.freeze(RESORTS.filter(r => r.stayId));

/** How many bedrooms a VakayMood listing has, from the field or from the unit-type name. */
export function bedroomsOf(d) {
  if (Number.isInteger(d.bedrooms)) return d.bedrooms;
  const t = String(d.unitType || '').toLowerCase();
  if (/studio/.test(t)) return 0;
  const m = t.match(/(\d)\s*bed/);
  return m ? Number(m[1]) : null;
}

/**
 * Several owners often list the identical week at the identical price. They are genuinely
 * different listings, but six identical cards is noise — group them and say how many there are,
 * keeping the first one's booking link.
 */
export function groupCopies(list) {
  const key = (x) => `${x.slug}|${x.unitType}|${x.from}|${x.to}|${x.pointsTotal}`;
  const out = [];
  const byKey = new Map();
  for (const x of list) {
    const k = key(x);
    if (byKey.has(k)) { byKey.get(k).copies += 1; continue; }
    const row = { ...x, copies: 1 };
    byKey.set(k, row); out.push(row);
  }
  return out;
}

/**
 * A live listing in the shape of a posted deal, so the board's own card, list and watch
 * matching read it without a second code path. Carries the LIVE stay id — a watch is stored
 * against whatever this backend calls the place, and the bundled id would never match on
 * production. `draft` marks it as not on the board: the Desk can put it there.
 */
export function draftDealFrom(store, d, { generatedAt = null } = {}) {
  const stay = d.stayId ? store.stayLike(d.stayId) : null;
  if (!stay) return null;
  const note = [
    d.sleeps ? `sleeps ${d.sleeps}` : '',
    `owner asking ${fmtUsd2(d.usdNightly)} a night, ${fmtUsd2(d.usdTotal)} all in`,
    d.copies > 1 ? `${d.copies} owners have it` : '',
    d.flexibleDates && d.lastBookableCheckin ? `any start up to ${d.lastBookableCheckin}` : '',
  ].filter(Boolean).join(' · ');
  return {
    id: `vm:${d.externalId}`, draft: true, externalId: d.externalId, status: 'live', kind: 'aruba', stayId: stay.id,
    roomTypeId: null,
    title: `${stay.name}${d.unitType ? ` · ${d.unitType}` : ''}`,
    from: d.from, to: d.to, nights: d.nights,
    pointsTotal: d.pointsTotal, pointsPerNight: d.pointsPerNight,
    // No "under the public rate" line: the catalog's public rate is for the room the headline
    // rate is modelled on, and a studio against a villa's rate is a saving nobody is getting.
    retailUsd: null,
    source: 'vakaymood', sourceUrl: d.bookingUrl || '', sourceRef: `vakaymood:${d.externalId}`,
    units: d.copies || 1, note,
    unitType: d.unitType || '', sleeps: d.sleeps ?? null, bedrooms: bedroomsOf(d),
    usdNightly: d.usdNightly, usdTotal: d.usdTotal, usdSubtotal: d.usdSubtotal, usdFees: d.usdFees,
    postedAt: generatedAt || new Date().toISOString(),
    // Open until the end of the check-in day in Aruba (UTC−4): a week that starts today is
    // still open this afternoon.
    expiresAt: new Date(Date.parse(`${d.from}T23:59:59-04:00`)).toISOString(),
  };
}

/**
 * The Circle's own copy of what is open, published with the site by .github/workflows/open-weeks.yml
 * every half hour. A phone in Aruba could not reach vakaymood.com at all — every call failed,
 * twice — so when the live feed does not answer, the page reads this from its own address and
 * says when the copy was taken. Fetched once per page load; a missing file is simply "no copy".
 */
let copyPromise = null;
const loadCopy = () => (copyPromise ||= fetch('data/open-weeks.json', { cache: 'no-cache' })
  .then(r => (r.ok ? r.json() : null)).catch(() => null));

function fromCopy(copy, slugs, s) {
  const rows = [];
  let total = 0;
  for (const slug of slugs) {
    const r = copy?.resorts?.[slug];
    if (!r) continue;
    total += r.total || 0;
    for (const l of r.listings || []) rows.push(toDeal(l, { pointsPerDollar: s.pointsPerDollar, serviceRate: s.serviceRate }));
  }
  return { rows, total, generatedAt: copy?.generatedAt || null };
}

const byPrice = (a, b) => a.pointsTotal - b.pointsTotal || String(a.from).localeCompare(String(b.from));

/**
 * What owners have open right now, as draft deals, cheapest first. One call per place we book
 * (or one for `slug`), the Circle's copy when the live feed does not answer, and an honest
 * empty when neither does. Never throws: the page it feeds must paint the board either way.
 *
 * Returns { deals, total, generatedAt, fromCopy, failed, error, blocked }.
 */
export async function openWeeks(store, { slug = null, limit = 24 } = {}) {
  const s = store.settings;
  const ask = (extra) => availability({ sort: 'price_asc', pointsPerDollar: s.pointsPerDollar, serviceRate: s.serviceRate, ...extra });
  const slugs = slug ? [slug] : CATALOG_RESORTS.map(r => r.slug);
  const finish = (rows, total, generatedAt, extra = {}) => {
    const grouped = groupCopies(rows.slice().sort(byPrice));
    const deals = grouped.map(d => draftDealFrom(store, d, { generatedAt })).filter(Boolean);
    return { deals, total, generatedAt, fromCopy: false, failed: 0, error: null, blocked: false, ...extra };
  };
  try {
    // One call per place, in parallel, then merged. The island carries thousands of owner weeks at
    // resorts we do not use, so one island-wide page filtered afterwards showed five of ours under
    // a count of two thousand — which read as "nothing open" to a member.
    const settled = await Promise.allSettled(slugs.map(sl => ask({ slug: sl, page: 1, limit: slug ? limit : 12 })));
    const ok = settled.filter(x => x.status === 'fulfilled').map(x => x.value);
    if (!ok.length) throw settled[0].reason;
    return finish(ok.flatMap(x => x.deals), ok.reduce((n, x) => n + x.total, 0), ok.find(x => x.generatedAt)?.generatedAt || null,
      { failed: settled.length - ok.length });
  } catch (err) {
    const copy = await loadCopy();
    if (copy && slugs.some(sl => copy.resorts?.[sl])) {
      const got = fromCopy(copy, slugs, s);
      return finish(got.rows, got.total, got.generatedAt, { fromCopy: true });
    }
    // A request that never got an answer is this phone's network path — mobile data, a content
    // blocker, a DNS filter — not a problem with the Circle.
    return { deals: [], total: 0, generatedAt: null, fromCopy: false, failed: slugs.length,
      error: err?.message || 'VakayMood did not answer', blocked: /from this device/i.test(err?.message || '') };
  }
}

/** The catalog resort VakayMood carries for this stay, resolved across backends, or null. */
export function resortForStay(store, stay) {
  if (!stay || stay.kind === 'trip') return null;
  return CATALOG_RESORTS.find(r => store.stayLike(r.stayId)?.id === stay.id) || null;
}
