// How soon to ask Interval again after it said no.
//
// Interval's bot management refuses the watcher's sign-in and, as far as anyone can tell, not
// for the password: the form is filled as built, the consent panel is dismissed, the CSRF token
// is there, the waiting room clears, Radware's own cookies are minted — and the page after all
// that still offers a way in. Victor has decided Interval stays on regardless. What this file
// decides is the pace: a refusal doubles the wait before the next attempt, from one pass to a
// day, so an account that is being told no hears it a handful of times on the first day and
// once a day after that, rather than every half hour for months. A sign-in that works puts the
// pace back to every pass.
//
// Pure, apart from the two functions that read and write the little state file; the schedule
// itself is on trial in pace.test.mjs.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

export const DAY_MIN = 24 * 60;

/** Minutes to wait after this many refusals in a row: 0 → none, 1 → 2× a pass, … capped at a day. */
export function backoffMinutes(refusals, everyMin, { maxMin = DAY_MIN } = {}) {
  const n = Math.max(0, Math.floor(Number(refusals) || 0));
  if (n === 0) return 0;
  const every = Math.max(1, Number(everyMin) || 1);
  return Math.min(every * 2 ** n, Math.max(every, maxMin));
}

/** The pace after one more refusal, said at `now` (ms). */
export function refused(state, { everyMin, maxMin, now = Date.now(), said = '' } = {}) {
  const refusals = (state?.refusals || 0) + 1;
  const wait = backoffMinutes(refusals, everyMin, { maxMin });
  return { refusals, nextTryAt: new Date(now + wait * 60_000).toISOString(), lastRefusalAt: new Date(now).toISOString(), lastSaid: String(said || '').slice(0, 200) };
}

/** The pace after a sign-in that worked: back to every pass. */
export const accepted = () => ({ refusals: 0, nextTryAt: null, lastRefusalAt: null, lastSaid: '' });

/** Is it time to try again? Nothing on file, or a date that has passed, means yes. */
export function due(state, now = Date.now()) {
  const at = state?.nextTryAt ? Date.parse(state.nextTryAt) : NaN;
  return !Number.isFinite(at) || at <= now;
}

export function loadPace(file) {
  try { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : accepted(); }
  catch { return accepted(); }
}

export function savePace(file, state) {
  try { writeFileSync(file, JSON.stringify(state, null, 2) + '\n'); } catch { /* a pace that cannot be written is still a pace for this run */ }
}
