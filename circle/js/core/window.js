// The dates a member is looking for, on the Stays page.
//
// Victor, 22 Oct 2026: "Would be nice on the site Circle to add dates we are looking for. Now it shows
// for the next week but I'd like to see a month or two in advance." One small file, so the screen, the
// tap that tells the watcher, and the tests all read the window the same way. Days are plain ISO
// "2026-10-22" strings (they sort and compare as text); nothing here touches the clock unless the caller
// leaves `today` out, and nothing here is a verdict about a week — it only says which weeks overlap.

export const DEFAULT_DAYS = 60;
export const MAX_DAYS = 366;               // the database and the watcher clamp to the same year
const DAY = 864e5;
const STORE_KEY = 'circle.looking';

/** The calendar day on this device, as YYYY-MM-DD. */
export const dayOf = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const isDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(`${s}T12:00:00Z`));
export const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const between = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY);

export const CHIPS = Object.freeze([
  { id: '2w', label: 'Next 2 weeks' },
  { id: 'month', label: 'Next month' },
  { id: '2m', label: '2 months' },
  { id: 'xmas', label: 'Christmas' },
]);

/**
 * A usable window, or null. A start in the past moves to today (nothing before today can be booked), an
 * end before the start is no window, and a window over a year long is cut to a year.
 */
export function clampWindow(win, today = dayOf()) {
  if (!win || !isDay(win.from) || !isDay(win.to)) return null;
  const from = win.from < today ? today : win.from;
  if (win.to < from) return null;
  return { from, to: between(from, win.to) > MAX_DAYS ? addDays(from, MAX_DAYS) : win.to };
}

/** What a quick chip means today. Christmas is 20 Dec to 3 Jan: the one coming, or the one that is on now. */
export function chipWindow(id, today = dayOf()) {
  const days = { '2w': 14, month: 30, '2m': DEFAULT_DAYS }[id];
  if (days) return { from: today, to: addDays(today, days) };
  if (id === 'xmas') {
    const y = Number(today.slice(0, 4));
    const from = today <= `${y}-01-03` ? `${y - 1}-12-20` : `${y}-12-20`;
    return clampWindow({ from, to: addDays(from, 14) }, today);
  }
  return null;
}

/** With no dates chosen: today to two months out. */
export const defaultWindow = (today = dayOf()) => chipWindow('2m', today);

/** Which chip, if any, is exactly this window — so the control can show it pressed. */
export const chipFor = (win, today = dayOf()) =>
  CHIPS.find((c) => { const w = chipWindow(c.id, today); return w && win && w.from === win.from && w.to === win.to; })?.id || null;

/**
 * Does the week overlap the window? The nights of a week are [from, to): a week that checks out on the
 * window's first day has no night in it, and one that checks in on its last day has one. A deal with no
 * dates is kept — a list should not lose a row because its dates were not read.
 */
export function overlaps(deal, win) {
  if (!win) return true;
  const from = deal?.from, to = deal?.to;
  if (!isDay(from) || !isDay(to)) return true;
  return from <= win.to && to > win.from;
}

/**
 * "24 Oct – 21 Dec" (the year only when it is not this one, like every other range in the app), for
 * the line that says what the list is showing.
 */
export function windowWords(win, today = dayOf()) {
  const part = (d, withYear) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC', ...(withYear ? { year: 'numeric' } : {}) });
  const y = today.slice(0, 4);
  const odd = win.from.slice(0, 4) !== y || win.to.slice(0, 4) !== y;
  return `${part(win.from, odd)} – ${part(win.to, odd)}`;
}

// ---------------------------------------------------------------- remembered on this device
/**
 * The window to open Stays on. A chip is remembered AS the chip, so "next month" is still next month
 * tomorrow; dates typed by hand are remembered as dates, and are dropped when they have passed.
 * `storage` is injectable (the tests); the default is the device's localStorage, which may refuse.
 */
export function loadWindow(storage = globalThis.localStorage, today = dayOf()) {
  let saved = null;
  try { saved = JSON.parse(storage?.getItem(STORE_KEY) || 'null'); } catch { /* private mode, or not JSON */ }
  const chip = saved?.chip && chipWindow(saved.chip, today);
  if (chip) return { ...chip, chip: saved.chip };
  const custom = clampWindow(saved, today);
  if (custom) return { ...custom, chip: chipFor(custom, today) };
  return { ...defaultWindow(today), chip: '2m' };
}

export function saveWindow(win, storage = globalThis.localStorage) {
  try { storage?.setItem(STORE_KEY, JSON.stringify(win.chip ? { chip: win.chip } : { from: win.from, to: win.to })); } catch { /* nothing to remember it in */ }
}
