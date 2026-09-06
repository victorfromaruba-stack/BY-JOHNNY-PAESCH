// VakayMood — live timeshare rental availability.
//
// This is the one source in the whole plan that can genuinely be watched by a machine.
// Interval and RedWeek both forbid automated access in their terms and have no API;
// VakayMood publishes a free, read-only, unauthenticated JSON API with CORS open to any
// origin, so the browser calls it directly. No key, no server, nothing secret in this repo.
//
//   https://vakaymood.com/developers   ·   https://vakaymood.com/api/v1/openapi.json
//
// What it carries is exactly what the Circle books: owner-rented timeshare weeks at the
// resorts we already use. A two-bedroom at the Surf Club that sleeps eight has appeared
// here at $250 a night against our own modelled rate of $285.
//
// Two things the published docs get wrong, found by calling it:
//   · the `resort` filter needs the FULL slug. The RR code alone returns zero, though the
//     docs say it is accepted. RESORTS below therefore stores slugs.
//   · `limit` caps at 100, not the stated default of 25 with no ceiling.
//
// Rate limit is 60 requests a minute per IP. Because each member's own browser makes the
// call, that budget is per person rather than shared, and responses are CDN-cached for a
// minute anyway. We still cache in memory so switching tabs costs nothing.

const BASE = 'https://vakaymood.com/api/v1';
const TIMEOUT_MS = 12000;
const CACHE_MS = 60000;          // matches their s-maxage; no point asking again sooner

/**
 * The Aruba resorts VakayMood carries, tied to our own catalog where we have a match.
 * `stayId` null means it is real inventory at a property we have not catalogued — the Desk
 * sees it and can add the property, but it cannot be priced in points until they do.
 */
export const RESORTS = Object.freeze([
  { slug: 'marriotts-aruba-surf-club-palm-beach-RR17209859', name: "Marriott's Aruba Surf Club", stayId: 'stay_surfclub', house: true },
  { slug: 'marriotts-aruba-ocean-club-palm-beach-RR64522038', name: "Marriott's Aruba Ocean Club", stayId: 'stay_oceanclub', house: true },
  { slug: 'renaissance-wind-creek-aruba-resort-oranjestad-RR42744828', name: 'Renaissance Wind Creek Aruba Resort', stayId: 'stay_renaissance', house: true },
  { slug: 'barcelo-aruba-palm-beach-RR08981265', name: 'Barceló Aruba', stayId: 'stay_barcelo' },
  { slug: 'eagle-aruba-resort-oranjestad-RR74926333', name: 'Eagle Aruba Resort & Casino', stayId: 'stay_eagle' },
  { slug: 'divi-aruba-phoenix-beach-resort-palm-beach-RR30631633', name: 'Divi Aruba Phoenix Beach Resort', stayId: null },
  { slug: 'divi-village-golf-and-beach-resort-oranjestad-RR78228943', name: 'Divi Village Golf & Beach Resort', stayId: null },
  { slug: 'divi-dutch-village-beach-resort-oranjestad-RR61073401', name: 'Divi Dutch Village Beach Resort', stayId: null },
  { slug: 'playa-linda-beach-resort-palm-beach-RR79391486', name: 'Playa Linda Beach Resort', stayId: null },
  { slug: 'la-cabana-beach-resort-oranjestad-RR29564768', name: 'La Cabana Beach Resort', stayId: null },
  { slug: 'costa-linda-beach-resort-oranjestad-RR65180256', name: 'Costa Linda Beach Resort', stayId: null },
  { slug: 'casa-del-mar-beach-resort-oranjestad-RR77446590', name: 'Casa del Mar Beach Resort', stayId: null },
  { slug: 'la-quinta-beach-resort-oranjestad-RR77558999', name: 'La Quinta Beach Resort', stayId: null },
  { slug: 'paradise-beach-villas-oranjestad-RR77419902', name: 'Paradise Beach Villas', stayId: null },
]);

export const stayIdForSlug = (slug) => RESORTS.find(r => r.slug === slug)?.stayId || null;
/** Their resort id (RR…) is the tail of the slug, which is what a person recognises. */
export const rrCode = (slug) => String(slug).split('-').pop();

const cache = new Map();

async function getJson(path, params = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== ''));
  const url = `${BASE}${path}${qs.toString() ? `?${qs}` : ''}`;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after')) || 60;
      throw new Error(`VakayMood is rate-limiting us — try again in ${wait} seconds.`);
    }
    const body = await res.json().catch(() => null);
    if (!res.ok || body?.error) throw new Error(body?.error?.message || `VakayMood returned ${res.status}`);
    cache.set(url, { at: Date.now(), value: body });
    return body;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('VakayMood did not answer in time.');
    // A failed fetch from the browser is almost always the network, not them.
    if (/failed to fetch|networkerror/i.test(err.message)) throw new Error('Could not reach VakayMood from this device.');
    throw err;
  } finally { clearTimeout(timer); }
}

/**
 * One listing, in the shape the rest of the app already speaks. Prices are converted at the
 * club's own rate, so a member sees points beside the dollars everywhere else they look.
 *
 * `total` is the honest number: what is charged at booking PLUS the fees the resort takes at
 * the desk. Quoting the nightly rate alone would understate a week by a few hundred dollars.
 */
export function toDeal(listing, { pointsPerDollar = 100 } = {}) {
  const p = listing.pricing || {};
  const usdTotal = Number(p.total ?? p.subtotal ?? 0);
  const nights = Number(listing.nights) || 1;
  const slug = listing.resort?.slug || '';
  return {
    externalId: listing.listingId,
    source: 'vakaymood',
    slug,
    stayId: stayIdForSlug(slug),
    resortName: listing.resort?.name || 'A resort',
    city: listing.resort?.city || '', country: listing.resort?.country || '',
    unitType: listing.unitType || '',
    sleeps: listing.sleeps ?? null,
    bedrooms: listing.bedrooms ?? null,
    from: listing.checkin, to: listing.checkout, nights,
    flexibleDates: !!listing.flexibleDates,
    lastBookableCheckin: listing.lastBookableCheckin || null,
    usdNightly: Number(p.nightly ?? (usdTotal / nights)),
    usdSubtotal: Number(p.subtotal ?? 0),
    usdFees: Number(p.feesTotal ?? 0),
    feeLines: (p.fees || []).map(f => ({ name: f.name, amount: Number(f.amount) })),
    usdTotal,
    pointsTotal: Math.round(usdTotal * pointsPerDollar),
    pointsPerNight: Math.round((usdTotal / nights) * pointsPerDollar),
    bookingUrl: listing.bookingUrl || '',
  };
}

/**
 * Live availability. Everything is optional; with nothing set it returns Aruba, soonest
 * first, which is what the club wants nine times out of ten.
 */
export async function availability({
  slug = null, location = 'Aruba', checkin = null, checkout = null,
  sleeps = null, maxNightlyUsd = null, brand = null,
  sort = 'start_asc', page = 1, limit = 40, pointsPerDollar = 100,
} = {}) {
  const body = await getJson('/availability', {
    resort: slug, location: slug ? null : location,
    checkin, checkout, sleeps, max_nightly_price: maxNightlyUsd, brand,
    sort, page, limit: Math.min(100, Math.max(1, limit)),
  });
  return {
    deals: (body.results || []).map(l => toDeal(l, { pointsPerDollar })),
    total: body.pagination?.total ?? 0,
    page: body.pagination?.page ?? page,
    limit: body.pagination?.limit ?? limit,
    generatedAt: body.generatedAt || null,
  };
}

/** The cheapest live week at each of the club's own properties. One call per resort. */
export async function cheapestAtHouseResorts({ pointsPerDollar = 100 } = {}) {
  const house = RESORTS.filter(r => r.house);
  const out = await Promise.all(house.map(async (r) => {
    try {
      const { deals, total } = await availability({ slug: r.slug, sort: 'price_asc', limit: 1, pointsPerDollar });
      return { resort: r, total, cheapest: deals[0] || null, error: null };
    } catch (err) { return { resort: r, total: 0, cheapest: null, error: err.message }; }
  }));
  return out;
}

export async function listing(id) { return getJson(`/listings/${encodeURIComponent(id)}`); }
export async function resort(idOrSlug) { return getJson(`/resorts/${encodeURIComponent(idOrSlug)}`); }

/** Only for tests — lets a suite start from a known-empty cache. */
export const _clearCache = () => cache.clear();
