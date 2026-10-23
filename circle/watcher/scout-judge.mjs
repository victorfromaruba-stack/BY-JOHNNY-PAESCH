// What the deal scout makes of one item. Pure: no clock but the `now` it is given, no network.
//
//   great  >= 25% under the resort's PUBLIC rate   (posted, e-mailed at once)
//   good   >= 15% under                              (posted, in the daily digest)
//   tip    worth a look but nothing honest to compare with (The Room, #deals)
//   drop   not about an Aruba stay (or a Caribbean all-inclusive from our airports), or no price
//   reject a figure that cannot be true (judge.mjs's floor and ceiling), or dates that do not add up
//
// A baseline is only ever the catalog's own public rate for a resort the item NAMES. Never invented.

import { resolveStay, implausiblyCheap, implausiblyDear } from './judge.mjs';
import { rateBandFor } from '../js/core/money.js';

export const GREAT = 0.25, GOOD = 0.15;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const M = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
export const arubaToday = (now = Date.now()) => new Date(now - 4 * 3600e3).toISOString().slice(0, 10);
const iso = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const diffDays = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);

/** Check-in and check-out the TEXT states ("Nov 2-9", "Nov 28 - Dec 5, 2026"), or null. A missing year means the next one coming. */
export function statedDates(t, now = Date.now()) {
  const today = new Date(now - 4 * 3600e3).toISOString().slice(0, 10);
  let m = t.match(new RegExp(`\\b${M}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:-|–|—|to|through|thru)\\s*(?:${M}\\s+)?(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(20\\d\\d))?\\b`, 'i'));
  if (!m) return null;
  const m1 = MONTHS.indexOf(m[1].toLowerCase().slice(0, 3)), d1 = +m[2];
  const m2 = m[3] ? MONTHS.indexOf(m[3].toLowerCase().slice(0, 3)) : m1, d2 = +m[4];
  let y = m[5] ? +m[5] : +today.slice(0, 4);
  let from = iso(y, m1, d1);
  if (!m[5] && from < today) from = iso(++y, m1, d1);
  const to = iso(m2 < m1 ? +from.slice(0, 4) + 1 : +from.slice(0, 4), m2, d2);
  const n = diffDays(from, to);
  return n >= 1 && n <= 21 && from >= today ? { from, to, nights: n } : null;
}


/** Bedrooms a unit description states: "Studio" 0, "2 Bedroom" 2, anything else unknown (null). */
export function bedroomsOf(text) {
  const t = String(text || '');
  if (/\bstudio\b/i.test(t)) return 0;
  const m = t.match(/\b(\d)[- ]?(?:bed(?:room)?s?|br)\b/i) || t.match(/\b(one|two|three)[- ]bedroom/i);
  return m ? ({ one: 1, two: 2, three: 3 }[String(m[1]).toLowerCase()] ?? +m[1]) : null;
}

/**
 * The like-for-like baseline for a room of `bedrooms` at `stay` over these nights, or null when the catalog has no room of that size.
 *
 * stays.retail_usd is a DEAR-season figure for the property's headline room, and rate_low/high/peak are the Circle's own rates
 * for that same room; room_types.rate_factor scales to other rooms. So, night by night (as quote_points does):
 *   public = retail x (band rate / rate_high) x factor     ours = band rate x factor
 * The factor is the CHEAPEST catalog room with that many bedrooms, so "under the public rate" holds whichever view the owner's unit has.
 * Never a flat retail x nights (that is what made 64 weeks "68% under").
 */
export function baselineFor(stay, rooms, bedrooms, from, nights) {
  const high = Number(stay?.rate_high_usd), retail = Number(stay?.retail_usd);
  if (!(high > 0) || !(retail > 0) || bedrooms == null || !(nights > 0)) return null;
  const factors = (rooms || []).filter((r) => r.bedrooms === bedrooms && Number(r.rate_factor) > 0).map((r) => Number(r.rate_factor));
  if (!factors.length) return null;
  const f = Math.min(...factors), start = Date.parse(`${from}T12:00:00Z`);
  let pub = 0, ours = 0;
  for (let i = 0; i < nights; i++) {
    const band = rateBandFor(`${new Date(start + i * 864e5).toISOString().slice(0, 10)}T12:00:00Z`);
    const rate = Number(stay[`rate_${band}_usd`]);
    if (!(rate > 0)) return null;
    pub += retail * (rate / high) * f; ours += rate * f;
  }
  return { public: Math.round(pub * 100) / 100, ours: Math.round(ours * 100) / 100, factor: f };
}

/** great/good only if under the like-for-like public rate AND no dearer than the Circle's own price for the same room. */
function classify(total, base) {
  const pct = 1 - total / base.public;
  if (total > base.ours) return { cls: 'drop', pct, why: `${Math.round(pct * 100)}% under public but dearer than the Circle's own $${Math.round(base.ours)}` };
  return { cls: pct >= GREAT ? 'great' : pct >= GOOD ? 'good' : 'drop', pct, why: `${Math.round(pct * 100)}% under public` };
}

/** The first USD figure and what it is a price OF. Other currencies are read but never compared. */
export function statedPrice(t) {
  const m = t.match(/(US\$|\$|£|€)\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?/);
  if (!m) return null;
  const amount = Number(m[2].replace(/,/g, '') + (m[3] ? `.${m[3]}` : ''));
  const after = t.slice(m.index, m.index + 60);
  return {
    amount, usd: m[1] !== '£' && m[1] !== '€', currency: m[1] === '£' ? 'GBP' : m[1] === '€' ? 'EUR' : 'USD',
    perNight: /^[^.]{0,40}?(\/\s?night|per night|a night|nightly|each night)/i.test(after),
    perPerson: /(per person|\bpp\b|p\.p\.|\beach\b|per adult|\/\s?person)/i.test(t),
  };
}

const CARIB = /(caribbean|punta cana|dominican|cancun|riviera maya|jamaica|montego|bahamas|nassau|curacao|cura[cç]ao|bonaire|st\.? lucia|barbados|turks|cayman|antigua|st\.? maarten|sint maarten|puerto plata|cozumel)/i;
const ORIGINS = /\b(MIA|miami|JFK|EWR|new york|newark|BOS|boston|LIM|lima|BOG|bogot[aá]|PTY|panama|MDE|medell[ií]n)\b/i;
const AIR = /(w\/\s?(air|flights?)|with (air|flights?)|\+ ?flights?|incl(uding|udes)? (air|flights?)|airfare|roundtrip air)/i;

/**
 * Judge one feed item. `item` = { title, summary, link, id, published }.
 * Returns { cls, why, find?, pct?, price?, nights? } — `find` is the shape judge.mjs/board.mjs post.
 */
export function judgeItem(item, { catalog, cfg = {}, now = Date.now(), source = 'feed', tipOnly = false } = {}) {
  const t = `${item.title}. ${item.summary || ''}`;
  const aruba = /\baruba\b|oranjestad|eagle beach|palm beach, aruba/i.test(t);
  // A Caribbean all-inclusive package counts when it leaves from one of our airports, or names no departure city at all (Travelzoo's
  // are sold from the reader's own city). One that names a city we do not fly from ("from Chicago") is not ours.
  const dep = (t.match(/\b(?:from|ex|departing)\s+([A-Z][A-Za-z.]+(?: [A-Z][A-Za-z.]+)?)/) || [])[1];
  const carib = !aruba && CARIB.test(t) && /all[- ]inclusive/i.test(t) && (!dep || ORIGINS.test(dep));
  // A forum post is a tip only if its TITLE smells like a deal; the body is HTML noise.
  if (tipOnly) return /\b(deal|cheap|discount|sale|promo|offer|free|resale|price|sold|buy|\$\s?\d)/i.test(item.title) && (aruba || /timeshare|resale|points|week/i.test(t)) ? { cls: 'tip', why: 'forum post, tip only' } : { cls: 'drop', why: 'no deal in the title' };
  if (!aruba && !carib) return { cls: 'drop', why: 'not Aruba, not a Caribbean all-inclusive from our airports' };
  const price = statedPrice(t);
  if (!price) return { cls: 'drop', why: 'no price stated' };
  const dates = statedDates(t, now);
  const nights = dates?.nights || Number((t.match(/(\d{1,2})[- ]nights?/i) || [])[1]) || null;
  const base = { price, nights };
  if (!price.usd) return { cls: 'tip', why: `priced in ${price.currency}; no baseline`, ...base };
  const nightly = price.perNight ? price.amount : nights ? price.amount / nights : price.amount;
  // The same two tests every posted week passes (judge.mjs): $40 floor, $1,500 ceiling, per night.
  const probe = { nights: nights || 1, usdNightly: nightly, usdTotal: price.perNight ? nightly * (nights || 1) : price.amount };
  if (nights && (implausiblyCheap(probe, cfg) || implausiblyDear(probe, cfg))) return { cls: 'reject', why: `$${Math.round(nightly)} a night cannot be true`, ...base };
  if (!nights && (price.perNight && (nightly < (cfg.minNightly ?? 40) || nightly > (cfg.maxPlausibleNightly ?? 1500)))) return { cls: 'reject', why: `$${Math.round(nightly)} a night cannot be true`, ...base };
  // Comparable with a public room rate only if: Aruba, a catalog resort named, hotel-only, for the room (not per person), dates and nights stated.
  const stayId = aruba ? resolveStay({ text: t }, catalog) : null;
  const comparable = stayId && dates && !AIR.test(t) && !price.perPerson && (price.perNight || /\btotal\b|for \d+ nights?/i.test(t));
  if (!comparable) return { cls: 'tip', why: !stayId ? 'no catalog resort named' : AIR.test(t) ? 'package with flights' : price.perPerson ? 'per person' : !dates ? 'no dates stated' : 'total or per-night not stated', ...base };
  const total = price.perNight ? Math.round(price.amount * dates.nights * 100) / 100 : price.amount;
  const br = bedroomsOf(t);
  const bl = baselineFor(catalog.get(stayId), cfg.rooms?.get(stayId), br, dates.from, dates.nights);
  if (!bl) return { cls: 'tip', why: br == null ? 'room size not stated' : 'no comparable room in the catalog', ...base };
  const { cls, pct, why } = classify(total, bl);
  const retail = bl.public;
  const find = {
    source: 'other', externalId: `${source}:${Buffer.from(String(item.id)).toString('base64url').slice(-24)}`, stayId,
    resortName: catalog.get(stayId).name, unit: `${source} offer`, from: dates.from, to: dates.to, nights: dates.nights,
    usdTotal: total, usdNightly: Math.round(total / dates.nights * 100) / 100, url: item.link, retailPrice: retail, retailLocked: true,
  };
  return { cls, why, pct, find: { ...find, ourPrice: bl.ours }, ...base };
}

/** A VakayMood listing (toDeal's shape) against the catalog: great, good, or not worth a post. */
export function judgeListing(l, { catalog, cfg = {}, now = Date.now() }) {
  const stayId = resolveStay({ resortName: l.resortName }, catalog);
  if (!stayId) return { cls: 'drop', why: 'resort not in the catalog' };
  const nights = l.nights || 0;
  if (l.from < arubaToday(now)) return { cls: 'drop', why: 'check-in already past' };
  if (!(l.usdTotal > 0) || !(nights > 0) || !l.from || !l.to) return { cls: 'drop', why: 'no price or dates' };
  if (nights !== diffDays(l.from, l.to)) return { cls: 'reject', why: 'nights do not match the dates' };
  const probe = { nights, usdTotal: l.usdTotal, usdNightly: l.usdTotal / nights };
  if (implausiblyCheap(probe, cfg) || implausiblyDear(probe, cfg)) return { cls: 'reject', why: `$${Math.round(probe.usdNightly)} a night cannot be true` };
  const br = l.bedrooms ?? bedroomsOf(l.unitType);
  const bl = baselineFor(catalog.get(stayId), cfg.rooms?.get(stayId), br, l.from, nights);
  if (!bl) return { cls: 'tip', why: br == null ? 'room size not stated' : 'no comparable room in the catalog' };
  const { cls, pct, why } = classify(l.usdTotal, bl);
  return { cls, pct, why, find: {
    source: 'vakaymood', externalId: l.externalId, stayId, resortName: catalog.get(stayId).name, unit: l.unitType, sleeps: l.sleeps,
    from: l.from, to: l.to, nights, usdTotal: l.usdTotal, usdNightly: Math.round(l.usdTotal / nights * 100) / 100, url: l.bookingUrl,
    retailPrice: bl.public, retailLocked: true, ourPrice: bl.ours, fees: l.usdFees || 0 } };
}
