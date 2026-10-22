// What the watcher does the moment a member opens a stay.
//
// Victor, 22 Oct 2026: "I want the watch to watch it the moment a member clicks on stays."
// This is the nearest honest version of that, and the edges are on purpose:
//
//   RedWeek   is public, needs no login, and is read once for the resort the member is looking at
//             — at most once per resort per 15 minutes, 20 times an hour in all. A resort read
//             five minutes ago by the half-hourly pass or by another member's tap is not read
//             again: that read IS the answer, and the stay says how old it is.
//   Interval  is touched by a tap in ONE way, and only when Victor has switched it on
//             (WATCH_INTERVAL_SCAN): the scan in interval-scan.mjs, which his own words of 22 Oct
//             2026 allow and whose guardrails are part of that permission — one scan per resort per
//             30 minutes, ten an hour, three sign-ins a day, a full stop on any challenge. taps.mjs
//             does not import it: it is handed in as `scanInterval`, so this file still holds no
//             Interval client and no browser. When the scan is off, stopped, capped or fails, what a
//             tap does is the older thing: tell Victor, once per resort per 12 hours, that a member
//             is looking at a place whose Interval weeks are more than a day old — so that he, a
//             person, can open Interval and tap Grab. A scan that worked makes that unnecessary,
//             and then no nudge is sent.
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
  boardGapMin: 15,         // one full re-check of the whole board per this many minutes, however many Stays lists are opened
});
const MIN = 60e3, HOUR = 3600e3;

// ---------------------------------------------------------------- memory across restarts
export const emptyState = () => ({ sweeps: {}, tapSweeps: [], nudges: {}, held: [], board: null });

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

// ---------------------------------------------------------------- the whole board, when the Stays list opens
/**
 * Victor, 22 Oct 2026: "The watcher needs to update the moment someone clicks Stays." Opening the list
 * (not one place) is a tap on the whole board. It re-checks every live week against where it lives, but
 * at most once per 15 minutes: a check that finished eight minutes ago — by a tap or by the half-hourly
 * pass, which counts — IS the answer, and the list says "checked N min ago".
 */
export function decideBoard(state, now = Date.now(), caps = CAPS) {
  const last = Date.parse(state.board || '');
  if (Number.isFinite(last) && now - last < caps.boardGapMin * MIN) {
    const m = Math.floor((now - last) / MIN);
    return { go: false, why: `the whole board was checked ${m < 1 ? 'less than a minute' : `${m} min`} ago — that check is the answer` };
  }
  return { go: true };
}
export const noteBoard = (state, now = Date.now()) => { state.board = new Date(now).toISOString(); };

// ---------------------------------------------------------------- one poll's worth of taps
/**
 * Act on what members opened since the last poll. `deps` carries the world: sweepResort(slug),
 * intervalLastSeen(stayId), pusher, log, and optionally scanInterval(stay) (interval-scan.mjs) and, for
 * the Stays list, verifyBoard() and scanAruba(). A tap with no place is the list. Returns what was
 * decided per place, for the tests.
 */
export async function handleTaps({ taps, catalog, state, deps, now = () => Date.now(), caps = CAPS }) {
  const { sweepResort, intervalLastSeen, pusher, log, scanInterval, verifyBoard, scanAruba } = deps;
  // Ten members opening the Surf Club in one minute are one place to look at, not ten. The list is a
  // place of its own (`null`).
  const first = new Map();
  for (const t of taps) { const k = t.stay ?? null; if (!first.has(k) || t.tapped < first.get(k)) first.set(k, t.tapped); }
  const done = [];

  /** Interval, for a tap: the scan if it can go, and when it cannot (or did not complete) the Grab nudge. */
  async function interval(place, row, scan, lastOf) {
    if (scan) {
      try { row.scan = await scan(); }
      catch (err) { row.scan = { ran: false, covered: false, why: err.message }; }
      const sc = row.scan;
      if (sc.ran && sc.covered) log(`  Interval: scanned — ${sc.rows} week${sc.rows === 1 ? '' : 's'} read, ${sc.posted} new on the board, ${sc.refreshed} last-seen clock${sc.refreshed === 1 ? '' : 's'} moved`);
      else if (sc.covered) log(`  Interval: not scanning — ${sc.why}`);
      else log(`  Interval: ${sc.ran ? 'the scan did not complete' : 'not scanning'} — ${sc.why}`);
    }
    if (row.scan?.covered) {
      // Interval was just read. There is nothing for Victor to go and look at.
      row.nudge = { push: false, why: 'Interval was just scanned' };
      log(`  Interval: no nudge — ${row.nudge.why}`);
      return;
    }
    let last = null;
    try { last = await lastOf(); }
    catch (err) { row.nudge = { push: false, why: err.message }; log(`  Interval: could not tell how old the last grab is — ${err.message}`); }
    if (!row.nudge) {
      row.nudge = decideNudge({ state, stay: place, last, now: now(), caps, quiet: pusher.quiet(new Date(now())) });
      if (!row.nudge.push) log(`  Interval: no nudge — ${row.nudge.why}`);
      else {
        const r = await pusher.send(row.nudge.message);
        if (r.ok) { (state.nudges ||= {})[place.id] = new Date(now()).toISOString(); log(`  Interval: nudged Victor — ${row.nudge.message.body}`); }
        else { row.nudge = { push: false, why: `push failed: ${r.error}` }; log(`  Interval: the nudge did not go (${r.error})`); }
      }
    }
  }

  for (const [stayId, tapped] of first) {
    const lag = Math.max(0, Math.round((now() - Date.parse(tapped)) / 1000));

    if (stayId === null) {
      // THE STAYS LIST.
      log(`tap  the Stays list — opened by a member at ${tapped}, ${lag}s ago`);
      const row = { stay: null, board: null, scan: null, nudge: null };
      row.board = decideBoard(state, now(), caps);
      if (row.board.go && verifyBoard) {
        try {
          const r = row.board.result = await verifyBoard();
          noteBoard(state, now());
          if (r?.skipped) log('  Board: not re-checking — a full check finished while this tap waited its turn');
          else log(`  Board: re-checked — ${r?.verified ?? 0} week${r?.verified === 1 ? '' : 's'} verified, ${r?.repriced ?? 0} repriced, ${r?.retired ?? 0} retired`);
        } catch (err) { row.board.error = err.message; log(`  Board: the re-check failed — ${err.message}`); }
      } else if (!row.board.go) log(`  Board: not re-checking — ${row.board.why}`);
      await interval({ id: 'board', name: 'the Stays list' }, row, scanAruba, () => intervalLastSeen(null));
      done.push(row);
      continue;
    }

    const stay = catalog.get(stayId);
    if (!stay) { log(`tap  a stay that is not in the catalog (${String(stayId).slice(0, 8)}) — nothing to do`); continue; }
    log(`tap  ${stay.name} — opened by a member at ${tapped}, ${lag}s ago`);
    const row = { stay: stay.name, sweep: null, scan: null, nudge: null };

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

    await interval(stay, row, scanInterval && (() => scanInterval(stay)), () => intervalLastSeen(stayId));
    done.push(row);
  }
  return done;
}
