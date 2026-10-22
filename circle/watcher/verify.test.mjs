// Re-checking the board: every live week against where it lives, on stand-ins only.
//
// Victor, 22 Oct 2026: a Barceló week "owner asking $9 a night", last seen 16 Oct, was at No. 1 on Stays.
// A live row the watcher has not seen again for 7 days retires itself; the watcher re-checks EVERY live
// RedWeek row, not only the few it posts; and opening the Stays list is a tap that makes it do so, at most
// once per 15 minutes.
//
// RedWeek here is the saved Surf Club page (fixtures-redweek-surfclub.html) parsed by the real parser;
// Supabase is a local stub behind the real Circle class; fetch() refuses every host but 127.0.0.1 so a
// test that forgot to stub something fails instead of reaching RedWeek, Interval or ntfy.
//
//   node --test verify.test.mjs

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { planVerify, rowUsdNightly, arubaDay } from './verify.mjs';
import { verifyBoard } from './board.mjs';
import { parseRentals } from './redweek.mjs';
import { Circle } from './circle.mjs';
import { handleTaps, decideBoard, noteBoard, emptyState, CAPS } from './taps.mjs';
import { worthPosting, asDeal } from './judge.mjs';

const realFetch = globalThis.fetch;
const tried = [];
before(() => {
  globalThis.fetch = (url, opts) => {
    const u = String(url);
    if (!u.startsWith('http://127.0.0.1:')) { tried.push(u); throw new Error(`test tried to reach the real network: ${u.slice(0, 70)}`); }
    return realFetch(url, opts);
  };
});
after(() => { globalThis.fetch = realFetch; });

const T0 = Date.parse('2026-10-22T18:00:00Z');                 // 14:00 in Aruba
const min = (n) => n * 60e3;
const SLUG = 'P4872-marriotts-aruba-surf-club';
const SURF = { id: 'stay-surf', name: 'Marriott’s Aruba Surf Club', kind: 'aruba', rate_low_usd: 135, rate_high_usd: 310, rate_peak_usd: 580, retail_usd: 850, min_nights: 7 };
const BARCELO = { id: 'stay-barcelo', name: 'Barceló Aruba', kind: 'aruba', rate_low_usd: 480, rate_high_usd: 660, rate_peak_usd: 759, retail_usd: 700, min_nights: 3 };
const catalog = new Map([SURF, BARCELO].map((s) => [s.id, s]));
const settings = { pointsPerDollar: 100, serviceRate: 0.15 };
const CFG = { onlyOurStays: true, mustBeatOurs: true, beatBy: 0.15, maxPerResortMonth: 3, pointsPerUsd: 100, maxPlausibleNightly: 1500 };

const listings = parseRentals(readFileSync(new URL('./fixtures-redweek-surfclub.html', import.meta.url), 'utf8'), { slug: SLUG, ourName: SURF.name });
const byId = Object.fromEntries(listings.map((l) => [l.externalId, l]));
const points = (id) => Math.round(byId[id].usdTotal * 100 * 1.15);
const dealOf = (l, stayId) => { const f = { ...l, stayId }; worthPosting(f, catalog, CFG); return asDeal(f, CFG, settings); };
const slugOf = (stayId) => (stayId === 'stay-surf' ? SLUG : null);

/** A live row as the board holds it. */
const live = (ref, over = {}) => ({ id: `id-${ref}`, source: 'redweek', source_ref: `redweek:${ref}`, stay_id: 'stay-surf', nights: 7, points_total: 0, title: 'x', ...over });
const surfRows = () => [
  live('R1503417', { points_total: points('R1503417') }),                      // still listed, same price
  live('R1493294', { points_total: points('R1493294') }),                      // still listed, same price
  live('R1499724', { points_total: 100000 }),                                  // still listed, price moved
  live('R1514382', { points_total: points('R1514382') }),                      // rented
  live('R7777777', { points_total: 150000 }),                                  // no longer on the page
];
const ok = (ls = listings) => new Map([[SLUG, { ok: true, listings: ls }]]);

// ================================================================ the plan, as a pure decision
test('still listed: the clock moves, an unchanged price stays; a changed price is repriced with the title that carries it', () => {
  const p = planVerify({ rows: surfRows(), redweek: ok(), slugOf, dealOf, settings, now: T0, cfg: CFG });
  assert.deepEqual(p.seen.sort(), ['redweek:R1493294', 'redweek:R1499724', 'redweek:R1503417']);
  assert.equal(p.reprice.length, 1);
  assert.equal(p.reprice[0].ref, 'redweek:R1499724');
  assert.equal(p.reprice[0].was, 100000);
  assert.equal(p.reprice[0].points, points('R1499724'));
  assert.match(p.reprice[0].title, /owner asking \$271 a night on RedWeek/, 'the asking price in the title moved with the price');
});

test('rented, and no longer listed: retired with the day and the source', () => {
  const p = planVerify({ rows: surfRows(), redweek: ok(), slugOf, dealOf, settings, now: T0, cfg: CFG });
  const by = Object.fromEntries(p.retire.map((x) => [x.ref, x]));
  assert.equal(by['redweek:R1514382'].why, 'gone from RedWeek on 22 Oct');
  assert.equal(by['redweek:R1514382'].kind, 'rented');
  assert.equal(by['redweek:R7777777'].why, 'gone from RedWeek on 22 Oct');
  assert.equal(by['redweek:R7777777'].kind, 'absent');
  assert.equal(p.retire.length, 2);
  assert.deepEqual(p.counts, { verified: 5, repriced: 1, retired: 2 });
  assert.equal(arubaDay(Date.parse('2026-12-01T02:00:00Z')), '30 Nov', 'the day is Aruba\'s, not UTC\'s');
});

test('a resort that did not answer teaches nothing: no clock moves and nothing retires', () => {
  const p = planVerify({ rows: surfRows(), redweek: new Map([[SLUG, { ok: false, listings: [] }]]), slugOf, dealOf, settings, now: T0, cfg: CFG });
  assert.deepEqual([p.seen, p.reprice, p.retire], [[], [], []]);
  const none = planVerify({ rows: surfRows(), redweek: new Map(), slugOf, dealOf, settings, now: T0, cfg: CFG });
  assert.deepEqual(none.counts, { verified: 0, repriced: 0, retired: 0 });
});

test('a page that came back empty, or lost most of the resort at once, is not proof that the weeks are gone', () => {
  const empty = planVerify({ rows: surfRows(), redweek: ok([]), slugOf, dealOf, settings, now: T0, cfg: CFG });
  assert.equal(empty.retire.length, 0, 'an empty page retires nothing');
  const few = listings.filter((l) => l.externalId === 'R1503417');          // 4 of 5 rows missing
  const lost = planVerify({ rows: surfRows(), redweek: ok(few), slugOf, dealOf, settings, now: T0, cfg: CFG });
  assert.equal(lost.retire.filter((x) => x.kind === 'absent').length, 0, 'more than half missing at once: none are taken down on absence');
  const rented = planVerify({ rows: surfRows(), redweek: ok(), slugOf, dealOf, settings, now: T0, cfg: CFG }).retire.filter((x) => x.kind === 'rented');
  assert.equal(rented.length, 1, 'but a week the page itself marks rented is always taken down');
});

test('THE $9 WEEK: a live row whose price a night cannot be true is retired whatever its age, source or resort', () => {
  const nine = { id: 'b', source: 'redweek', source_ref: 'redweek:R1', stay_id: 'stay-barcelo', nights: 7, points_total: Math.round(9 * 7 * 100 * 1.15) };
  const dear = { id: 'c', source: 'interval', source_ref: 'interval:s:2026-11-01:2026-11-08', stay_id: 'stay-surf', nights: 7, points_total: Math.round(63346 * 100 * 1.15) };
  const real = { id: 'd', source: 'interval', source_ref: 'interval:s:2026-11-08:2026-11-15', stay_id: 'stay-surf', nights: 7, points_total: Math.round(1740.51 * 100 * 1.15) };
  const hand = { id: 'e', source: 'iberostar', source_ref: 'hand:1', stay_id: 'stay-surf', nights: 7, points_total: Math.round(20 * 7 * 100 * 1.15) };
  const vm = { id: 'f', source: 'vakaymood', source_ref: 'vakaymood:55', stay_id: 'stay-surf', nights: 7, points_total: Math.round(4 * 7 * 100 * 1.15) };
  const p = planVerify({ rows: [nine, dear, real, hand, vm], redweek: new Map(), slugOf, dealOf, settings, now: T0, cfg: CFG });
  assert.deepEqual(p.retire.map((x) => x.ref).sort(), ['interval:s:2026-11-01:2026-11-08', 'redweek:R1', 'vakaymood:55']);
  assert.match(p.retire.find((x) => x.ref === 'redweek:R1').why, /price not credible: \$9 a night/);
  assert.equal(Math.round(rowUsdNightly(nine, settings)), 9, 'points convert back to dollars with the Circle\'s own two numbers');
});

test('a listing whose NEW price is impossible is not repriced up to a nonsense figure: the week is taken down', () => {
  const nonsense = listings.map((l) => (l.externalId === 'R1493294' ? { ...l, usdTotal: 63, usdNightly: 9, nights: 7 } : l));
  const p = planVerify({ rows: surfRows(), redweek: ok(nonsense), slugOf, dealOf, settings, now: T0, cfg: CFG });
  assert.equal(p.retire.find((x) => x.ref === 'redweek:R1493294').kind, 'price');
  assert.ok(!p.reprice.some((x) => x.ref === 'redweek:R1493294'));
  assert.ok(!p.seen.includes('redweek:R1493294'));
});

// ================================================================ acting on it, against a stand-in Supabase
async function startSupabase({ rows, migration = true }) {
  const S = { rpc: [], patched: [], tokens: 0 };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const json = (o, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const p = u.pathname;
      if (p === '/auth/v1/token') return json({ access_token: 'tok' });
      if (p === '/rest/v1/settings') return json([{ points_per_dollar: 100, service_rate: 0.15 }]);
      if (p === '/rest/v1/deals' && req.method === 'GET') return json(rows);
      if (p === '/rest/v1/deals' && req.method === 'PATCH') {
        const refs = JSON.parse(`[${/^in\.\((.*)\)$/.exec(u.searchParams.get('source_ref'))[1]}]`);
        S.patched.push(...refs);
        return json(refs.map((source_ref) => ({ source_ref })));
      }
      if (p.startsWith('/rest/v1/rpc/')) {
        const fn = p.split('/').pop(); const args = JSON.parse(body || '{}');
        if (!migration && fn !== 'x') return json({ code: 'PGRST202', message: `Could not find the function public.${fn}` }, 404);
        S.rpc.push([fn, args]);
        if (fn === 'retire_deals_gone') return json(args.p_refs.length);
        if (fn === 'retire_stale_deals') return json(2);
        if (fn === 'reprice_deal') return json(1);
        return json(null);
      }
      res.writeHead(404); res.end('{}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { S, url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}
const circleFor = (sb) => new Circle({ url: sb.url, key: 'k', username: 'watcher', password: 'p' });
const verify = (circle, extra = {}) => verifyBoard({ circle, catalog, listings, okSlugs: [SLUG], full: true, apply: true, cfg: CFG, log: () => {}, slugOf, ...extra });

test('a full re-check: clocks moved on every week still listed, the changed price sent, rented and gone weeks taken down with their reason, seven days applied, the check recorded', async () => {
  const sb = await startSupabase({ rows: surfRows() });
  try {
    const lines = [];
    const out = await verify(circleFor(sb), { log: (l) => lines.push(l) });
    assert.deepEqual(out, { verified: 5, repriced: 1, retired: 4, applied: true }, 'retired = 2 gone + 2 not seen for 7 days (the stub says two)');
    assert.deepEqual(sb.S.patched.sort(), ['redweek:R1493294', 'redweek:R1499724', 'redweek:R1503417'], 'EVERY live row still listed, not only the cheapest few');
    const call = (fn) => sb.S.rpc.filter(([f]) => f === fn);
    assert.deepEqual(call('reprice_deal')[0][1].p_ref, 'redweek:R1499724');
    assert.equal(call('reprice_deal')[0][1].p_points, points('R1499724'));
    assert.deepEqual(call('retire_deals_gone').map(([, a]) => [a.p_refs.sort(), a.p_reason]), [[['redweek:R1514382', 'redweek:R7777777'], 'gone from RedWeek on 22 Oct']]);
    assert.deepEqual(call('retire_stale_deals')[0][1], { p_days: 7 });
    assert.deepEqual(call('mark_board_checked')[0][1], { p_verified: 5, p_repriced: 1, p_retired: 4 });
    assert.ok(lines.some((l) => /5 checked against their source \(3 still listed\), 1 repriced, 2 to take down/.test(l)), lines.join('\n'));
  } finally { sb.close(); }
});

test('a re-check of ONE resort (a tap on one stay) does not stamp the whole board as checked', async () => {
  const sb = await startSupabase({ rows: surfRows() });
  try {
    await verify(circleFor(sb), { full: false });
    assert.equal(sb.S.rpc.filter(([f]) => f === 'mark_board_checked').length, 0);
    assert.ok(sb.S.rpc.some(([f]) => f === 'retire_stale_deals'), 'the seven-day rule still runs');
  } finally { sb.close(); }
});

test('a dry run says what it would do and changes nothing — not a clock, not a price, not a row', async () => {
  const sb = await startSupabase({ rows: surfRows() });
  try {
    const lines = [];
    const out = await verify(circleFor(sb), { apply: false, log: (l) => lines.push(l) });
    assert.equal(out.applied, false);
    assert.deepEqual(sb.S.patched, []);
    assert.deepEqual(sb.S.rpc, []);
    assert.ok(lines.some((l) => /take down redweek:R1514382 — gone from RedWeek on 22 Oct/.test(l)));
    assert.ok(lines.some((l) => /reprice redweek:R1499724: 100000 -> /.test(l)));
    assert.ok(lines.some((l) => /dry run — nothing changed/.test(l)));
  } finally { sb.close(); }
});

test('before the migration is applied the re-check says so, once, and does no damage', async () => {
  const sb = await startSupabase({ rows: surfRows(), migration: false });
  try {
    const said = [];
    const out = await verify(circleFor(sb), { warn: (k, t) => said.push([k, t]) });
    assert.equal(out.applied, false);
    assert.deepEqual([out.repriced, out.retired], [0, 0]);
    assert.equal(said.length, 1);
    assert.match(said[0][1], /20261022_board_freshness\.sql/);
  } finally { sb.close(); }
});

// ================================================================ the Stays list is a tap on the whole board
function world({ quiet = false } = {}) {
  const sent = [];
  const pusher = { quiet: () => quiet, send: async (m) => { sent.push(m); return { ok: true }; } };
  const calls = { verify: 0, aruba: 0, last: [] };
  const lines = [];
  const state = emptyState();
  const deps = {
    log: (l) => lines.push(l), pusher,
    verifyBoard: async () => { calls.verify++; return { verified: 41, repriced: 3, retired: 2 }; },
    scanAruba: async () => { calls.aruba++; return { ran: false, covered: false, why: 'the Interval scan is switched off' }; },
    intervalLastSeen: async (id) => { calls.last.push(id); return { seenAt: new Date(T0 - 40 * 24 * 3600e3).toISOString() }; },
    sweepResort: async () => ({}),
  };
  return { sent, calls, lines, state, deps };
}
const listTap = (at) => ({ stay: null, tapped: new Date(at).toISOString() });

test('opening Stays re-checks the whole board, once; ten phones in a minute are one tap', async () => {
  const w = world();
  const taps = Array.from({ length: 10 }, (_, i) => listTap(T0 - i * 1000));
  const rows = await handleTaps({ taps, catalog, state: w.state, deps: w.deps, now: () => T0 });
  assert.equal(rows.length, 1);
  assert.equal(w.calls.verify, 1);
  assert.deepEqual(rows[0].board.result, { verified: 41, repriced: 3, retired: 2 });
  assert.ok(w.lines.some((l) => /Board: re-checked — 41 weeks verified, 3 repriced, 2 retired/.test(l)));
  assert.ok(w.lines.some((l) => /opened by a member at .*the Stays list|the Stays list — opened by a member/.test(l)));
});

test('at most one full re-check per 15 minutes, whoever taps; the half-hourly pass counts as one', async () => {
  const st = emptyState();
  assert.equal(CAPS.boardGapMin, 15);
  assert.equal(decideBoard(st, T0).go, true);
  noteBoard(st, T0);
  const d = decideBoard(st, T0 + min(14));
  assert.equal(d.go, false);
  assert.match(d.why, /the whole board was checked 14 min ago — that check is the answer/);
  assert.equal(decideBoard(st, T0 + min(15)).go, true);

  const w = world();
  await handleTaps({ taps: [listTap(T0)], catalog, state: w.state, deps: w.deps, now: () => T0 });
  const again = await handleTaps({ taps: [listTap(T0 + min(5))], catalog, state: w.state, deps: w.deps, now: () => T0 + min(5) });
  assert.equal(w.calls.verify, 1, 'the second list, five minutes later, is served by the first check');
  assert.ok(w.lines.some((l) => /Board: not re-checking — the whole board was checked 5 min ago/.test(l)));
  assert.equal(again[0].board.go, false);
  await handleTaps({ taps: [listTap(T0 + min(16))], catalog, state: w.state, deps: w.deps, now: () => T0 + min(16) });
  assert.equal(w.calls.verify, 2, 'sixteen minutes on, it is asked again');
});

test('a re-check that fails is said, not remembered as done, and does not stop the Interval part', async () => {
  const w = world();
  w.deps.verifyBoard = async () => { throw new Error('RedWeek answered 500'); };
  const rows = await handleTaps({ taps: [listTap(T0)], catalog, state: w.state, deps: w.deps, now: () => T0 });
  assert.equal(w.state.board, null, 'a failed check does not count as one');
  assert.match(rows[0].board.error, /500/);
  assert.equal(w.calls.aruba, 1);
});

test('the Stays list gets the Grab nudge as its fallback: once, naming the list, never a member', async () => {
  const w = world();
  await handleTaps({ taps: [listTap(T0)], catalog, state: w.state, deps: w.deps, now: () => T0 });
  assert.equal(w.sent.length, 1);
  assert.equal(w.sent[0].title, 'A member is looking at the Stays list');
  assert.match(w.sent[0].body, /Interval last grabbed 40 days ago/);
  assert.deepEqual(w.calls.last, [null], 'asked about the whole board, not one place');
  await handleTaps({ taps: [listTap(T0 + min(20))], catalog, state: w.state, deps: w.deps, now: () => T0 + min(20) });
  assert.equal(w.sent.length, 1, 'not again within 12 hours');
});

test('a scan of Aruba that worked replaces the nudge for the list too', async () => {
  const w = world();
  w.deps.scanAruba = async () => ({ ran: true, covered: true, rows: 15, posted: 4, refreshed: 0 });
  await handleTaps({ taps: [listTap(T0)], catalog, state: w.state, deps: w.deps, now: () => T0 });
  assert.equal(w.sent.length, 0);
  assert.ok(w.lines.some((l) => /Interval: scanned — 15 weeks read, 4 new on the board/.test(l)));
});

test('a tap on one stay and a tap on the list in the same poll are two different things', async () => {
  const w = world();
  const rows = await handleTaps({ taps: [{ stay: 'stay-surf', tapped: new Date(T0).toISOString() }, listTap(T0)], catalog, state: w.state, deps: w.deps, now: () => T0 });
  assert.deepEqual(rows.map((r) => r.stay), ['Marriott’s Aruba Surf Club', null]);
});

test('in the end, nothing in this file reached a real host', () => {
  assert.deepEqual(tried, []);
});
