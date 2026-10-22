// What Ian works out about a price, so the model never has to.
//
// Every figure Ian may say comes out of here or straight off a row: per night, the total all in,
// the owner's ask, the fee on top of it, the public rate for the same nights, how old the read is.
// The model is told to quote these and nothing else, and the number guard in ian.ts holds it to
// that. Pure functions, no network, so each rule has a test (concierge.test.ts).
//
// Mirrors js/core/money.js (rateBandFor, the 15% share, the public rate scaled by band as
// quote_points does in SQL) and watcher/judge.mjs (an owner week's title and total). If one of
// those changes, change this too.

export const STALE_DAYS = 2;                 // deals.js STALE_AFTER: older than this, offer a fresh look
// Victor, 22 Oct 2026, after a Barceló week "owner asking $9 a night" seen 16 Oct sat at No. 1 on Stays:
// Ian recommends only a week seen in the last 48 hours, and shows an older one as "last seen N days ago, tap
// to re-check". A watched row not seen for 7 days is retired by the database (retire_stale_deals) and Ian
// never offers one that has not been caught up with yet. Mirrors js/core/freshness.js; a test holds the two.
export const FRESH_HOURS = 48;
export const RETIRE_DAYS = 7;
export const WATCHED_SOURCES = ['redweek', 'interval', 'vakaymood'];
export const FEE_TRAP = 0.10;                // fees more than 10% on top of the ask are worth saying
export const NEXT_DOOR_DAYS = 7;             // "a cheaper week next door": check-in within a week
// watcher/judge.mjs implausiblyCheap: under $40 a night is a misread listing, not a bargain. On 17 Oct
// the board offered Barceló at Christmas for $71 a week; it was still on the board on 22 Oct.
export const FLOOR_NIGHTLY = 40;
// watcher/judge.mjs implausiblyDear (0b6c283): over $1,500 a night is a lost decimal point, not a price.
export const CEILING_NIGHTLY = 1500;
// Far outside what the place itself charges: over 3x its dearest night or under a quarter of its
// cheapest, all in. Generous on purpose (a villa is not a studio); it is there for misreads.
export const BAND_HIGH = 3, BAND_LOW = 0.25;
export const LOOKS_WRONG = 'looks wrong, not quoted';

/** Why a per-night price cannot be real, or null when it can. */
export function implausibleWhy(nightly: number, stay?: Stay) {
  if (!(nightly > 0)) return null;
  if (nightly < FLOOR_NIGHTLY) return `under $${FLOOR_NIGHTLY} a night`;
  if (nightly > CEILING_NIGHTLY) return `over $${CEILING_NIGHTLY.toLocaleString('en-US')} a night`;
  const rates = [stay?.rate_low_usd, stay?.rate_high_usd, stay?.rate_peak_usd].map(Number).filter(n => n > 0);
  if (rates.length) {
    const hi = Math.max(...rates) * 1.15 * BAND_HIGH, lo = Math.min(...rates) * 1.15 * BAND_LOW;
    if (nightly > hi) return 'more than three times the dearest night this place charges';
    if (nightly < lo) return 'under a quarter of the cheapest night this place charges';
  }
  return null;
}

export type Settings = { pointsPerDollar: number; serviceRate: number; tiers?: Tier[] };
export type Tier = { monthlyUsd: number; bonusRate: number };
export type Stay = {
  id: string; name: string; rate_low_usd?: number | null; rate_high_usd?: number | null; rate_peak_usd?: number | null;
  retail_usd?: number | null; min_nights?: number | null; peak_min_nights?: number | null;
};
export type Deal = {
  id: string; stay_id: string; from_date: string; to_date: string; nights: number; points_total: number;
  points_per_night?: number | null; source: string; source_url?: string | null; title?: string | null;
  note?: string | null; seen_at?: string | null; posted_at?: string | null;
};

const DAY = 864e5;
const HOUR = 36e5;
const day = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const r0 = (n: number) => Math.round(n);

// ---------------------------------------------------------------- the calendar (money.js)
function easterSunday(y: number) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4,
    f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30,
    i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
    month = Math.floor((h + l - 7 * m + 114) / 31), dd = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(y, month - 1, dd, 12);
}
/** Which of a stay's three rates applies on a night. Same answer as money.js and season_for(). */
export function rateBandFor(isoDay: string): 'low' | 'high' | 'peak' {
  const d = day(isoDay); const md = (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  if (md >= 1220 || md <= 103) return 'peak';
  const ash = easterSunday(d.getUTCFullYear()) - 46 * DAY;
  const start = ash - 10 * DAY, end = ash + DAY;           // Sunday before the parade to Ash Wednesday
  if (+d >= start && +d < end) return 'peak';
  if (md >= 104 && md <= 405) return 'high';
  return 'low';
}
/** How many of the nights from..to fall in each band. */
export function bandNights(from: string, to: string) {
  const out = { low: 0, high: 0, peak: 0 };
  for (let t = +day(from); t < +day(to); t += DAY) out[rateBandFor(iso(new Date(t)))]++;
  return out;
}

/** "last seen 3 days ago, tap to re-check" for a week that is not fresh; "seen 5 hours ago" for one that is. Plain words, never a verdict. */
export function lastSeenWords(seenMs: number | null, now = Date.now()): string {
  if (seenMs == null) return 'no record of when this was last seen, tap to re-check';
  const ms = Math.max(0, now - seenMs);
  if (ms <= FRESH_HOURS * HOUR) {
    if (ms < HOUR) return `seen ${Math.max(1, Math.round(ms / 60e3))} min ago`;
    const h = Math.round(ms / HOUR);
    return `seen ${h} hour${h === 1 ? '' : 's'} ago`;
  }
  const n = Math.floor(ms / DAY);
  return `last seen ${n} day${n === 1 ? '' : 's'} ago, tap to re-check`;
}

// ---------------------------------------------------------------- one row on the board
/** The owner's nightly ask, read off the title the watcher writes ("owner asking $166 a night"). */
export function ownerAsk(title?: string | null): number | null {
  const m = String(title || '').match(/owner asking \$([\d,]+(?:\.\d+)?) a night/i);
  return m ? Number(m[1].replace(/,/g, '')) : null;
}

/** The resort's public rate for those nights, moved with the calendar the way quote_points moves it. */
export function publicTotal(stay: Stay | undefined, from: string, to: string): number | null {
  const retail = Number(stay?.retail_usd);
  if (!stay || !(retail > 0)) return null;
  const anchor = Number(stay.rate_high_usd) || 0;
  let sum = 0;
  for (let t = +day(from); t < +day(to); t += DAY) {
    const band = rateBandFor(iso(new Date(t)));
    const rate = Number(band === 'peak' ? stay.rate_peak_usd : band === 'high' ? stay.rate_high_usd : stay.rate_low_usd) || 0;
    sum += retail * (anchor > 0 ? rate / anchor : 1);
  }
  return r0(sum);
}

/**
 * Everything worth knowing about one week on the board, as whole dollars and whole points.
 * Nulls are spelled out in words by the caller; nothing here guesses.
 */
export function dealFacts(d: Deal, stay: Stay | undefined, s: Settings, now = Date.now()) {
  const ppd = s.pointsPerDollar || 100;
  const perNightPts = d.points_per_night || (d.nights ? Math.round(d.points_total / d.nights) : 0);
  const totalUsd = d.points_total / ppd;
  const ask = d.source === 'redweek' || d.source === 'vakaymood' ? ownerAsk(d.title) : null;
  // The board's points are the owner's total (fees in) plus the Circle's share; take the share
  // back out and what is left is what the owner is asking in all.
  const ownerTotal = ask ? totalUsd / (1 + (s.serviceRate || 0)) : null;
  const fee = ask && ownerTotal ? ownerTotal - ask * d.nights : null;
  const pub = publicTotal(stay, d.from_date, d.to_date);
  const seen = d.seen_at || d.posted_at;
  const seenMs = seen && Number.isFinite(Date.parse(seen)) ? Date.parse(seen) : null;
  const age = seenMs != null ? Math.floor((now - seenMs) / DAY) : null;
  const fresh = seenMs != null && now - seenMs <= FRESH_HOURS * HOUR;
  const bands = bandNights(d.from_date, d.to_date);
  return {
    deal_id: d.id, stay_id: d.stay_id, place: stay?.name ?? null, source: d.source,
    from: d.from_date, to: d.to_date, nights: d.nights,
    // A Getaway is sold by the week; the per-night figure is that week divided, never bookable nightly.
    per_night_usd: r0(perNightPts / ppd), per_night_points: perNightPts,
    total_usd_all_in: r0(totalUsd), total_points: d.points_total,
    owner_ask_per_night_usd: ask != null ? r0(ask) : null,
    owner_total_usd: ownerTotal != null ? r0(ownerTotal) : null,
    // The title rounds the ask to the dollar, so a few dollars over a week is rounding, not a fee.
    fee_usd: fee != null && fee >= d.nights ? r0(fee) : null,
    fee_trap: !!(ask && fee != null && fee > ask * d.nights * FEE_TRAP),
    public_total_usd: pub,
    // Positive: the Circle's all-in is under the public rate by this much. Negative: it is over.
    under_public_usd: pub != null ? r0(pub - totalUsd) : null,
    implausible: implausibleWhy(ask ?? perNightPts / ppd, stay),
    seen_days_ago: age,
    stale: age != null && age >= STALE_DAYS,
    // Seen in the last 48 hours: the only kind of week Ian recommends.
    fresh,
    last_seen: lastSeenWords(seenMs, now),
    // The database retires these (not seen for 7 days); until the watcher has, Ian does not offer them.
    retired_by_age: WATCHED_SOURCES.includes(d.source) && seenMs != null && now - seenMs > RETIRE_DAYS * DAY,
    peak_nights: bands.peak,
    listing: d.source_url || null,
    note: d.note || null,
  };
}

/** For each week, a cheaper one at the same place starting within a week of it, if there is one. */
export function cheaperNextDoor(facts: ReturnType<typeof dealFacts>[]) {
  const out: Record<string, { deal_id: string; from: string; per_night_usd: number; saves_per_night_usd: number }> = {};
  for (const a of facts) {
    let best: (typeof facts)[number] | null = null;
    for (const b of facts) {
      if (b.deal_id === a.deal_id || b.stay_id !== a.stay_id) continue;
      if (Math.abs(+day(b.from) - +day(a.from)) > NEXT_DOOR_DAYS * DAY) continue;
      if (b.per_night_usd < a.per_night_usd && (!best || b.per_night_usd < best.per_night_usd)) best = b;
    }
    if (best) out[a.deal_id] = { deal_id: best.deal_id, from: best.from, per_night_usd: best.per_night_usd, saves_per_night_usd: a.per_night_usd - best.per_night_usd };
  }
  return out;
}

// ---------------------------------------------------------------- a quote for any dates
/**
 * Season edge: some nights at the peak rate and some not. Looks up to a week either side for the
 * nearest start with no peak nights at all, so Ian can say "three days earlier it is all low".
 */
export function seasonEdge(from: string, to: string) {
  const nights = Math.round((+day(to) - +day(from)) / DAY);
  const peak = bandNights(from, to).peak;
  if (!peak || peak === nights) return null;
  for (let k = 1; k <= 7; k++) {
    for (const dir of [-1, 1]) {
      const f = iso(new Date(+day(from) + dir * k * DAY)), t = iso(new Date(+day(to) + dir * k * DAY));
      if (bandNights(f, t).peak === 0) return { peak_nights: peak, nights, shift_days: k, direction: dir < 0 ? 'earlier' : 'later', from: f, to: t };
    }
  }
  return { peak_nights: peak, nights, shift_days: null, direction: null, from: null, to: null };
}

/** Months to save the gap at the member's level. Same arithmetic as money.js monthsToAfford. */
export function monthsToAfford(s: Settings, points: number, monthlyUsd: number, have: number) {
  const short = Math.max(0, points - Math.max(0, have));
  if (!short) return 0;
  const t = (s.tiers || []).find(x => x.monthlyUsd === monthlyUsd) || { monthlyUsd, bonusRate: 0 };
  const perMonth = Math.round(monthlyUsd * s.pointsPerDollar) + Math.round(monthlyUsd * t.bonusRate * s.pointsPerDollar);
  return perMonth > 0 ? Math.ceil(short / perMonth) : null;
}
