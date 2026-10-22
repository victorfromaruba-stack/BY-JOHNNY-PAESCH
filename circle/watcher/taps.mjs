// What the watcher does the moment a member opens a stay.
//
// Victor, 22 Oct 2026: "I want the watch to watch it the moment a member clicks on stays."
// This is the nearest honest version of that, and the edges are on purpose:
//
//   RedWeek   is public, needs no login, and is read once for the resort the member is looking at
//             — at most once per resort per 15 minutes, 20 times an hour in all. A resort read
//             five minutes ago by the half-hourly pass or by another member's tap is not read
//             again: that read IS the answer, and the stay says how old it is.
//   Interval  is NEVER touched by a tap. Interval's terms forbid automated access and the penalty
//             is Victor's VIP Gold membership, which is the whole supply (see the interval-board
//             skill). What a tap does there is tell Victor, once per resort per 12 hours, that a
//             member is looking at a place whose Interval weeks are more than a day old — so that
//             he, a person, can open Interval and tap Grab.
//
// The decisions are pure functions of a small state file, so they can be argued with in
// taps.test.mjs without a network. No member's name is read, stored or sent anywhere here: the
// database hands over a place and a time (take_stay_taps), and nothing else.

import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { createRequire } from 'node:module';
import { ARUBA } from './redweek.mjs';
import { resolveStay } from './judge.mjs';

export const CAPS = Object.freeze({
  resortGapMin: 15,        // one RedWeek read per resort per this many minutes, however many taps
  perHour: 20,             // and this many tap-triggered reads in all
  intervalStaleHours: 24,  // Interval's last grab older than this is worth a nudge
  nudgeGapHours: 12,       // one nudge per resort per this many hours
});
const MIN = 60e3, HOUR = 3600e3;

// ---------------------------------------------------------------- memory across restarts
export const emptyState = () => ({ sweeps: {}, tapSweeps: [], nudges: {}, held: [] });

export function loadState(file) {
  try { return { ...emptyState(), ...JSON.parse(readFileSync(file, 'utf8')) }; }
  catch { return emptyState(); }          // first run, or a file that is not worth trusting
}
export function saveState(file, state) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 1), { mode: 0o600 });
  renameSync(tmp, file);
}

// ---------------------------------------------------------------- which resort is this stay
/** The RedWeek page for a catalog stay, or null when RedWeek has none we read. */
export function slugFor(stay, catalog) {
  for (const [slug, ourName] of Object.entries(ARUBA)) {
    if (ourName && resolveStay({ ourName }, catalog) === stay.id) return slug;
  }
  return null;
}

// ---------------------------------------------------------------- RedWeek: read it or not
export function decideSweep(state, slug, now = Date.now(), caps = CAPS) {
  const last = Date.parse(state.sweeps?.[slug] || '');
  if (Number.isFinite(last) && now - last < caps.resortGapMin * MIN) {
    const m = Math.floor((now - last) / MIN);
    return { go: false, why: `already read ${m < 1 ? 'less than a minute' : `${m} min`} ago — that read is the answer` };
  }
  const recent = (state.tapSweeps || []).filter(t => now - Date.parse(t) < HOUR);
  if (recent.length >= caps.perHour) {
    return { go: false, why: `${recent.length} taps have already cost a read this hour (cap ${caps.perHour}) — served from the last read` };
  }
  return { go: true };
}
export function noteTapSweep(state, now = Date.now()) {
  state.tapSweeps = [...(state.tapSweeps || []).filter(t => now - Date.parse(t) < HOUR), new Date(now).toISOString()];
}
export function noteSwept(state, slug, now = Date.now()) {
  (state.sweeps ||= {})[slug] = new Date(now).toISOString();
}

// ---------------------------------------------------------------- Interval: tell Victor, once
export function ageWords(ms) {
  const h = ms / HOUR;
  if (h < 48) { const n = Math.max(1, Math.round(h)); return `${n} hour${n === 1 ? '' : 's'}`; }
  return `${Math.round(h / 24)} days`;
}

/**
 * Should Victor be nudged about this place? `last` is { seenAt } from the newest Interval week the
 * Circle ever held here, or null. No Interval week ever held means no evidence the place is on
 * Interval at all, so there is nothing to call stale — a nudge there would be noise he learns to
 * ignore. Quiet hours (`quiet`) are alertPush's own: nothing 23:00-07:00 Aruba time; a tap at
 * midnight is not worth waking anyone, and the next tap after seven asks again.
 */
export function decideNudge({ state, stay, last, now = Date.now(), caps = CAPS, quiet = false }) {
  const seen = Date.parse(last?.seenAt || '');
  if (!Number.isFinite(seen)) return { push: false, why: 'the Circle has never held an Interval week here, so there is nothing to call stale' };
  const age = now - seen;
  if (age <= caps.intervalStaleHours * HOUR) return { push: false, why: `Interval was grabbed ${ageWords(age)} ago — fresh enough` };
  const prev = Date.parse(state.nudges?.[stay.id] || '');
  if (Number.isFinite(prev) && now - prev < caps.nudgeGapHours * HOUR) return { push: false, why: `Victor was nudged about this place ${ageWords(now - prev)} ago` };
  if (quiet) return { push: false, why: 'quiet hours (23:00-07:00 Aruba) — not nudging' };
  return {
    push: true,
    // The place and an age. Never a member, never a guest.
    message: {
      title: `A member is looking at ${stay.name}`.slice(0, 100),
      body: `Interval last grabbed ${ageWords(age)} ago. Sign in at vip.intervalworld.com and tap Grab.`,
      priority: 3,
      click: 'https://vip.intervalworld.com',
    },
  };
}

// ---------------------------------------------------------------- the push to his phone
// The same topic and the same POST alertPush.js uses (JSON to the server root), and the same quiet
// rule, read from alertPush itself rather than copied, so the two cannot drift apart.
const ALERT_PUSH = process.env.ALERTPUSH_MODULE || '/home/openclaw/premanifest-bot/alertPush.js';
const ALERT_CONFIG = process.env.ALERTPUSH_CONFIG || '/home/openclaw/premanifest-bot/credentials/alert-push.json';

async function ntfySend({ server = 'https://ntfy.sh', topic }, m) {
  const r = await fetch(`${server}/`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ topic, title: m.title, message: m.body, priority: m.priority, click: m.click }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`ntfy answered HTTP ${r.status}`);
  const j = await r.json();
  if (!j.id) throw new Error('ntfy answered but gave no message id, so it was not stored');
}

/** `send`, `inQuiet` and the files are injectable so a test never reaches the real topic. */
export function makePusher({ cfgFile = ALERT_CONFIG, modFile = ALERT_PUSH, send = ntfySend, inQuiet = null } = {}) {
  const cfg = () => JSON.parse(readFileSync(cfgFile, 'utf8'));
  return {
    quiet(now = new Date()) {
      const mod = inQuiet ? null : createRequire(import.meta.url)(modFile);
      const rule = cfg().quiet || mod?.DEFAULTS?.quiet || [23, 7];
      return (inQuiet || mod.inQuiet)(now, rule);
    },
    async send(msg) {
      try {
        const c = cfg();
        if (!c.ntfy?.topic) return { ok: false, error: 'no ntfy topic is set up' };
        await send(c.ntfy, msg);
        return { ok: true };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  };
}

/** A notice that must reach him but not at night: held in the state file, sent after seven. */
export async function flushHeld(state, pusher, log, now = new Date()) {
  if (!state.held?.length || pusher.quiet(now)) return false;
  const msg = state.held[0];
  const r = await pusher.send(msg);
  if (r.ok) { state.held.shift(); log(`  sent the notice that was held for the night: ${msg.title}`); return true; }
  log(`  could not send the held notice (${r.error}) — will try again`);
  return false;
}
export async function tellOrHold(state, pusher, msg, log, now = new Date()) {
  if (pusher.quiet(now)) { (state.held ||= []).push(msg); log(`  held until seven: ${msg.title}`); return false; }
  const r = await pusher.send(msg);
  if (!r.ok) { (state.held ||= []).push(msg); log(`  could not send it (${r.error}) — held and will be tried again`); }
  return r.ok;
}

// ---------------------------------------------------------------- one poll's worth of taps
/**
 * Act on what members opened since the last poll. `deps` carries the world: sweepResort(slug),
 * intervalLastSeen(stayId), pusher, log. Returns what was decided per place, for the tests.
 */
export async function handleTaps({ taps, catalog, state, deps, now = () => Date.now(), caps = CAPS }) {
  const { sweepResort, intervalLastSeen, pusher, log } = deps;
  // Ten members opening the Surf Club in one minute are one place to look at, not ten.
  const first = new Map();
  for (const t of taps) if (!first.has(t.stay) || t.tapped < first.get(t.stay)) first.set(t.stay, t.tapped);
  const done = [];
  for (const [stayId, tapped] of first) {
    const stay = catalog.get(stayId);
    if (!stay) { log(`tap  a stay that is not in the catalog (${String(stayId).slice(0, 8)}) — nothing to do`); continue; }
    const lag = Math.max(0, Math.round((now() - Date.parse(tapped)) / 1000));
    log(`tap  ${stay.name} — opened by a member at ${tapped}, ${lag}s ago`);
    const row = { stay: stay.name, sweep: null, nudge: null };

    const slug = slugFor(stay, catalog);
    if (!slug) {
      row.sweep = { go: false, why: 'RedWeek has no page we read for this place' };
    } else {
      row.sweep = decideSweep(state, slug, now(), caps);
      if (row.sweep.go) {
        noteTapSweep(state, now());
        log(`  RedWeek: reading ${slug} now`);
        try {
          const r = row.sweep.result = await sweepResort(slug);
          log(`  RedWeek: ${slug} read — ${r?.found?.length ?? 0} worth posting, ${r?.posted ?? 0} new on the board, ${r?.refreshed ?? 0} last-seen clocks moved`);
        }
        catch (err) { row.sweep.error = err.message; log(`  RedWeek: the read failed — ${err.message}`); }
      }
    }
    if (!row.sweep.go) log(`  RedWeek: not reading — ${row.sweep.why}`);

    let last = null;
    try { last = await intervalLastSeen(stayId); }
    catch (err) { row.nudge = { push: false, why: err.message }; log(`  Interval: could not tell how old the last grab is — ${err.message}`); }
    if (!row.nudge) {
      row.nudge = decideNudge({ state, stay, last, now: now(), caps, quiet: pusher.quiet(new Date(now())) });
      if (!row.nudge.push) log(`  Interval: no nudge — ${row.nudge.why}`);
      else {
        const r = await pusher.send(row.nudge.message);
        if (r.ok) { (state.nudges ||= {})[stay.id] = new Date(now()).toISOString(); log(`  Interval: nudged Victor — ${row.nudge.message.body}`); }
        else { row.nudge = { push: false, why: `push failed: ${r.error}` }; log(`  Interval: the nudge did not go (${r.error})`); }
      }
    }
    done.push(row);
  }
  return done;
}
