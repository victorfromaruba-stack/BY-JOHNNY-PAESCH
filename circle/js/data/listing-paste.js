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
  const got = readDates(text);
  // A week must be at least one night. Anything else is a misreading, not a short stay.
  return got && nightsBetween(got.from, got.to) > 0 ? got : null;
}
function readDates(text) {
  const t = text.replace(/[‐-―]/g, '-').replace(/\s+/g, ' ');

  // Sep 11-18, 2026
  let m = t.match(/\b([A-Za-z]{3,4})\.?\s+(\d{1,2})\s*-\s*(\d{1,2}),?\s*(\d{4})/);
  if (m && MONTHS[m[1].toLowerCase()] !== undefined) {
    const mo = MONTHS[m[1].toLowerCase()], y = +m[4];
    return { from: iso(y, mo, +m[2]), to: iso(y, mo, +m[3]) };
  }
  // Sep 06 2026 - Sep 13 2026  ·  Sep 13 - Oct 3, 2026  ·  Dec 28 - Jan 4, 2027
  m = t.match(/\b([A-Za-z]{3,4})\.?\s+(\d{1,2}),?\s*(\d{4})?\s*-\s*([A-Za-z]{3,4})\.?\s+(\d{1,2}),?\s*(\d{4})/);
  if (m && MONTHS[m[1].toLowerCase()] !== undefined && MONTHS[m[4].toLowerCase()] !== undefined) {
    const m1 = MONTHS[m[1].toLowerCase()], m2 = MONTHS[m[4].toLowerCase()];
    const y2 = +m[6];
    // Only one year printed, and the week ends in an earlier month than it starts: it is a week
    // over New Year, so the start is the year before. Reading both as 2027 turned a seven-night
    // week into minus three hundred and fifty-eight.
    const y1 = m[3] ? +m[3] : (m2 < m1 ? y2 - 1 : y2);
    return { from: iso(y1, m1, +m[2]), to: iso(y2, m2, +m[5]) };
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
  // "US$ 132.71 Average Night", "$150/night", "132.71 USD nightly", "Average Night US$132.71".
  const per = t.match(/(?:us)?\$\s*([\d.]+)\s*(?:usd\s*)?(?:\/\s*night|per\s*night|average\s*night|avg\.?\s*night|a night|nightly)/i)
           || t.match(/(?:average|avg\.?|per)\s*night[^$\d]{0,24}(?:us)?\$\s*([\d.]+)/i);
  // "$1050 total", "$929 USD Total", "Weekly US$ 929.00", "Total: 929".
  const tot = t.match(/(?:us)?\$\s*([\d.]+)\s*(?:usd\s*)?(?:total|for the week|weekly|\/\s*week)/i)
           || t.match(/(?:weekly(?:\s*rate)?|total(?:\s*price)?)\s*:?[^$\d]{0,24}(?:us)?\$\s*([\d.]+)/i);
  let nightly = per ? money(per[1]) : 0;
  let total = tot ? money(tot[1]) : 0;
  // A card carrying exactly one money figure and no label at all is showing SOME price — but which
  // one is exactly what it does not say, and the two readings are a factor of seven apart. Reading
  // it as a nightly rate put US$633.46 on the board as a night when it was a week.
  //
  // So it is read as the stay's TOTAL, which is what both sites sell (Interval prices whole weeks;
  // a RedWeek listing's lone figure is its asking price), and it is flagged. The flag is what
  // matters: `guessed` makes the row not-ok below, so it never reaches the board at all. The Desk
  // sees the figure and the reason, and can read the label off the page itself in two seconds.
  let guessed = false;
  if (!nightly && !total) {
    const alone = t.match(/(?:us)?\$\s*[\d.]+/gi) || [];
    if (alone.length === 1) { total = money(alone[0]); guessed = true; }
  }
  if (!total && nightly && nights) total = Math.round(nightly * nights * 100) / 100;
  if (!nightly && total && nights) nightly = Math.round((total / nights) * 100) / 100;
  return { nightly, total, guessed };
}

/** Already gone. RedWeek keeps sold listings on the page and marks them. */
export const looksTaken = (text) => /\bRENTED!?\b|\bSOLD\b|no longer available/i.test(text);

/** Match the pasted text to a place in the catalog, by the longest catalog name it contains. */
export function matchStay(text, stays, { loose = true } = {}) {
  const hay = text.toLowerCase().replace(/[’'`]/g, "'");
  const hit = stays
    .filter(s => s.kind !== 'trip')
    .map(s => ({ s, name: s.name.toLowerCase().replace(/[’'`]/g, "'") }))
    .filter(({ name }) => hay.includes(name))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (hit) return hit.s;
  if (!loose) return null;
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
 * Interval prints a TABLE, not a list of listings, and the difference broke every row.
 *
 * What the real Getaway results page says (read off Victor's own screen, September 2026):
 *
 *   Marriott's Aruba Surf Club        <- the resort, named once
 *   Palm Beach , ARUBA - DCB          <- always under it: town, REGION - code
 *   MSU / Overall Rating / 48 Member Ratings / Resort Details & Photos
 *   from US$90.50 Average Night       <- the CHEAPEST week here, not any particular one
 *   Weekly Rate                       <- the column the figures below sit in
 *   Sep 17 2026 - Sep 24 2026   US$633.46    Book     <- three weeks under one resort
 *   Sep 18 2026 - Sep 25 2026   US$633.46    Book
 *   Sep 19 2026 - Sep 26 2026   US$1,172.54  Book
 *
 * Three things follow, and cutting the page into one chunk per date range got all three wrong.
 *
 * ONE RESORT, MANY WEEKS. Weeks two and three had no resort name above them, so they were dropped
 * as "which place is this?" — or worse, inherited the NEXT resort's name. The resort is now
 * carried forward from its header and changes only at the next header.
 *
 * THE FIGURE ON A ROW IS A WEEK, NOT A NIGHT. Interval says so in the column header and again in
 * the footnote. Read as a nightly rate, US$633.46 goes on the board at seven times the real
 * price. Three sums off the same screen confirm the reading: 633.46/7 = 90.49 against the
 * header's "from US$90.50"; 1,008.01/7 = 144.00 against 144.00; 1,172.54/7 = 167.51 against
 * 167.51.
 *
 * THE HEADER'S PRICE IS NOT THE ROW'S. "from US$90.50" is the cheapest week at that resort, so
 * only money appearing AFTER a row's dates, and before the next row's, belongs to that row.
 *
 * Anything that cannot be read is still returned with its `missing` filled in rather than
 * dropped, so the Desk sees "three of five could be read" instead of quietly getting three.
 */

/**
 * "Palm Beach , ARUBA - DCB" — the line printed under every resort's name, and the only mark of
 * where one resort's block ends and the next begins that does not require knowing the resort.
 *
 * That last part is the point. Matching on names we recognise leaves a resort we do not stock
 * invisible, and its weeks then inherit the name of the resort above them — a real price on the
 * wrong hotel, which is worse than no price at all. So the boundary is structural.
 *
 * An ALL-CAPS region after a comma or a dot is what makes it a place line: "Palm Beach , ARUBA -
 * DCB" and "Palm Beach · ARUBA · DCB" both qualify, while "Studio Queen, Oceanside" and
 * "Sleeps: 12, Building: Compass" do not.
 */
/**
 * Which place a WHOLE PAGE is about, when it carries a single listing.
 *
 * The exact catalog name is trusted wherever it appears — a full "Marriott's Aruba Surf Club"
 * anywhere in a page is that resort, footer or not. The loose brand word is not: "Interval
 * International" in a site header, or a Marriott advert in a sidebar, would otherwise file an
 * unrelated week at a Marriott, which is a real price on the wrong hotel. So the brand pass only
 * runs over the lines ABOVE the dates, which is where both sites put the resort's name.
 */
function nameScope(text, stays) {
  const exact = matchStay(text, stays, { loose: false });
  if (exact) return exact;
  const lines = String(text).split('\n');
  const at = lines.findIndex(ln => parseDates(ln));
  const above = at > 0 ? lines.slice(0, at + 1).join('\n') : (at === 0 ? lines[0] : text);
  return matchStay(above, stays);
}

const PLACE_LINE = /[,\u00b7]\s*[A-Z]{3,}\b/;
const MONEY_RE = /(?:US)?\$\s*[\d,]+(?:\.\d{1,2})?/gi;

/** The line above a place line is the resort's name — unless it is plainly something else. */
function looksLikeName(ln) {
  const s = String(ln || '').trim();
  return s.length > 2 && s.length < 70 && /[a-z]/.test(s) && /[A-Za-z]{3}/.test(s)
    && !/\$|\d{4}/.test(s) && !PLACE_LINE.test(s);
}

export function parseListings(text, opts = {}) {
  const clean = String(text || '').trim();
  if (!clean) return [];
  const lines = clean.split('\n').map(l => l.trim());
  const stays = opts.stays || [];
  // Does this page price by the week? Believing what the page says beats guessing from the size
  // of the number: $633 could be a week at one resort or two nights at another.
  const weekly = /weekly[\s\u00a0]*\n?[\s\u00a0]*rate/i.test(clean)
    || /nightly rates are based on per week/i.test(clean);

  const out = [];
  let resortLine = null;
  let row = null;

  const close = () => {
    if (!row) return;
    const chunk = `${resortLine || ''}\n${row.lines.join('\n')}`.trim();
    out.push(buildListing({
      chunk,
      // Once a resort's header has been seen, it is the ONLY thing that names these rows. Reading
      // the row's own text as a fallback filed Caribbean Palm Village's week under Marriott's
      // Ocean Club, because the next resort's name lands in the previous resort's last row.
      nameText: resortLine,
      dates: row.dates,
      weekTotal: weekly && row.money.length ? money(row.money[0]) : 0,
      opts,
    }));
    row = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (!ln) continue;
    if (PLACE_LINE.test(ln) && i > 0 && !parseDates(ln) && looksLikeName(lines[i - 1])) {
      close(); resortLine = lines[i - 1]; continue;
    }
    const d = parseDates(ln);
    if (d) { close(); row = { dates: d, lines: [ln], money: [] }; continue; }
    // A short line that names a place in the catalog IS a header, wherever it falls. Neither site
    // prints a resort's name inside one of its own rows, and without this a page whose place line
    // carries no comma put every week in the whole table under the first resort on it.
    if (ln.length < 70 && matchStay(ln, stays)) { close(); resortLine = ln; continue; }
    if (row) {
      row.lines.push(ln);
      const m = ln.match(MONEY_RE);
      if (m) row.money.push(...m);
    }
  }
  close();
  if (out.length) return out;
  const one = parseListing(clean, opts);
  return one ? [one] : [];
}

/** One row of the table, priced and named. */
function buildListing({ chunk, nameText, dates, weekTotal, opts }) {
  const { stays = [], pointsPerDollar = 100 } = opts;
  const nights = nightsBetween(dates.from, dates.to);
  // Labels beat column headers beat guessing. A row that says "Average Night" or "Weekly Rate" on
  // itself is answering the question outright; only a row carrying a bare figure falls back to
  // the Weekly Rate column the page puts it in; only a page with neither is left guessing.
  const read = parsePrice(chunk, nights);
  const price = (read.total && !read.guessed) ? read
    : weekTotal ? { nightly: nights ? Math.round((weekTotal / nights) * 100) / 100 : 0, total: weekTotal, guessed: false }
    : read;
  const stay = nameText ? matchStay(nameText, stays) : matchStay(chunk, stays);
  const unit = parseUnit(chunk);
  const sleeps = parseSleeps(chunk);
  const missing = [];
  if (!price.total) missing.push('the price');
  // A figure whose LABEL could not be read is not a price the Circle may quote: it is a number and
  // a coin toss between a night and a week. Saying so puts the row in front of the Desk instead of
  // in front of somebody spending points.
  else if (price.guessed) missing.push('whether that figure is a night or a week');
  if (!stay) missing.push('which place it is');
  const taken = looksTaken(chunk);
  return {
    source: detectSource(chunk), stay, stayId: stay?.id || null,
    from: dates.from, to: dates.to, nights: nights || null,
    unit, sleeps, guests: sleeps || null,
    usdNightly: price.nightly, usdTotal: price.total, priceGuessed: !!price.guessed,
    pointsTotal: price.total ? Math.round(price.total * pointsPerDollar) : 0,
    taken,
    title: [stay?.name, unit].filter(Boolean).join(' \u00b7 ') || unit || 'A week that came up',
    missing,
    ok: missing.length === 0 && !taken,
  };
}

export function parseListing(text, { stays = [], pointsPerDollar = 100 } = {}) {
  const clean = String(text || '').trim();
  if (!clean) return null;
  const source = detectSource(clean);
  const dates = parseDates(clean);
  const nights = dates ? nightsBetween(dates.from, dates.to) : null;
  const price = parsePrice(clean, nights);
  const stay = nameScope(clean, stays);
  const unit = parseUnit(clean);
  const sleeps = parseSleeps(clean);
  const missing = [];
  if (!dates) missing.push('the dates');
  if (!price.total) missing.push('the price');
  else if (price.guessed) missing.push('whether that figure is a night or a week');
  if (!stay) missing.push('which place it is');
  return {
    source, stay, stayId: stay?.id || null,
    from: dates?.from || '', to: dates?.to || '', nights: nights || null,
    unit, sleeps, guests: sleeps || null,
    usdNightly: price.nightly, usdTotal: price.total, priceGuessed: !!price.guessed,
    pointsTotal: price.total ? Math.round(price.total * pointsPerDollar) : 0,
    taken: looksTaken(clean),
    title: [stay?.name, unit].filter(Boolean).join(' · ') || unit || 'A week that came up',
    missing,
    ok: missing.length === 0 && !looksTaken(clean),
  };
}
