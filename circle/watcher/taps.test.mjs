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
  CAPS, decideSweep, noteTapSweep, noteSwept, decideNudge, slugFor, ageWords, emptyState, loadState, saveState,
  makePusher, flushHeld, tellOrHold, handleTaps,
} from './taps.mjs';
import { rentals, sweep, robotsAllows, useStopFile, stopped, RedWeekStop, _forgetRobots } from './redweek.mjs';

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

// ---------------------------------------------------------------- RedWeek: read it or not
test('a resort read in the last 15 minutes is not read again, whoever asks', () => {
  const st = emptyState();
  assert.equal(decideSweep(st, 'P4872-x', T0).go, true, 'never read: go');
  noteSwept(st, 'P4872-x', T0);
  assert.equal(decideSweep(st, 'P4872-x', T0 + min(14)).go, false);
  assert.match(decideSweep(st, 'P4872-x', T0 + min(14)).why, /14 min ago/);
  assert.equal(decideSweep(st, 'P4872-x', T0 + min(15)).go, true, 'at fifteen it may be read again');
  assert.equal(decideSweep(st, 'P148-y', T0 + min(1)).go, true, 'another resort is its own question');
});

test('twenty tap-triggered reads an hour, then taps are served from the last read', () => {
  const st = emptyState();
  for (let i = 0; i < 20; i++) { assert.equal(decideSweep(st, `P${i}`, T0 + i * 1000).go, true); noteTapSweep(st, T0 + i * 1000); }
  const d = decideSweep(st, 'P99', T0 + min(30));
  assert.equal(d.go, false);
  assert.match(d.why, /cap 20/);
  assert.equal(decideSweep(st, 'P99', T0 + hour(1) + min(1)).go, true, 'an hour later the count has drained');
});

test('the half-hourly pass counts as a read, but not against the tap cap', () => {
  const st = emptyState();
  noteSwept(st, 'P4872-x', T0);
  assert.equal(st.tapSweeps.length, 0);
  assert.equal(decideSweep(st, 'P4872-x', T0 + min(5)).go, false);
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
function world({ last = { seenAt: iso(T0 - hour(24 * 32)) }, quiet = false } = {}) {
  const calls = { sweep: [], intervalAsked: [] };
  const { p, sent, flag } = pusherWith({ quiet });
  const lines = [];
  const state = emptyState();
  const deps = {
    log: (l) => lines.push(l), pusher: p,
    sweepResort: async (slug) => { calls.sweep.push(slug); noteSwept(state, slug, T0); return { found: [1, 2], posted: 1, refreshed: 3 }; },
    intervalLastSeen: async (id) => { calls.intervalAsked.push(id); return last; },
  };
  return { calls, sent, lines, state, deps, flag };
}

test('a tap on the Surf Club reads its RedWeek page once and nudges Victor once', async () => {
  const w = world();
  const rows = await handleTaps({ taps: [{ stay: SURF.id, tapped: iso(T0 - 8000) }], catalog, state: w.state, deps: w.deps, now: () => T0 });
  assert.deepEqual(w.calls.sweep, ['P4872-marriotts-aruba-surf-club']);
  assert.equal(w.sent.length, 1);
  assert.match(w.sent[0].m.body, /Interval last grabbed 32 days ago/);
  assert.equal(rows[0].sweep.go, true);
  assert.ok(w.lines.some(l => /opened by a member at .*, 8s ago/.test(l)), 'the journal says when it was tapped and how long it took');
  assert.ok(w.lines.some(l => /read — 2 worth posting, 1 new/.test(l)));
});

test('ten members, one place, one poll: one read, one nudge', async () => {
  const w = world();
  const taps = Array.from({ length: 10 }, (_, i) => ({ stay: SURF.id, tapped: iso(T0 - i * 1000) }));
  await handleTaps({ taps, catalog, state: w.state, deps: w.deps, now: () => T0 });
  assert.equal(w.calls.sweep.length, 1);
  assert.equal(w.sent.length, 1);
});

test('a second poll five minutes later: served from the last read, and not nudged again', async () => {
  const w = world();
  await handleTaps({ taps: [{ stay: SURF.id, tapped: iso(T0) }], catalog, state: w.state, deps: w.deps, now: () => T0 });
  const rows = await handleTaps({ taps: [{ stay: SURF.id, tapped: iso(T0 + min(5)) }], catalog, state: w.state, deps: w.deps, now: () => T0 + min(5) });
  assert.equal(w.calls.sweep.length, 1);
  assert.equal(w.sent.length, 1);
  assert.match(rows[0].sweep.why, /already read 5 min ago/);
  assert.match(rows[0].nudge.why, /already|nudged/);
});

test('a place RedWeek has no page for still gets the Interval nudge, and no read', async () => {
  const w = world();
  await handleTaps({ taps: [{ stay: HILTON.id, tapped: iso(T0) }], catalog, state: w.state, deps: w.deps, now: () => T0 });
  assert.equal(w.calls.sweep.length, 0);
  assert.equal(w.sent.length, 1);
});

test('at night the read happens and the phone stays quiet', async () => {
  const w = world({ quiet: true });
  await handleTaps({ taps: [{ stay: SURF.id, tapped: iso(T0) }], catalog, state: w.state, deps: w.deps, now: () => T0 });
  assert.equal(w.calls.sweep.length, 1);
  assert.equal(w.sent.length, 0);
});

test('a failed push is not remembered as sent, so the next tap tries again', async () => {
  const w = world();
  w.deps.pusher = { quiet: () => false, send: async () => ({ ok: false, error: 'ntfy answered HTTP 500' }) };
  await handleTaps({ taps: [{ stay: SURF.id, tapped: iso(T0) }], catalog, state: w.state, deps: w.deps, now: () => T0 });
  assert.equal(w.state.nudges[SURF.id], undefined);
});

test('a read that throws does not stop the nudge, and a tap on an unknown place is skipped', async () => {
  const w = world();
  w.deps.sweepResort = async () => { throw new Error('boom'); };
  const rows = await handleTaps({ taps: [{ stay: 'nope', tapped: iso(T0) }, { stay: SURF.id, tapped: iso(T0) }], catalog, state: w.state, deps: w.deps, now: () => T0 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sweep.error, 'boom');
  assert.equal(w.sent.length, 1);
});

test('state survives a restart, and the file is private', () => {
  const dir = mkdtempSync(join(tmpdir(), 'taps-'));
  const f = join(dir, 'state.json');
  const st = emptyState(); noteSwept(st, 'P1', T0); noteTapSweep(st, T0); st.nudges.x = iso(T0);
  saveState(f, st);
  assert.deepEqual(loadState(f), st);
  assert.equal(statSync(f).mode & 0o777, 0o600);
  assert.deepEqual(loadState(join(dir, 'missing.json')), emptyState());
  writeFileSync(f, '{not json'); assert.deepEqual(loadState(f), emptyState());
});

// ---------------------------------------------------------------- Interval is out of reach of a tap
test('the tap path never reaches Interval: the pass for a tap skips that whole section, and nothing else calls it', () => {
  const src = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');
  const chain = src.indexOf('const wantsInterval');
  const guard = src.indexOf('if (only) {', chain);
  const firstBranch = src.indexOf('} else if (!wantsInterval)', chain);
  assert.ok(chain > 0 && guard > chain && guard < firstBranch, 'the `only` (a member’s tap) branch is first in the Interval chain, so no later branch can run');
  assert.ok(src.includes("sweepResort: (slug) => serial(() => pass(circle, { only: [slug] }))"), 'a tap reaches the board only through pass(only)');
  // taps.mjs can only call what it imports. It imports no Interval client and no browser.
  const taps = readFileSync(new URL('./taps.mjs', import.meta.url), 'utf8');
  const imports = [...taps.matchAll(/^import .* from '([^']+)';/gm)].map(m => m[1]).sort();
  assert.deepEqual(imports, ['./judge.mjs', './redweek.mjs', 'node:fs', 'node:module'], 'taps.mjs imports no Interval client, no browser');
});

// ---------------------------------------------------------------- RedWeek says no
const fixture = readFileSync(new URL('./fixtures-redweek-surfclub.html', import.meta.url), 'utf8');
const answer = (status, body = '', type = 'text/html') => new Response(body, { status, headers: { 'content-type': type } });
/** A RedWeek stub: robots.txt and the resort pages. Counts every request. */
function redweek({ robots = 'User-agent: *\nDisallow: /search\n', page = () => answer(200, fixture), robotsStatus = 200 } = {}) {
  const seen = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    seen.push(u);
    if (!u.startsWith('https://www.redweek.com/')) throw new Error(`test tried to reach the real network: ${u.slice(0, 70)}`);
    if (u.endsWith('/robots.txt')) return answer(robotsStatus, robots, 'text/plain');
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

test('in the end, nothing in this file reached a real host', () => {
  assert.deepEqual(tried, []);
});
