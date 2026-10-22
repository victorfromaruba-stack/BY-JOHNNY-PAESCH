// How old a week on the board is, in words, and which weeks still count.
//
// One file, so the app, the watcher's verify and Ian all read age the same way. Victor, 22 Oct 2026,
// after a screenshot of a Barceló week "owner asking $9 a night", last seen 16 Oct, at No. 1 on Stays:
//
//   - a live row the watcher has not seen again for 7 days is retired (status gone, "not seen for 7
//     days") — the database does it (retire_stale_deals); the app also stops showing it, so a watcher
//     that is down for a week cannot leave last week's prices on the front page;
//   - the Stays list puts what was seen recently above what was not, and says "seen N days ago" in
//     words on every row;
//   - Ian only recommends a row seen in the last 48 hours; an older one is shown as old, with the tap
//     that re-checks it.
//
// The rule is for the sources something re-reads — RedWeek, Interval, VakayMood. A rate Victor typed in
// from the hotel is not a listing anyone could see again, so the clock does not retire it.

export const RETIRE_AFTER_DAYS = 7;
export const FRESH_HOURS = 48;
export const WATCHED_SOURCES = Object.freeze(['redweek', 'interval', 'vakaymood']);

const HOUR = 3600e3, DAY = 24 * HOUR;

/** When this week was last seen where it lives, in ms; its posting time for a row nobody has re-read; null if neither. */
export function seenMs(d) {
  const t = Date.parse(d?.seenAt ?? d?.seen_at ?? d?.postedAt ?? d?.posted_at ?? '');
  return Number.isFinite(t) ? t : null;
}

/** Past the retirement age, for a source that is re-read. The same test the database applies. */
export function isStale(d, now = Date.now(), days = RETIRE_AFTER_DAYS) {
  const t = seenMs(d);
  return WATCHED_SOURCES.includes(d?.source) && t != null && now - t > days * DAY;
}

/** Seen within the last `hours`. A row with no time at all is not fresh: nothing says it was ever seen. */
export function isFresh(d, now = Date.now(), hours = FRESH_HOURS) {
  const t = seenMs(d);
  return t != null && now - t <= hours * HOUR;
}

/** Whole days since it was seen, or null. */
export function ageDays(d, now = Date.now()) {
  const t = seenMs(d);
  return t == null ? null : Math.max(0, Math.floor((now - t) / DAY));
}

/**
 * "seen 3 days ago" — plain words, never a verdict. Under an hour it says minutes, under a day hours,
 * and from a day on days. Empty when there is no time to say.
 */
export function seenWords(d, now = Date.now()) {
  const t = seenMs(d);
  if (t == null) return '';
  const ms = Math.max(0, now - t);
  if (ms < 90e3) return 'seen just now';
  if (ms < HOUR) return `seen ${Math.round(ms / 60e3)} min ago`;
  if (ms < DAY) { const h = Math.round(ms / HOUR); return `seen ${h} hour${h === 1 ? '' : 's'} ago`; }
  const n = Math.floor(ms / DAY);
  return `seen ${n} day${n === 1 ? '' : 's'} ago`;
}

/**
 * The order of the Stays list, as a comparator over `nightly(d)` (the price a night): what was seen in
 * the last 48 hours above what was not; within each, Interval above everything else (Victor: "Interval
 * should be on top since it's the cheapest"); within each of those, the cheapest a night first. Ties
 * settle on the row seen most recently, so the list does not shuffle between loads.
 */
export function boardOrder(nightly, now = Date.now()) {
  const rank = (d) => (isFresh(d, now) ? 0 : 2) + (d?.source === 'interval' ? 0 : 1);
  return (a, b) => rank(a) - rank(b)
    || (nightly(a) || Infinity) - (nightly(b) || Infinity)
    || (seenMs(b) ?? 0) - (seenMs(a) ?? 0);
}

/** Weeks taken down today, by the watcher or by hand: status gone and a retirement time on today's date. */
export function retiredToday(deals, now = new Date()) {
  const day = (t) => new Date(t).toDateString();
  return (deals || []).filter((d) => d.status === 'gone' && d.retiredAt && day(d.retiredAt) === day(now)).length;
}
