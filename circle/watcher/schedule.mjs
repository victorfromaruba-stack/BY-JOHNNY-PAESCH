// When RedWeek is read: twice a day, at fixed times on the Aruba clock.
//
// Victor, 22 Oct 2026: "RedWeek can be scanned 2 times a day automatically." So the watcher no longer
// reads RedWeek every half hour, and a member opening a stay does not make it read anything — a tap is
// served from the last scan and says when that was. The times are WATCH_REDWEEK_TIMES (default "06:00,18:00"),
// Aruba time (UTC-4, no daylight time).
//
// Pure: a list of times and a clock in, a time out. A restart must not read RedWeek again, so what
// the loop asks is "was the most recent scheduled time already served?" — `due()` — and not "has it
// been twelve hours".

const HOUR = 3600e3, DAY = 24 * HOUR, OFFSET = 4 * HOUR;       // Aruba is UTC-4

export const DEFAULT_TIMES = '06:00,18:00';

/** "06:00, 18:00" -> [360, 1080] minutes into the Aruba day, sorted. Bad entries are dropped; none left is the default. */
export function parseTimes(text = DEFAULT_TIMES) {
  const mins = [...new Set(String(text || '').split(/[,\s]+/).map((s) => /^(\d{1,2}):(\d{2})$/.exec(s)).filter(Boolean)
    .map((m) => Number(m[1]) * 60 + Number(m[2])).filter((n) => n >= 0 && n < 1440))].sort((a, b) => a - b);
  return mins.length ? mins : parseTimes(DEFAULT_TIMES);
}

/** Every scheduled moment (ms, UTC) from `backDays` Aruba days before today to `forwardDays` after it. */
function slots(times, now, backDays, forwardDays) {
  const dayStart = Math.floor((now - OFFSET) / DAY) * DAY + OFFSET;       // 00:00 Aruba today, as UTC ms
  const out = [];
  for (let d = -backDays; d <= forwardDays; d++) for (const m of times) out.push(dayStart + d * DAY + m * 60e3);
  return out.sort((a, b) => a - b);
}

/** The latest scheduled moment at or before `now`. */
export const lastSlot = (times, now = Date.now()) => slots(times, now, 1, 0).filter((t) => t <= now).pop();
/** The first scheduled moment after `now`. */
export const nextSlot = (times, now = Date.now()) => slots(times, now, 0, 1).find((t) => t > now);

/**
 * Is a scan owed? True when the most recent scheduled moment has not been served: the last scan
 * (`lastScan`, an ISO time, or null for never) is before it. A watcher restarted at 07:10 after a quiet
 * night therefore scans at once for the 06:00; one restarted at 07:10 after a 06:02 scan does not.
 */
export function due(times, lastScan, now = Date.now()) {
  const last = Date.parse(lastScan || '');
  return !Number.isFinite(last) || last < lastSlot(times, now);
}

/** "06:00" for a time, on the Aruba clock — what the journal and the Stays page call a scan. */
export const arubaClock = (ms) => new Date(ms - OFFSET).toISOString().slice(11, 16);
