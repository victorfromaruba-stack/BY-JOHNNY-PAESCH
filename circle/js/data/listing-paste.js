// Reading a listing that was copied off Interval or RedWeek.
//
// Neither site has an API and both forbid automated access, so nothing here logs into
// anything. Victor and Ian are already on those sites looking at inventory — this closes the
// gap between "I can see a two-bedroom at the Surf Club for $90 a night" and "it is on the
// Circle's board", which is otherwise a minute of retyping while the week sells.
//
// Select the listing, copy, paste. Everything below is shapes seen in the real pages:
//
//   RedWeek        Sep 11–18, 2026  7 Nights
//                  Verified & Protected
//                  3 Bedroom Villa, Ocean view
//                  Sleeps: 12, Building: Compass
//                  $525/night        $4,031 total
//
//   Interval       Marriott's Aruba Surf Club
//                  Palm Beach · ARUBA · DCB      MSU
//                  Sep 06 2026 - Sep 13 2026
//                  US$90.50 Average Night        Weekly Rate US$633.50
//
// Anything it cannot read is left blank for a person to fill in rather than guessed at.

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const iso = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const nightsBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);
const money = (s) => Number(String(s).replace(/[^0-9.]/g, '')) || 0;

/** Which site this came off, from words only that site uses. */
export function detectSource(text) {
  const t = text.toLowerCase();
  if (/redweek|verified & protected|sleeps:\s*\d|building:\s*\w|\btimeshare (rentals|resales)\b/.test(t)) return 'redweek';
  if (/interval|getaway|average night|weekly rate|resort directory|\bdcb\b/.test(t)) return 'interval';
  return 'other';
}

/**
 * Every date range the two sites print. Returns {from, to} as plain ISO days, or null.
 *   Sep 11–18, 2026     one month, two days, year at the end
 *   Sep 06 2026 - Sep 13 2026
 *   Sep 13 - Oct 3, 2026
 *   09/06/2026 - 09/13/2026
 */
export function parseDates(text) {
  const t = text.replace(/[‐-―]/g, '-').replace(/\s+/g, ' ');

  // Sep 11-18, 2026
  let m = t.match(/\b([A-Za-z]{3,4})\.?\s+(\d{1,2})\s*-\s*(\d{1,2}),?\s*(\d{4})/);
  if (m && MONTHS[m[1].toLowerCase()] !== undefined) {
    const mo = MONTHS[m[1].toLowerCase()], y = +m[4];
    return { from: iso(y, mo, +m[2]), to: iso(y, mo, +m[3]) };
  }
  // Sep 06 2026 - Sep 13 2026  ·  Sep 13 - Oct 3, 2026
  m = t.match(/\b([A-Za-z]{3,4})\.?\s+(\d{1,2}),?\s*(\d{4})?\s*-\s*([A-Za-z]{3,4})\.?\s+(\d{1,2}),?\s*(\d{4})/);
  if (m && MONTHS[m[1].toLowerCase()] !== undefined && MONTHS[m[4].toLowerCase()] !== undefined) {
    const y2 = +m[6], y1 = m[3] ? +m[3] : y2;
    return { from: iso(y1, MONTHS[m[1].toLowerCase()], +m[2]), to: iso(y2, MONTHS[m[4].toLowerCase()], +m[5]) };
  }
  // 09/06/2026 - 09/13/2026 — both sites use US order
  m = t.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\s*-\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return { from: iso(+m[3], +m[1] - 1, +m[2]), to: iso(+m[6], +m[4] - 1, +m[5]) };
  return null;
}

/** The unit as the site describes it: "3 Bedroom Villa, Ocean view", "Studio Queen, Oceanside". */
export function parseUnit(text) {
  const line = text.split('\n').map(l => l.trim()).find(l =>
    /\b(studio|\d\s*bedroom|one|two|three|four)\b/i.test(l) && /\b(villa|suite|studio|unit|room|queen|king)\b/i.test(l)
    && l.length < 70 && !/^\$/.test(l));
  return line ? line.replace(/\s+/g, ' ').replace(/[·|]+$/, '').trim() : '';
}

/** How many the unit sleeps, when the listing says. */
export function parseSleeps(text) {
  const m = text.match(/sleeps:?\s*(\d{1,2})/i);
  return m ? +m[1] : null;
}

/**
 * The two numbers that matter. RedWeek prints both a nightly and a total; Interval prints an
 * average night and a weekly rate. Whichever is missing is worked out from the other.
 */
export function parsePrice(text, nights) {
  const t = text.replace(/,/g, '');
  const per = t.match(/(?:us)?\$\s*([\d.]+)\s*(?:\/\s*night|per night|average night|a night|nightly)/i)
           || t.match(/average night[^$]*\$\s*([\d.]+)/i);
  const tot = t.match(/(?:us)?\$\s*([\d.]+)\s*(?:total|for the week)/i)
           || t.match(/(?:weekly rate|total)[^$]*\$\s*([\d.]+)/i);
  let nightly = per ? money(per[1]) : 0;
  let total = tot ? money(tot[1]) : 0;
  if (!total && nightly && nights) total = Math.round(nightly * nights * 100) / 100;
  if (!nightly && total && nights) nightly = Math.round((total / nights) * 100) / 100;
  return { nightly, total };
}

/** Already gone. RedWeek keeps sold listings on the page and marks them. */
export const looksTaken = (text) => /\bRENTED!?\b|\bSOLD\b|no longer available/i.test(text);

/** Match the pasted text to a place in the catalog, by the longest catalog name it contains. */
export function matchStay(text, stays) {
  const hay = text.toLowerCase().replace(/[’'`]/g, "'");
  const hit = stays
    .filter(s => s.kind !== 'trip')
    .map(s => ({ s, name: s.name.toLowerCase().replace(/[’'`]/g, "'") }))
    .filter(({ name }) => hay.includes(name))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (hit) return hit.s;
  // Fall back to the distinctive word, so "Surf Club" alone still finds the Surf Club.
  const words = [['surf club', 'Surf Club'], ['ocean club', 'Ocean Club'], ['la cabana', 'La Cabana'],
                 ['costa linda', 'Costa Linda'], ['playa linda', 'Playa Linda'], ['divi', 'Divi'],
                 ['renaissance', 'Renaissance'], ['casa del mar', 'Casa del Mar'], ['eagle aruba', 'Eagle Aruba'],
                 ['barcel', 'Barceló'], ['tamarijn', 'Tamarijn'], ['riu', 'RIU'], ['marriott', 'Marriott']];
  for (const [needle, label] of words) {
    if (!hay.includes(needle)) continue;
    const s = stays.find(x => x.kind !== 'trip' && x.name.toLowerCase().includes(label.toLowerCase()));
    if (s) return s;
  }
  return null;
}

/**
 * Every listing in one paste, not just the first.
 *
 * Victor checks Interval by eye, on a results page with a dozen Getaways on it. Reading one week
 * per paste meant a dozen round trips, which is why the board had none. This splits the text on
 * the one thing every listing has exactly once — its date range — and gives each chunk the few
 * lines above it, because the resort name sits above the dates on both sites.
 *
 * Deliberately not clever: a chunk that cannot be read is returned with its `missing` filled in
 * rather than dropped, so the Desk sees "three of five could be read" instead of silently
 * getting three.
 */
export function parseListings(text, opts = {}) {
  const clean = String(text || '').trim();
  if (!clean) return [];
  const lines = clean.split('\n');
  // Which lines start a date range — that is one per listing on both sites.
  const dated = lines.map((ln, i) => (parseDates(ln) ? i : -1)).filter(i => i >= 0);
  if (dated.length <= 1) {
    const one = parseListing(clean, opts);
    return one ? [one] : [];
  }
  // A listing runs from wherever the last one stopped down to its OWN price line, which sits
  // below its dates. Cutting on the dates alone put each listing's price into the next one's
  // chunk — every price a row too low, and the first listing with none at all.
  const hasMoney = (ln) => /\d/.test(ln) && /\$|\bUSD\b/i.test(ln);
  const out = [];
  let prevEnd = -1;
  for (let k = 0; k < dated.length; k++) {
    const nextDate = k + 1 < dated.length ? dated[k + 1] : lines.length;
    let end = dated[k];
    for (let i = dated[k]; i < nextDate; i++) if (hasMoney(lines[i])) end = i;
    const chunk = lines.slice(prevEnd + 1, end + 1).join('\n').trim();
    prevEnd = end;
    const got = chunk ? parseListing(chunk, opts) : null;
    if (got) out.push(got);
  }
  return out;
}

/**
 * Everything the Desk needs to put a pasted listing on the board. `stay` is null when the
 * place is not in our catalog, which is a thing to say out loud rather than a thing to guess.
 */
export function parseListing(text, { stays = [], pointsPerDollar = 100 } = {}) {
  const clean = String(text || '').trim();
  if (!clean) return null;
  const source = detectSource(clean);
  const dates = parseDates(clean);
  const nights = dates ? nightsBetween(dates.from, dates.to) : null;
  const price = parsePrice(clean, nights);
  const stay = matchStay(clean, stays);
  const unit = parseUnit(clean);
  const sleeps = parseSleeps(clean);
  const missing = [];
  if (!dates) missing.push('the dates');
  if (!price.total) missing.push('the price');
  if (!stay) missing.push('which place it is');
  return {
    source, stay, stayId: stay?.id || null,
    from: dates?.from || '', to: dates?.to || '', nights: nights || null,
    unit, sleeps, guests: sleeps || null,
    usdNightly: price.nightly, usdTotal: price.total,
    pointsTotal: price.total ? Math.round(price.total * pointsPerDollar) : 0,
    taken: looksTaken(clean),
    title: [stay?.name, unit].filter(Boolean).join(' · ') || unit || 'A week that came up',
    missing,
    ok: missing.length === 0 && !looksTaken(clean),
  };
}
