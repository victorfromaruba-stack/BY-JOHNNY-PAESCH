// Interval Getaways: whole weeks at a resort, with a price.
//
// The search page groups its results by resort. Each group opens with a header row whose class
// carries the resort's own code — `resort_header_row_2 CPV` — and the weeks follow as rows until
// the next header. The code is what we key on: names drift between sites (accents, "&", the word
// "Resort" coming and going) but CPV is CPV everywhere, so a week can always be tied back to the
// right resort in our catalog.
//
// Parsing is pure and reads structured markup, the same way redweek.mjs reads RedWeek's data
// attributes rather than guessing at prose. It is tested against a real saved search
// (fixtures-interval-aruba.html), so this file can be changed and checked without signing in.

/** A week's price as a number. "US$1,804.83" -> 1804.83 */
const money = (s) => {
  const n = Number(String(s).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** "Oct 31 2026" -> "2026-10-31", so dates sort and compare as text. */
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
export function isoDate(s) {
  const m = /^([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})$/.exec(String(s).trim());
  if (!m) return null;
  const mm = MONTHS[m[1].toLowerCase()];
  if (!mm) return null;
  return `${m[3]}-${String(mm).padStart(2, '0')}-${String(Number(m[2])).padStart(2, '0')}`;
}

/** Strip tags and collapse whitespace, so a row reads as the member sees it. */
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&#39;|&rsquo;/g, "'").replace(/\s+/g, ' ').trim();

/**
 * Every week on a Getaways results page, cheapest first.
 *
 * Returns `{ code, resort, from, to, nights, week, allInclusive }`, where `week` is the price for
 * the whole week in US dollars — Interval quotes weeks, and showing a nightly rate as if it were
 * bookable per night would be a lie the member only discovers at checkout.
 */
export function parseGetaways(html) {
  const source = String(html || '');
  // Where each resort's group begins, and which resort it is.
  const heads = [...source.matchAll(/class="[^"]*resort_header_row_2\s+([A-Z0-9]{2,6})[^"]*"/g)]
    .map((m) => ({ code: m[1], at: m.index }));
  if (!heads.length) return [];

  const out = [];
  heads.forEach((head, i) => {
    const block = source.slice(head.at, i + 1 < heads.length ? heads[i + 1].at : source.length);
    // The name is the alt text on the group's own thumbnail. Every resort has one; only the few
    // with a video also carry it as an aria-label, and the carousel's own buttons are labelled
    // "Previous Image" too — which is exactly what an earlier version of this read, and so it
    // showed eight of ten Aruba resorts as "Previous Image" while the tests went green.
    const resort = (/<img[^>]+class="[^"]*results_thumbnail[^"]*"[^>]*\salt="([^"]{3,70})"/.exec(block)
      || /<img[^>]+\salt="([^"]{3,70})"[^>]*class="[^"]*results_thumbnail[^"]*"/.exec(block)
      || [, ''])[1];

    for (const row of block.matchAll(/<tr[^>]*class="[^"]*bottom_border[^"]*"[^>]*>([\s\S]*?)<\/tr>/g)) {
      const t = text(row[1]);
      const when = /([A-Za-z]{3}\s+\d{1,2}\s+\d{4})\s*-\s*([A-Za-z]{3}\s+\d{1,2}\s+\d{4})/.exec(t);
      const price = /US\$\s*([\d,]+(?:\.\d{2})?)/.exec(t);
      if (!when || !price) continue;
      const from = isoDate(when[1]), to = isoDate(when[2]);
      const week = money(price[1]);
      if (!from || !to || !week) continue;
      out.push({
        code: head.code,
        resort: resort.replace(/_/g, ' ').trim(),
        from,
        to,
        nights: Math.round((Date.parse(to) - Date.parse(from)) / 864e5),
        week,
        // The flag is on the row, not the resort: the same resort can offer both.
        allInclusive: /resortallInclusive_true/.test(row[0]),
      });
    }
  });

  // Cheapest first, because that is the only order a member asked for. Ties settle on the
  // earlier stay, so the list is stable between runs and does not shuffle under them.
  return dedupe(out).sort((a, b) => a.week - b.week || a.from.localeCompare(b.from));
}

/** The same week can be listed twice on one page; a member should see it once. */
function dedupe(weeks) {
  const seen = new Set();
  return weeks.filter((w) => {
    const key = `${w.code}|${w.from}|${w.to}|${w.week}|${w.allInclusive}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The cheapest week per resort: one line each, for a board that has to stay short. */
export function cheapestPerResort(weeks) {
  const best = new Map();
  for (const w of weeks) if (!best.has(w.code) || w.week < best.get(w.code).week) best.set(w.code, w);
  return [...best.values()].sort((a, b) => a.week - b.week);
}
