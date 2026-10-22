// A member opens a stay: what the watcher does, and above all what it will not do.
//
// No network, no credentials. The first thing this file does is make the real network unreachable,
// so a test that forgot to stub something fails loudly instead of reaching RedWeek, Interval or
// ntfy.sh — the same guard session.test.mjs carries, for the same reason.
//
//   node --test taps.test.mjs

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, existsSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CAPS, noteSwept, noteRedweekScan, lastRedweekRead, widen, decideNudge, slugFor, ageWords, emptyState, loadState, saveState,
  makePusher, flushHeld, tellOrHold, handleTaps,
} from './taps.mjs';
import {
  rentals, sweep, robotsAllows, useStopFile, stopped, RedWeekStop, RedWeekBackoff, _forgetRobots,
  useBackoffFile, backoff, clearBackoff, isTimeout, pauseMs, BACKOFF_MS,
} from './redweek.mjs';
import { parseTimes, lastSlot, nextSlot, due, arubaClock, DEFAULT_TIMES } from './schedule.mjs';

const realFetch = globalThis.fetch;
const tried = [];
before(() => { globalThis.fetch = (url) => { tried.push(String(url)); throw new Error(`test tried to reach the real network: ${String(url).slice(0, 70)}`); }; });
after(() => { globalThis.fetch = realFetch; });

const T0 = Date.parse('2026-10-22T16:00:00Z');     // noon in Aruba
const min = (n) => n * 60e3, hour = (n) => n * 3600e3;
const iso = (ms) => new Date(ms).toISOString();

const SURF = { id: 'stay-surf', name: 'Marriott’s Aruba Surf Club' };      // the curly apostrophe the catalog really has
const EAGLE = { id: 'stay-eagle', name: 'Eagle Aruba Resort' };
const HILTON = { id: 'stay-hilton', name: 'Hilton Aruba Caribbean Resort & Casino' };
const catalog = new Map([SURF, EAGLE, HILTON].map(s => [s.id, s]));

// ---------------------------------------------------------------- RedWeek: not for a tap
// Victor, 22 Oct 2026: "RedWeek can be scanned 2 times a day automatically." A tap is served from the last scan.
test('the caps that are left are the ones that were not about RedWeek reads', () => {
  assert.deepEqual({ ...CAPS }, { intervalStaleHours: 24, nudgeGapHours: 12, boardGapMin: 15 });
});

test('the last RedWeek read is the newest of the resorts\' read times, or nothing', () => {
  const st = emptyState();
  assert.equal(lastRedweekRead(st), null);
  noteSwept(st, 'P4872-x', T0); noteSwept(st, 'P148-y', T0 + min(1));
  assert.equal(lastRedweekRead(st), T0 + min(1));
  assert.equal(st.redweekScan, null);
  noteRedweekScan(st, T0); assert.equal(st.redweekScan, iso(T0));
});

test('two taps for the same place want the widest of their dates; a tap with none adds none', () => {
  assert.deepEqual(widen({ from: '2026-11-01', to: '2026-11-15' }, { from: '2026-12-20', to: '2027-01-03' }), { from: '2026-11-01', to: '2027-01-03' });
  assert.deepEqual(widen(null, { from: '2026-12-20', to: '2027-01-03' }), { from: '2026-12-20', to: '2027-01-03' });
  assert.deepEqual(widen({ from: '2026-12-20', to: '2027-01-03' }, { from: null, to: null }), { from: '2026-12-20', to: '2027-01-03' });
  assert.deepEqual(widen(null, null), { from: null, to: null });
});

test('a catalog stay finds its RedWeek page by name, apostrophes and all; one RedWeek does not have finds none', () => {
  assert.equal(slugFor(SURF, catalog), 'P4872-marriotts-aruba-surf-club');
  assert.equal(slugFor(EAGLE, catalog), 'P146-eagle-aruba-resort');
  assert.equal(slugFor(HILTON, catalog), null);
});

// ---------------------------------------------------------------- Interval: nudge Victor, once
const quietNo = false;
test('Interval grabbed over a day ago: one nudge, naming the place and the age, and no one else', () => {
  const st = emptyState();
  const d = decideNudge({ state: st, stay: SURF, last: { seenAt: iso(T0 - hour(24 * 32)) }, now: T0, quiet: quietNo });
  assert.equal(d.push, true);
  assert.equal(d.message.title, 'A member is looking at Marriott’s Aruba Surf Club');
  assert.equal(d.message.body, 'Interval last grabbed 32 days ago. Sign in at vip.intervalworld.com and tap Grab.');
  assert.deepEqual(Object.keys(d.message).sort(), ['body', 'click', 'priority', 'title'], 'no field that could carry a member');
});

test('Interval grabbed within the day: nothing to say', () => {
  const d = decideNudge({ state: emptyState(), stay: SURF, last: { seenAt: iso(T0 - hour(23)) }, now: T0 });
  assert.equal(d.push, false);
  assert.match(d.why, /fresh enough/);
});

test('once per resort per 12 hours', () => {
  const st = emptyState();
  const last = { seenAt: iso(T0 - hour(100)) };
  st.nudges[SURF.id] = iso(T0 - hour(11));
  assert.equal(decideNudge({ state: st, stay: SURF, last, now: T0 }).push, false);
  assert.equal(decideNudge({ state: st, stay: EAGLE, last, now: T0 }).push, true, 'another resort is its own');
  st.nudges[SURF.id] = iso(T0 - hour(12) - 1);
  assert.equal(decideNudge({ state: st, stay: SURF, last, now: T0 }).push, true);
});

test('a place the Circle never held an Interval week at gets no nudge — there is nothing to call stale', () => {
  for (const last of [null, {}, { seenAt: null }, { seenAt: 'not a date' }]) {
    assert.equal(decideNudge({ state: emptyState(), stay: HILTON, last, now: T0 }).push, false);
  }
});

test('quiet hours: no nudge', () => {
  const d = decideNudge({ state: emptyState(), stay: SURF, last: { seenAt: iso(T0 - hour(100)) }, now: T0, quiet: true });
  assert.equal(d.push, false);
  assert.match(d.why, /quiet hours/);
});

test('ages are said in hours up to two days, then days', () => {
  assert.equal(ageWords(hour(25)), '25 hours');
  assert.equal(ageWords(hour(47.4)), '47 hours');
  assert.equal(ageWords(hour(49)), '2 days');
  assert.equal(ageWords(hour(24 * 32)), '32 days');
});

// ---------------------------------------------------------------- the push itself
function pusherWith({ quiet = false, topic = 'topic-for-tests' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'taps-'));
  const cfgFile = join(dir, 'alert-push.json');
  writeFileSync(cfgFile, JSON.stringify({ ntfy: { server: 'https://ntfy.invalid', topic } }));
  const sent = [];
  const flag = { quiet };
  const p = makePusher({ cfgFile, send: async (cfg, m) => { sent.push({ cfg, m }); }, inQuiet: () => flag.quiet });
  return { p, sent, flag, dir };
}

test('a push goes to the configured topic and is recorded by the stub, not by ntfy.sh', async () => {
  const { p, sent } = pusherWith();
  const r = await p.send({ title: 't', body: 'b', priority: 3 });
  assert.equal(r.ok, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].cfg.topic, 'topic-for-tests');
  assert.deepEqual(tried, [], 'nothing reached the real network');
});

test('no topic configured: the push says so and sends nothing', async () => {
  const { p, sent } = pusherWith({ topic: '' });
  const r = await p.send({ title: 't', body: 'b' });
  assert.equal(r.ok, false);
  assert.match(r.error, /no ntfy topic/);
  assert.equal(sent.length, 0);
});

test('the real quiet rule (alertPush.js, 23:00-07:00 Aruba) is the one in use', { skip: !existsSync('/home/openclaw/premanifest-bot/alertPush.js') }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'taps-'));
  const cfgFile = join(dir, 'c.json'); writeFileSync(cfgFile, JSON.stringify({ ntfy: { topic: 'x' } }));
  const p = makePusher({ cfgFile, send: async () => {} });
  assert.equal(p.quiet(new Date('2026-10-23T03:30:00Z')), true, '23:30 in Aruba');
  assert.equal(p.quiet(new Date('2026-10-22T10:59:00Z')), true, '06:59 in Aruba');
  assert.equal(p.quiet(new Date('2026-10-22T11:00:00Z')), false, '07:00 in Aruba');
  assert.equal(p.quiet(new Date('2026-10-22T16:00:00Z')), false, 'noon');
  assert.equal(p.quiet(new Date('2026-10-23T02:59:00Z')), false, '22:59 in Aruba');
});

test('a notice that must reach him is held through the night and sent once after seven', async () => {
  const { p, sent, flag } = pusherWith({ quiet: true });
  const st = emptyState(), lines = [];
  assert.equal(await tellOrHold(st, p, { title: 'RedWeek told the watcher to stop', body: 'x' }, (l) => lines.push(l)), false);
  assert.equal(sent.length, 0);
  assert.equal(st.held.length, 1);
  assert.equal(await flushHeld(st, p, () => {}), false, 'still night: still held');
  flag.quiet = false;
  assert.equal(await flushHeld(st, p, () => {}), true);
  assert.equal(sent.length, 1);
  assert.equal(st.held.length, 0);
  assert.equal(await flushHeld(st, p, () => {}), false, 'and not sent twice');
});

// ---------------------------------------------------------------- one poll of taps
function world({ last = { seenAt: iso(T0 - hour(24 * 32)) }, quiet = false, scanned = T0 - hour(6) } = {}) {
  const calls = { intervalAsked: [], scan: [], aruba: [], board: 0 };
  const { p, sent, flag } = pusherWith({ quiet });
  const lines = [];
  const state = emptyState();
  if (scanned) { noteSwept(state, 'P4872-marriotts-aruba-surf-club', scanned); noteRedweekScan(state, scanned); }
  const deps = {
    log: (l) => lines.push(l), pusher: p,
    intervalLastSeen: async (id) => { calls.intervalAsked.push(id); return last; },
    scanInterval: undefined,
    verifyBoard: async () => { calls.board++; return { verified: 0, repriced: 0, retired: 1 }; },
  };
  return { calls, sent, lines, state, deps, flag };
}
const tapNow = (w, taps, at = T0) => handleTaps({ taps, catalog, state: w.state, deps: w.deps, now: () => at });

test('a tap on the Surf Club nudges Victor once and reads no RedWeek — and says when RedWeek was last read', async () => {
  const w = world({ scanned: Date.parse('2026-10-22T10:00:00Z') });                     // 06:00 Aruba
  const rows = await tapNow(w, [{ stay: SURF.id, tapped: iso(T0 - 8000) }]);
  assert.equal(w.sent.length, 1);
  assert.match(w.sent[0].m.body, /Interval last grabbed 32 days ago/);
  assert.equal('sweep' in rows[0], false, 'there is no RedWeek read in the answer any more');
  assert.ok(w.lines.some(l => /opened by a member at .*, 8s ago, no dates sent/.test(l)), 'the journal says when it was tapped and how long it took');
  assert.ok(w.lines.some(l => /RedWeek: not read for a tap — it is scanned twice a day; the last read was at 06:00 Aruba time, and that is the answer/.test(l)));
  assert.equal(tried.length, 0, 'and nothing went near the network');
});

test('before RedWeek has ever been read, the journal says so rather than inventing a time', async () => {
  const w = world({ scanned: null });
  await tapNow(w, [{ stay: SURF.id, tapped: iso(T0) }]);
  assert.ok(w.lines.some(l => /RedWeek: not read for a tap — it is scanned twice a day; it has not been read yet/.test(l)));
});

test('THE DATES: a tap that carries them hands them to the Interval scan, and the journal prints them', async () => {
  const w = world();
  const asked = [];
  w.deps.scanInterval = async (stay, window) => { asked.push([stay.id, window]); return { ran: true, covered: true, rows: 3, posted: 1, refreshed: 0 }; };
  const rows = await tapNow(w, [{ stay: SURF.id, tapped: iso(T0), from: '2026-12-20', to: '2027-01-03' }]);
  assert.deepEqual(asked, [[SURF.id, { from: '2026-12-20', to: '2027-01-03' }]]);
  assert.deepEqual(rows[0].window, { from: '2026-12-20', to: '2027-01-03' });
  assert.ok(w.lines.some(l => /tap  Marriott’s Aruba Surf Club — opened by a member at .*, looking for 2026-12-20 to 2027-01-03$/.test(l)));
});

test('a tap from an older phone carries no dates: the scan gets none and says so', async () => {
  const w = world();
  const asked = [];
  w.deps.scanInterval = async (stay, window) => { asked.push(window); return { ran: false, covered: false, why: 'off' }; };
  await tapNow(w, [{ stay: SURF.id, tapped: iso(T0) }]);
  assert.deepEqual(asked, [null]);
  assert.ok(w.lines.some(l => /no dates sent \(an older phone\)/.test(l)));
});

test('ten members, one place, one poll: one scan for the widest of their dates, one nudge', async () => {
  const w = world();
  const asked = [];
  w.deps.scanInterval = async (stay, window) => { asked.push(window); return { ran: false, covered: false, why: 'capped' }; };
  const taps = Array.from({ length: 10 }, (_, i) => ({ stay: SURF.id, tapped: iso(T0 - i * 1000), from: i === 3 ? '2026-11-01' : '2026-12-01', to: i === 7 ? '2027-02-01' : '2026-12-15' }));
  await tapNow(w, taps);
  assert.deepEqual(asked, [{ from: '2026-11-01', to: '2027-02-01' }]);
  assert.equal(w.sent.length, 1);
});

test('a second poll five minutes later is not nudged again', async () => {
  const w = world();
  await tapNow(w, [{ stay: SURF.id, tapped: iso(T0) }]);
  const rows = await tapNow(w, [{ stay: SURF.id, tapped: iso(T0 + min(5)) }], T0 + min(5));
  assert.equal(w.sent.length, 1);
  assert.match(rows[0].nudge.why, /nudged/);
});

test('a place RedWeek has no page for still gets the Interval nudge', async () => {
  const w = world();
  await tapNow(w, [{ stay: HILTON.id, tapped: iso(T0) }]);
  assert.equal(w.sent.length, 1);
});

test('at night the phone stays quiet', async () => {
  const w = world({ quiet: true });
  await tapNow(w, [{ stay: SURF.id, tapped: iso(T0) }]);
  assert.equal(w.sent.length, 0);
});

test('a failed push is not remembered as sent, so the next tap tries again', async () => {
  const w = world();
  w.deps.pusher = { quiet: () => false, send: async () => ({ ok: false, error: 'ntfy answered HTTP 500' }) };
  await tapNow(w, [{ stay: SURF.id, tapped: iso(T0) }]);
  assert.equal(w.state.nudges[SURF.id], undefined);
});

test('a tap on an unknown place is skipped, and does not stop the next', async () => {
  const w = world();
  const rows = await tapNow(w, [{ stay: 'nope', tapped: iso(T0) }, { stay: SURF.id, tapped: iso(T0) }]);
  assert.equal(rows.length, 1);
  assert.equal(w.sent.length, 1);
});

test('THE STAYS LIST: the board is re-checked WITHOUT RedWeek, the dates go to the island scan, and the journal says what RedWeek last was', async () => {
  const w = world({ scanned: Date.parse('2026-10-22T22:00:00Z') });                     // 18:00 Aruba
  const asked = [];
  w.deps.scanAruba = async (window) => { asked.push(window); return { ran: true, covered: true, rows: 15, posted: 4, refreshed: 1 }; };
  const rows = await tapNow(w, [{ stay: null, tapped: iso(T0), from: '2026-10-22', to: '2026-12-21' }]);
  assert.equal(w.calls.board, 1);
  assert.deepEqual(asked, [{ from: '2026-10-22', to: '2026-12-21' }]);
  assert.deepEqual(rows[0].window, { from: '2026-10-22', to: '2026-12-21' });
  assert.ok(w.lines.some(l => /tap  the Stays list — opened by a member at .*, looking for 2026-10-22 to 2026-12-21/.test(l)));
  assert.ok(w.lines.some(l => /Board: re-checked without RedWeek — 0 weeks verified, 0 repriced, 1 retired/.test(l)));
  assert.ok(w.lines.some(l => /RedWeek: not read for a tap — .*the last read was at 18:00 Aruba time/.test(l)));
  // Opened again two minutes later: the board is not re-checked again, and the dates still reach the scan.
  asked.length = 0;
  await tapNow(w, [{ stay: null, tapped: iso(T0 + min(2)), from: '2026-12-20', to: '2027-01-03' }], T0 + min(2));
  assert.equal(w.calls.board, 1, 'one re-check per 15 minutes');
  assert.deepEqual(asked, [{ from: '2026-12-20', to: '2027-01-03' }]);
});

test('state survives a restart, and the file is private', () => {
  const dir = mkdtempSync(join(tmpdir(), 'taps-'));
  const f = join(dir, 'state.json');
  const st = emptyState(); noteSwept(st, 'P1', T0); noteRedweekScan(st, T0); st.nudges.x = iso(T0);
  saveState(f, st);
  assert.deepEqual(loadState(f), st);
  assert.equal(statSync(f).mode & 0o777, 0o600);
  assert.deepEqual(loadState(join(dir, 'missing.json')), emptyState());
  writeFileSync(f, '{not json'); assert.deepEqual(loadState(f), emptyState());
});

// ---------------------------------------------------------------- Interval, by a tap, only through the scan
// Victor's words of 22 Oct 2026 allow an Interval scan on a member's tap, with guardrails
// (interval-scan.mjs). What this file still guarantees is that taps.mjs itself holds no way in:
// the scan is handed to it, and the half-hourly pass cannot reach it.
test('the tap path reaches Interval only through the guarded scan, which is off unless switched on', () => {
  const src = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');
  const chain = src.indexOf('const wantsInterval');
  const guard = src.indexOf('if (fromTap) {', chain);
  const firstBranch = src.indexOf('} else if (!wantsInterval)', chain);
  assert.ok(chain > 0 && guard > chain && guard < firstBranch, 'the `fromTap` (a member’s tap) branch is first in the by-hand Interval chain, so a tap pass never runs it');
  // And a member's tap reaches RedWeek NOWHERE: the one pass it can ask for is the board re-check, which reads none.
  const poll = src.slice(src.indexOf('async function pollTaps()'), src.indexOf('async function intervalRead()') > 0 ? src.indexOf('/**\n * ONE read of Interval') : undefined);
  assert.ok(poll.includes('pass(circle, { redweek: false, fromTap: true })'), 'the Stays-list tap runs the board pass with RedWeek switched off');
  assert.equal((poll.match(/\bpass\(/g) || []).length, 1, 'and that is the only pass a tap can start');
  assert.ok(!/sweep|rentals|sweepResort/.test(poll), 'nothing in the tap handler reads RedWeek');
  assert.ok(!src.includes('sweepResort'), 'the per-resort tap read is gone');
  // The one door: the scanner, armed only by an explicit switch whose default is off.
  assert.ok(src.includes("armed: () => flag('WATCH_INTERVAL_SCAN', false)"), 'the scan is armed by WATCH_INTERVAL_SCAN, default off');
  // The one other door is a person's, not a member's: --interval-read, which refuses without --confirm and never signs in.
  const read = src.slice(src.indexOf('async function intervalRead()'), src.indexOf("if (args.has('--interval-read'))"));
  assert.ok(read.includes("!args.has('--confirm')") && read.includes('canSignIn: false'), 'the by-hand read needs --confirm and uses a saved session only');
  assert.equal((src.match(/armed: \(\) => true/g) || []).length, 1, 'and it is the only scanner that is armed without the switch');
  assert.ok(read.includes("armed: () => true"), 'that one is the by-hand read');
  assert.equal((src.match(/new IntervalSession\(/g) || []).length, 1, 'one place builds the Interval browser');
  assert.ok(/makeSession: \(\) => new IntervalSession\(/.test(src), 'and it is inside the scanner');
  assert.equal((src.match(/scanInterval\(/g) || []).length, 1, 'the scan is called from one place only: the tap handler’s deps');
  assert.ok(src.includes('scanInterval: (stay, window) => scanInterval(stay, catalog, window)'), 'and that place is inside pollTaps, which only a tap feeds');
  // taps.mjs can only call what it imports. It imports no Interval client and no browser.
  const taps = readFileSync(new URL('./taps.mjs', import.meta.url), 'utf8');
  const imports = [...taps.matchAll(/^import .* from '([^']+)';/gm)].map(m => m[1]).sort();
  assert.deepEqual(imports, ['./judge.mjs', './redweek.mjs', './schedule.mjs', 'node:fs', 'node:module'], 'taps.mjs imports no Interval client, no browser');
});

test('a scan that worked replaces the nudge: Interval was just read, there is nothing to go and look at', async () => {
  const w = world();
  w.deps.scanInterval = async () => ({ ran: true, covered: true, rows: 3, posted: 2, refreshed: 1 });
  const rows = await handleTaps({ taps: [{ stay: SURF.id, tapped: iso(T0) }], catalog, state: w.state, deps: w.deps, now: () => T0 });
  assert.equal(w.sent.length, 0);
  assert.equal(w.calls.intervalAsked.length, 0, 'it did not even ask how old the last grab was');
  assert.ok(w.lines.some(l => /Interval: scanned — 3 weeks read, 2 new on the board, 1 last-seen clock moved/.test(l)));
  assert.equal(rows[0].nudge.push, false);
});

test('a tap served from an earlier scan is covered too, and says so', async () => {
  const w = world();
  w.deps.scanInterval = async () => ({ ran: false, covered: true, why: 'scanned 5 min ago — served from that scan' });
  await handleTaps({ taps: [{ stay: SURF.id, tapped: iso(T0) }], catalog, state: w.state, deps: w.deps, now: () => T0 });
  assert.equal(w.sent.length, 0);
  assert.ok(w.lines.some(l => /not scanning — scanned 5 min ago — served from that scan/.test(l)));
});

test('when the scan is off, stopped, capped, failed or throws, the Grab nudge fires exactly as before', async () => {
  for (const scan of [
    async () => ({ ran: false, covered: false, why: 'the Interval scan is switched off' }),
    async () => ({ ran: false, covered: false, stopped: true, why: 'stopped since today' }),
    async () => ({ ran: false, covered: false, why: '3 sign-ins in the last 24 hours (cap 3)' }),
    async () => ({ ran: true, covered: false, why: 'Interval did not sign the watcher in' }),
    async () => { throw new Error('boom'); },
  ]) {
    const w = world();
    w.deps.scanInterval = scan;
    const rows = await handleTaps({ taps: [{ stay: SURF.id, tapped: iso(T0) }], catalog, state: w.state, deps: w.deps, now: () => T0 });
    assert.equal(w.sent.length, 1, 'the nudge still goes');
    assert.match(w.sent[0].m.body, /Interval last grabbed 32 days ago/);
    assert.equal(rows[0].nudge.push, true);
  }
});

// ---------------------------------------------------------------- RedWeek says no
const fixture = readFileSync(new URL('./fixtures-redweek-surfclub.html', import.meta.url), 'utf8');
const answer = (status, body = '', type = 'text/html') => new Response(body, { status, headers: { 'content-type': type } });
/** A RedWeek stub: robots.txt and the resort pages. Counts every request. */
function redweek({ robots = 'User-agent: *\nDisallow: /search\n', page = () => answer(200, fixture), robotsStatus = 200, robotsErr = null } = {}) {
  const seen = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    seen.push(u);
    if (!u.startsWith('https://www.redweek.com/')) throw new Error(`test tried to reach the real network: ${u.slice(0, 70)}`);
    if (u.endsWith('/robots.txt')) { if (robotsErr) throw robotsErr(); return answer(robotsStatus, robots, 'text/plain'); }
    return page(u);
  };
  return seen;
}
const freshStop = () => { const dir = mkdtempSync(join(tmpdir(), 'stop-')); const f = join(dir, '.redweek-stop.json'); useStopFile(f); _forgetRobots(); return f; };

test('an ordinary page is read, robots.txt is asked first, and nothing is stopped', async () => {
  const f = freshStop(); const seen = redweek();
  const rows = await rentals('P4872-marriotts-aruba-surf-club');
  assert.ok(rows.length > 0);
  assert.equal(seen[0], 'https://www.redweek.com/robots.txt');
  assert.equal(stopped(), null);
  assert.equal(existsSync(f), false);
});

test('a 403 is a full stop: it is written down, nothing is asked again, and a restart still knows', async () => {
  const f = freshStop(); const seen = redweek({ page: () => answer(403, 'Forbidden') });
  await assert.rejects(rentals('P4872-marriotts-aruba-surf-club'), (e) => e instanceof RedWeekStop && /403/.test(e.message));
  const asked = seen.length;
  assert.ok(existsSync(f));
  assert.equal(statSync(f).mode & 0o777, 0o600);
  await assert.rejects(rentals('P148-marriotts-aruba-ocean-club'), RedWeekStop);
  assert.equal(seen.length, asked, 'the second resort was not even asked');
  useStopFile(f);                                       // a restart: memory gone, the file remains
  assert.match(stopped().why, /403/);
  await assert.rejects(rentals('P146-eagle-aruba-resort'), RedWeekStop);
  assert.equal(seen.length, asked);
  unlinkSync(f);                                        // Victor deletes it
  assert.equal(stopped(), null);
});

test('a sweep stops at the first resort that says no, rather than trying the other five', async () => {
  freshStop(); const seen = redweek({ page: () => answer(403) });
  const reports = [];
  const out = await sweep(['P4872-a', 'P148-b', 'P146-c'], { pauseMs: 0, onResort: (slug, n, err) => reports.push([slug, err?.stop === true]) });
  assert.deepEqual(out, []);
  assert.deepEqual(reports, [['P4872-a', true]]);
  assert.equal(seen.filter(u => !u.endsWith('robots.txt')).length, 1);
});

test('a challenge page that arrives as a 200 is a full stop', async () => {
  freshStop(); redweek({ page: () => answer(200, '<html><title>Just a moment...</title><div id="cf-challenge">Verify you are human</div></html>') });
  await assert.rejects(rentals('P4872-x'), (e) => e instanceof RedWeekStop && /challenge/.test(e.message));
});

test('a resort with nothing open is not a challenge', async () => {
  freshStop(); redweek({ page: () => answer(200, '<html><body><h1>Amsterdam Manor</h1><p>No rentals right now.</p></body></html>') });
  assert.deepEqual(await rentals('P6631-amsterdam-manor-beach-resort'), []);
  assert.equal(stopped(), null);
});

test('robots.txt disallowing the page is a full stop before the page is asked', async () => {
  freshStop(); const seen = redweek({ robots: 'User-agent: *\nDisallow: /resort/\n' });
  await assert.rejects(rentals('P4872-x'), (e) => e instanceof RedWeekStop && /robots/.test(e.message));
  assert.equal(seen.some(u => u.includes('/resort/')), false, 'the page itself was never requested');
});

test('robots.txt refusing us with a 403 is a full stop; one that is simply missing is not', async () => {
  freshStop(); redweek({ robotsStatus: 403 });
  await assert.rejects(rentals('P4872-x'), RedWeekStop);
  freshStop(); redweek({ robotsStatus: 404 });
  assert.ok((await rentals('P4872-x')).length > 0);
});

test('a 429 is slow-down, not go-away: an ordinary error, nothing written', async () => {
  const f = freshStop(); redweek({ page: () => answer(429) });
  await assert.rejects(rentals('P4872-x'), (e) => !e.stop && /rate-limiting/.test(e.message));
  assert.equal(existsSync(f), false);
});

test('robots.txt rules: the longest match wins, Allow wins a tie, our own group beats *', () => {
  const txt = 'User-agent: *\nDisallow: /resort/*/private\nDisallow: /search\nAllow: /search/ok\n\nUser-agent: InnerHotelCircleWatcher\nDisallow: /members\n';
  assert.equal(robotsAllows(txt, '/members/x'), false, 'our group applies');
  assert.equal(robotsAllows(txt, '/search'), true, 'and the * group does not, because ours exists');
  const star = 'User-agent: *\nDisallow: /resort/*/private\nDisallow: /search\nAllow: /search/ok\n';
  assert.equal(robotsAllows(star, '/resort/P1/private'), false);
  assert.equal(robotsAllows(star, '/search/ok'), true);
  assert.equal(robotsAllows(star, '/resort/P1/timeshare-rentals'), true);
  assert.equal(robotsAllows('', '/anything'), true);
  assert.equal(robotsAllows('User-agent: *\nDisallow:\n', '/anything'), true, 'an empty Disallow allows all');
  assert.equal(robotsAllows('User-agent: *\nDisallow: /\n', '/anything'), false);
  // The lines RedWeek's own robots.txt really carries: a `$` anchors the end, a `*` is any run.
  const rw = 'User-agent: *\nDisallow: /account\nDisallow: /posting/*/book\nDisallow: /resort/*/review$\nDisallow: /resort/*/review?\n';
  assert.equal(robotsAllows(rw, '/resort/P4872-marriotts-aruba-surf-club/timeshare-rentals'), true, 'the page the watcher reads');
  assert.equal(robotsAllows(rw, '/resort/P4872-x/review'), false);
  assert.equal(robotsAllows(rw, '/resort/P4872-x/review/42/vote'), true, 'the `$` stops at the end of the path');
  assert.equal(robotsAllows(rw, '/posting/R1/book'), false);
  assert.equal(robotsAllows(rw, '/account/settings'), false);
});

// ---------------------------------------------------------------- RedWeek does not answer: wait a day
// Since 22 Oct 2026 every request from this server to RedWeek times out. Victor decided to wait, not to route around
// it: the first timeout stops the pass and writes a back-off; nothing asks again until a day is up; then ONE probe.
const timeoutErr = (code = 'UND_ERR_CONNECT_TIMEOUT') => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('Connect Timeout Error'), { code }) });
const freshBackoff = () => { const dir = mkdtempSync(join(tmpdir(), 'bo-')); const f = join(dir, '.redweek-backoff.json'); useBackoffFile(f); freshStop(); return f; };
const DAYMS = 24 * 3600e3;

test('what counts as "it did not answer": the connect, headers and body timers, and our own clock — and nothing else', () => {
  for (const code of ['UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'ETIMEDOUT']) assert.equal(isTimeout(timeoutErr(code)), true, code);
  assert.equal(isTimeout(Object.assign(new Error('aborted'), { name: 'AbortError' })), true);
  assert.equal(isTimeout(Object.assign(new Error('timed out'), { name: 'TimeoutError' })), true);
  for (const e of [new Error('RedWeek returned 500'), timeoutErr('ECONNRESET'), timeoutErr('ENOTFOUND'), new TypeError('fetch failed')]) assert.equal(isTimeout(e), false, e.cause?.code || e.message);
});

test('the first request that times out writes a one-day back-off, and nothing asks RedWeek again', async () => {
  const f = freshBackoff(); const seen = redweek({ page: () => { throw timeoutErr(); } });
  const before = Date.now();
  await assert.rejects(rentals('P4872-marriotts-aruba-surf-club'), (e) => e instanceof RedWeekBackoff && e.stop === true && e.backoff === true && /did not answer/.test(e.message));
  const rec = JSON.parse(readFileSync(f, 'utf8'));
  assert.ok(Math.abs(Date.parse(rec.until) - Date.parse(rec.at) - DAYMS) < 5, 'until is a day after it happened');
  assert.ok(Date.parse(rec.at) >= before - 5);
  assert.match(rec.why, /connection timed out on P4872/);
  assert.equal(statSync(f).mode & 0o777, 0o600);
  assert.equal(BACKOFF_MS, DAYMS);
  const asked = seen.length;
  for (const slug of ['P148-marriotts-aruba-ocean-club', 'P146-eagle-aruba-resort', 'P4872-marriotts-aruba-surf-club']) {
    await assert.rejects(rentals(slug), RedWeekBackoff);
  }
  assert.equal(seen.length, asked, 'not one more request, for any resort');
  assert.equal(backoff().expired, false);
  useBackoffFile(f);                                      // a restart: memory gone, the file remains
  await assert.rejects(rentals('P146-eagle-aruba-resort'), RedWeekBackoff);
  assert.equal(seen.length, asked);
  assert.equal(stopped(), null, 'a timeout is not a stop: no stop file, nothing for Victor to delete');
});

test('a timeout on robots.txt, the very first request, is the same', async () => {
  const f = freshBackoff(); const seen = redweek({ robotsErr: () => timeoutErr() });
  await assert.rejects(rentals('P4872-marriotts-aruba-surf-club'), RedWeekBackoff);
  assert.ok(existsSync(f));
  assert.equal(seen.length, 1, 'only robots.txt was asked; the page never was');
});

test('our own 30-second clock running out is a timeout too', async () => {
  const f = freshBackoff(); redweek({ page: () => { throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }); } });
  await assert.rejects(rentals('P4872-marriotts-aruba-surf-club'), RedWeekBackoff);
  assert.ok(existsSync(f));
});

test('a sweep ends at the first timeout: one request, not six', async () => {
  freshBackoff(); const seen = redweek({ page: () => { throw timeoutErr(); } });
  const reports = [];
  const out = await sweep(['P4872-a', 'P148-b', 'P146-c', 'P134-d', 'P6494-e', 'P6631-f'], { pauseMs: 0, onResort: (slug, n, err) => reports.push([slug, err?.backoff === true]) });
  assert.deepEqual(out, []);
  assert.deepEqual(reports, [['P4872-a', true]]);
  assert.equal(seen.filter((u) => !u.endsWith('robots.txt')).length, 1);
});

test('a 429, a 500 or a reset connection is not a back-off: ordinary errors, nothing written', async () => {
  const f = freshBackoff();
  redweek({ page: () => answer(500) });
  await assert.rejects(rentals('P4872-x'), (e) => !e.stop && /500/.test(e.message));
  redweek({ page: () => { throw timeoutErr('ECONNRESET'); } });
  await assert.rejects(rentals('P4872-x'), (e) => !e.stop);
  assert.equal(existsSync(f), false);
});

test('when the day is up the next request is ONE probe: robots.txt, fresh; answered, it resumes and the back-off is gone', async () => {
  const f = freshBackoff();
  redweek();                                              // everything works again
  await rentals('P4872-marriotts-aruba-surf-club');       // warms the robots.txt cache, so a probe has to ignore it
  writeFileSync(f, JSON.stringify({ at: iso(Date.now() - DAYMS - 5000), until: iso(Date.now() - 5000), why: 'connection timed out on P4872' }));
  useBackoffFile(f);
  assert.equal(backoff().expired, true);
  const seen = redweek();
  const rows = await rentals('P4872-marriotts-aruba-surf-club');
  assert.ok(rows.length > 0, 'it read the page');
  assert.equal(seen[0], 'https://www.redweek.com/robots.txt', 'and the first thing it asked was robots.txt again, not a cached copy');
  assert.equal(seen.length, 2);
  assert.equal(existsSync(f), false, 'the probe was answered: the back-off is cleared');
  assert.equal(backoff(), null);
});

test('a probe that times out costs ONE request and another day', async () => {
  const f = freshBackoff();
  writeFileSync(f, JSON.stringify({ at: iso(Date.now() - DAYMS - 5000), until: iso(Date.now() - 5000), why: 'connection timed out on P4872' }));
  useBackoffFile(f);
  const seen = redweek({ robotsErr: () => timeoutErr() });
  await assert.rejects(rentals('P4872-marriotts-aruba-surf-club'), RedWeekBackoff);
  assert.equal(seen.length, 1, 'one probe, nothing else');
  const rec = JSON.parse(readFileSync(f, 'utf8'));
  assert.ok(Date.parse(rec.until) > Date.now() + DAYMS - 5000, 'a fresh day');
  await assert.rejects(rentals('P148-marriotts-aruba-ocean-club'), RedWeekBackoff);
  assert.equal(seen.length, 1, 'and nothing more this time round either');
});

test('a back-off file that cannot be read holds, rather than letting everything through', async () => {
  const f = freshBackoff();
  writeFileSync(f, '{not json');
  const seen = redweek();
  await assert.rejects(rentals('P4872-marriotts-aruba-surf-club'), RedWeekBackoff);
  assert.equal(seen.length, 0);
  assert.equal(backoff().expired, false);
});

test('Victor deletes the file and RedWeek is asked again at once', async () => {
  const f = freshBackoff();
  redweek({ page: () => { throw timeoutErr(); } });
  await assert.rejects(rentals('P4872-marriotts-aruba-surf-club'), RedWeekBackoff);
  unlinkSync(f);
  redweek();
  assert.ok((await rentals('P4872-marriotts-aruba-surf-club')).length > 0);
});

test('the stop file still comes first: a back-off does not turn a "go away" into a wait', async () => {
  freshBackoff(); redweek({ page: () => answer(403) });
  await assert.rejects(rentals('P4872-marriotts-aruba-surf-club'), (e) => e instanceof RedWeekStop);
  clearBackoff();
  await assert.rejects(rentals('P148-marriotts-aruba-ocean-club'), RedWeekStop);
});

// ---------------------------------------------------------------- ten seconds between resorts
test('ten seconds between resorts unless WATCH_REDWEEK_PAUSE_SEC says otherwise', async () => {
  const was = process.env.WATCH_REDWEEK_PAUSE_SEC;
  try {
    delete process.env.WATCH_REDWEEK_PAUSE_SEC; assert.equal(pauseMs(), 10000, 'it was 2.5 s');
    process.env.WATCH_REDWEEK_PAUSE_SEC = ''; assert.equal(pauseMs(), 10000);
    process.env.WATCH_REDWEEK_PAUSE_SEC = '3'; assert.equal(pauseMs(), 3000);
    process.env.WATCH_REDWEEK_PAUSE_SEC = '0'; assert.equal(pauseMs(), 0, 'zero is a choice, not "unset"');
    process.env.WATCH_REDWEEK_PAUSE_SEC = 'soon'; assert.equal(pauseMs(), 10000);
    process.env.WATCH_REDWEEK_PAUSE_SEC = '-4'; assert.equal(pauseMs(), 10000);
    // And sweep() really waits that long, by default, between two resorts.
    process.env.WATCH_REDWEEK_PAUSE_SEC = '0.3';
    freshBackoff(); const at = []; globalThis.fetch = async (url) => { const u = String(url); if (!u.startsWith('https://www.redweek.com/')) throw new Error(`test tried to reach the real network: ${u.slice(0, 70)}`); if (!u.endsWith('robots.txt')) at.push(Date.now()); return u.endsWith('robots.txt') ? answer(200, 'User-agent: *\nDisallow: /search\n') : answer(200, fixture); };
    await sweep(['P4872-a', 'P148-b']);
    assert.equal(at.length, 2);
    assert.ok(at[1] - at[0] >= 280, `the second resort came ${at[1] - at[0]} ms after the first`);
  } finally { if (was === undefined) delete process.env.WATCH_REDWEEK_PAUSE_SEC; else process.env.WATCH_REDWEEK_PAUSE_SEC = was; }
});

// ---------------------------------------------------------------- two scans a day, at fixed Aruba times
const aruba = (h, m = 0, day = '2026-10-22') => Date.parse(`${day}T00:00:00Z`) + (h + 4) * 3600e3 + m * 60e3;      // Aruba is UTC-4
test('the times are 06:00 and 18:00 Aruba unless WATCH_REDWEEK_TIMES says otherwise, and junk falls back to them', () => {
  assert.equal(DEFAULT_TIMES, '06:00,18:00');
  assert.deepEqual(parseTimes(), [360, 1080]);
  assert.deepEqual(parseTimes('07:30, 19:15'), [450, 1155]);
  assert.deepEqual(parseTimes('18:00 06:00 06:00'), [360, 1080], 'sorted, no repeats');
  assert.deepEqual(parseTimes('25:00,soon'), [360, 1080]);
  assert.deepEqual(parseTimes(''), [360, 1080]);
});

test('the latest and the next scheduled moment, across midnight and on the Aruba clock', () => {
  const T = parseTimes();
  assert.equal(arubaClock(lastSlot(T, aruba(7, 10))), '06:00');
  assert.equal(arubaClock(nextSlot(T, aruba(7, 10))), '18:00');
  assert.equal(lastSlot(T, aruba(3)), aruba(18, 0, '2026-10-21'), 'at 03:00 the latest was last night\'s 18:00');
  assert.equal(nextSlot(T, aruba(23)), aruba(6, 0, '2026-10-23'), 'at 23:00 the next is tomorrow\'s 06:00');
  assert.equal(nextSlot(T, aruba(6, 0)), aruba(18), 'at exactly 06:00 the next is 18:00');
  assert.equal(lastSlot(T, aruba(6, 0)), aruba(6, 0));
  assert.equal(lastSlot(T, Date.parse('2026-10-22T22:30:00Z')), Date.parse('2026-10-22T22:00:00Z'), '22:30 UTC is 18:30 Aruba: the 18:00 scan');
});

test('a restart does not read RedWeek again: a scan is owed only if the latest scheduled time was not served', () => {
  const T = parseTimes();
  assert.equal(due(T, null, aruba(7, 10)), true, 'never scanned');
  assert.equal(due(T, iso(aruba(6, 2)), aruba(7, 10)), false, 'the 06:00 scan was done at 06:02: a restart at 07:10 leaves it');
  assert.equal(due(T, iso(aruba(18, 1, '2026-10-21')), aruba(7, 10)), true, 'last night\'s scan was the 18:00; this morning\'s 06:00 is owed');
  assert.equal(due(T, iso(aruba(5, 59)), aruba(6, 0)), true, 'a scan at 05:59 is not the 06:00 one');
  assert.equal(due(T, iso(aruba(6, 0)), aruba(17, 59)), false, 'and nothing is owed until 18:00');
  assert.equal(due(T, iso(aruba(6, 0)), aruba(18, 0)), true);
  assert.equal(due(T, 'garbage', aruba(7)), true);
});

test('in the end, nothing in this file reached a real host', () => {
  assert.deepEqual(tried, []);
});
