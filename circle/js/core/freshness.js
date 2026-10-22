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

// ---------------------------------------------------------------- a source being out stops its clock
// RedWeek stopped answering this server on 22 Oct 2026, and Victor's decision was to wait. A week that nobody
// could see because the SOURCE was out has not aged: its seven days do not run while the source is unreachable
// (the database does the same, retire_stale_deals + source_outages, 20261022_source_outage.sql). The page does
// not alter any "seen" time for it — a row still says honestly when it was last seen.
let OUTAGES = [];
/** The outages the clock does not count: [{ source, since, until }] (ISO times; `until` null while it is out). */
export function setOutages(list) { OUTAGES = Array.isArray(list) ? list : []; }
export const outages = () => OUTAGES;

/** How long `source` was out between `fromMs` and `now`, in ms. */
export function pausedMs(source, fromMs, now = Date.now(), list = OUTAGES) {
  let n = 0;
  for (const o of list || []) {
    if (o?.source !== source) continue;
    const a = Math.max(Date.parse(o.since), fromMs), b = Math.min(o.until ? Date.parse(o.until) : now, now);
    if (Number.isFinite(a) && Number.isFinite(b) && a < b) n += b - a;
  }
  return n;
}

/** Past the retirement age, for a source that is re-read. The same test the database applies — less the time the source was out. */
export function isStale(d, now = Date.now(), days = RETIRE_AFTER_DAYS, list = OUTAGES) {
  const t = seenMs(d);
  return WATCHED_SOURCES.includes(d?.source) && t != null && now - t - pausedMs(d.source, t, now, list) > days * DAY;
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

// ---------------------------------------------------------------- a time, in words
const clock = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dayWord = (d, now) => {
  const n = new Date(now), y = new Date(now - DAY);
  if (d.toDateString() === n.toDateString()) return '';
  if (d.toDateString() === y.toDateString()) return 'yesterday';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};
/**
 * "at 06:00" today, "yesterday at 18:00", "21 Oct at 06:00" — the line that says when RedWeek was last read
 * ("RedWeek checked at 06:00"): a time, never a verdict. Empty when there is no time.
 */
export function atWords(iso, now = Date.now()) {
  const d = new Date(iso || NaN);
  if (Number.isNaN(+d)) return '';
  const day = dayWord(d, now);
  return `${day ? `${day} ` : ''}at ${clock(d)}`;
}
/** "14:20", "yesterday 14:20", "21 Oct 14:20" — for "RedWeek not reachable since …". */
export function sinceWords(iso, now = Date.now()) {
  const d = new Date(iso || NaN);
  if (Number.isNaN(+d)) return '';
  const day = dayWord(d, now);
  return `${day ? `${day} ` : ''}${clock(d)}`;
}

/** Weeks taken down today, by the watcher or by hand: status gone and a retirement time on today's date. */
export function retiredToday(deals, now = new Date()) {
  const day = (t) => new Date(t).toDateString();
  return (deals || []).filter((d) => d.status === 'gone' && d.retiredAt && day(d.retiredAt) === day(now)).length;
}
