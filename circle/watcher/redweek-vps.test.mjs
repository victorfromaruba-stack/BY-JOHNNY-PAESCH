// RedWeek read from the VPS's copy, against a directory of runs made by hand.
//
// What is on trial: the pages parse with the same parseRentals as a direct read; each week's seen_at is the page's
// own fetchedAt from the manifest (never the time of the pull); a copy over two hours old is refused; RedWeek's no
// (a stop the VPS wrote) stops here too; and a direct read is the fallback only when nothing forbids it. fetch is
// made to throw first thing, so nothing here can reach redweek.com or anywhere else.
//
//   node --test circle/watcher/redweek-vps.test.mjs

import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  parseRentals, ARUBA, sweep, sweepVps, readVpsRun, pullFromVps, VpsMissing, RedWeekStop, VPS_MAX_AGE_MS,
  useStopFile, stopped, useBackoffFile, backoff, clearBackoff,
} from './redweek.mjs';
import { OUR_SLUGS } from './vps/rules.mjs';
import { refreshSeen, verifyBoard } from './board.mjs';
import { Circle } from './circle.mjs';
import { worthPosting, asDeal } from './judge.mjs';

const realFetch = globalThis.fetch;
const tried = [];
before(() => { globalThis.fetch = (url) => { tried.push(String(url)); throw new Error(`test tried to reach the real network: ${String(url).slice(0, 70)}`); }; });
after(() => { globalThis.fetch = realFetch; });
afterEach(() => { useStopFile(null); useBackoffFile(null); clearBackoff(); });

const HTML = readFileSync(new URL('./fixtures-redweek-surfclub.html', import.meta.url));
const T0 = Date.parse('2026-10-23T09:50:00Z');          // 05:50 in Aruba: the VPS's morning run
const stamp = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');
const iso = (ms) => new Date(ms).toISOString();
const sha = (b) => createHash('sha256').update(b).digest('hex');

/** A run directory as the VPS leaves it. `edit(manifest, dir)` lets a test spoil something afterwards. */
function makeRun(root, { at = T0, slugs = OUR_SLUGS, stop = null, html = HTML, edit = () => {} } = {}) {
  const dir = join(root, stamp(at));
  mkdirSync(dir, { recursive: true });
  const pages = slugs.map((slug, i) => {
    writeFileSync(join(dir, `${slug}.html`), html);
    return { slug, file: `${slug}.html`, url: `https://www.redweek.com/resort/${slug}/timeshare-rentals`, fetchedAt: iso(at + 3000 + i * 10000), status: 200, bytes: html.length, sha256: sha(html) };
  });
  const man = { runAt: iso(at), finishedAt: iso(at + 60000), slugs: [...slugs], robots: null, pages, stop, complete: !stop };
  edit(man, dir);
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(man));
  return { dir, man };
}
const fresh = () => mkdtempSync(join(tmpdir(), 'rw-vps-'));
const collect = () => { const seen = []; return { seen, onResort: (slug, n, err, info) => seen.push({ slug, n, err, info }) }; };

test('the pages parse as a direct read would, and each week is seen when the VPS fetched its page', async () => {
  const root = fresh();
  const { man } = makeRun(root);
  const c = collect();
  const found = await sweepVps(OUR_SLUGS, { dir: root, now: T0 + 10 * 60e3, includeTaken: true, onResort: c.onResort });

  assert.equal(found.length, OUR_SLUGS.length * 9);
  const direct = parseRentals(HTML.toString('utf8'), { slug: OUR_SLUGS[0], ourName: ARUBA[OUR_SLUGS[0]] });
  const mine = found.filter((f) => f.slug === OUR_SLUGS[0]);
  assert.deepEqual(mine.map(({ seenAt, via, seenNote, ...rest }) => rest), direct, 'same weeks, same prices, same ids as parseRentals');
  for (const f of found) {
    const page = man.pages.find((p) => p.slug === f.slug);
    assert.equal(f.seenAt, page.fetchedAt, 'seen_at is the page\'s own fetchedAt, not the time of the pull');
    assert.equal(f.via, 'vps');
    assert.match(f.seenNote, /^Read off RedWeek's own page via the VPS at 23\/10 05:5\d Aruba time$/);
    assert.equal(f.ourName, ARUBA[f.slug]);
  }
  assert.deepEqual(c.seen.map((s) => [s.slug, s.n, s.err]), OUR_SLUGS.map((s) => [s, 8, null]), 'eight open, one rented, per resort');
  assert.deepEqual(c.seen[1].info, { fetchedAt: man.pages[1].fetchedAt, via: 'vps' });
  assert.equal((await sweepVps(OUR_SLUGS, { dir: root, now: T0 + 60e3 })).some((f) => f.taken), false, 'rented weeks only come when asked for');
});

test('a copy more than two hours old is refused, and says so; at two hours it is still good', async () => {
  const root = fresh();
  makeRun(root);
  assert.throws(() => readVpsRun(root, OUR_SLUGS, { now: T0 + VPS_MAX_AGE_MS + 1000 }), (e) => e instanceof VpsMissing && /over 2 hours old/.test(e.message) && /2026-10-23T09:50:00/.test(e.message));
  assert.equal(readVpsRun(root, OUR_SLUGS, { now: T0 + VPS_MAX_AGE_MS }).results.length, OUR_SLUGS.length);
});

test('a stale copy with no back-off holding is the one case a direct read is allowed (sweepVps says so with null)', async () => {
  const root = fresh();
  makeRun(root);
  const logs = [];
  const c = collect();
  assert.equal(await sweepVps(OUR_SLUGS, { dir: root, now: T0 + 3 * 3600e3, onResort: c.onResort, log: (l) => logs.push(l) }), null);
  assert.deepEqual(c.seen, [], 'it reported nothing: the direct read will');
  assert.match(logs[0], /over 2 hours old.*reading it directly/);
});

test('a stale or missing copy while the back-off holds: nothing is read, and not directly either', async () => {
  const root = fresh();
  makeRun(root);
  const file = join(root, 'backoff.json');
  useBackoffFile(file);
  const until = iso(T0 + 11 * 3600e3);          // the sweeps below are asked at T0 + 5 h
  writeFileSync(file, JSON.stringify({ at: iso(T0 - 3600e3), until, why: 'connection timed out on P4872' }));
  for (const dir of [root, join(root, 'nothing-here')]) {
    const c = collect();
    const got = await sweepVps(OUR_SLUGS, { dir, now: T0 + 5 * 3600e3, onResort: c.onResort });
    assert.deepEqual(got, []);
    assert.equal(c.seen.length, 1);
    assert.ok(c.seen[0].err instanceof VpsMissing);
    assert.equal(c.seen[0].err.held, true);
    assert.equal(c.seen[0].err.until, until);
  }
  // and the sweep itself never reaches for RedWeek in that state
  const c = collect();
  assert.deepEqual(await sweep(OUR_SLUGS, { source: 'vps', vps: { dir: root, now: T0 + 5 * 3600e3 }, onResort: c.onResort }), []);
  assert.deepEqual(tried, []);
});

test('a copy that is fresh and good is used even while the back-off holds: the back-off is about this box\'s own requests', async () => {
  const root = fresh();
  makeRun(root);
  useBackoffFile(join(root, 'backoff.json'));
  writeFileSync(join(root, 'backoff.json'), JSON.stringify({ at: iso(T0 - 3600e3), until: iso(T0 + 86400e3), why: 'timeout' }));
  assert.ok(backoff(T0) && !backoff(T0).expired);
  const found = await sweepVps(OUR_SLUGS, { dir: root, now: T0 + 600e3 });
  assert.equal(found.length, OUR_SLUGS.length * 8);
});

test('the pull failing leaves nothing read, even with a good copy on disk from earlier', async () => {
  const root = fresh();
  makeRun(root);
  const c = collect();
  const got = await sweepVps(OUR_SLUGS, { dir: root, now: T0 + 600e3, pull: async () => { throw new VpsMissing('could not pull from the VPS: Connection timed out'); }, onResort: c.onResort, log: () => {} });
  assert.equal(got, null, 'no back-off holds, so the caller may read directly');
  const held = collect();
  writeFileSync(join(root, 'b.json'), JSON.stringify({ until: iso(T0 + 3 * 3600e3), why: 'x' }));
  useBackoffFile(join(root, 'b.json'));
  assert.deepEqual(await sweepVps(OUR_SLUGS, { dir: root, now: T0 + 600e3, pull: async () => { throw new VpsMissing('could not pull'); }, onResort: held.onResort }), []);
  assert.match(held.seen[0].err.message, /could not pull/);
});

test('the pull is called before the read', async () => {
  const root = fresh();
  const order = [];
  const got = await sweepVps(OUR_SLUGS, { dir: root, now: T0 + 600e3, log: () => {}, pull: async () => { order.push('pull'); makeRun(root); order.push('arrived'); } });
  assert.deepEqual(order, ['pull', 'arrived']);
  assert.equal(got.length, OUR_SLUGS.length * 8, 'what the pull brought is what was read');
});

test('a run the VPS stopped on a 403 or a challenge is RedWeek\'s no: the stop file is written here, and holds', async () => {
  const root = fresh();
  makeRun(root, { stop: { kind: 'stop', slug: OUR_SLUGS[2], status: 403, why: `RedWeek answered 403 for ${OUR_SLUGS[2]}`, at: iso(T0 + 20000) } });
  const file = join(root, 'stop.json');
  useStopFile(file);
  const c = collect();
  assert.deepEqual(await sweepVps(OUR_SLUGS, { dir: root, now: T0 + 600e3, onResort: c.onResort }), []);
  assert.ok(c.seen[0].err instanceof RedWeekStop);
  assert.match(c.seen[0].err.message, /told the VPS to stop.*403/);
  assert.match(JSON.parse(readFileSync(file, 'utf8')).why, /403/);
  // a good, newer run does not lift it — only a person deleting the file does
  makeRun(root, { at: T0 + 3600e3 });
  const again = collect();
  assert.deepEqual(await sweepVps(OUR_SLUGS, { dir: root, now: T0 + 3600e3 + 60e3, onResort: again.onResort }), []);
  assert.match(again.seen[0].err.message, /RedWeek stopped us/);
  assert.ok(stopped());
});

test('a run the VPS ended on a timeout or a 429 reads nothing, and a direct read is not the answer to that', async () => {
  const root = fresh();
  makeRun(root, { stop: { kind: 'backoff', slug: OUR_SLUGS[1], status: 429, why: 'RedWeek is rate-limiting us (429)', at: iso(T0) } });
  const c = collect();
  assert.deepEqual(await sweepVps(OUR_SLUGS, { dir: root, now: T0 + 600e3, onResort: c.onResort }), [], 'nothing read, and null (a direct read) is not offered');
  assert.equal(c.seen[0].err.held, true);
  assert.match(c.seen[0].err.message, /did not answer the VPS.*429/);
  assert.equal(stopped(), null, 'not RedWeek\'s no, so no stop file');
});

test('the newest run decides: an older good one does not stand in for it, and half-written ones are ignored', async () => {
  const root = fresh();
  makeRun(root, { at: T0 - 12 * 3600e3 });
  mkdirSync(join(root, `.tmp-${stamp(T0)}`));
  mkdirSync(join(root, 'lost+found'));
  assert.throws(() => readVpsRun(root, OUR_SLUGS, { now: T0 + 60e3 }), /over 2 hours old/);
  makeRun(root, { at: T0 });
  assert.equal(readVpsRun(root, OUR_SLUGS, { now: T0 + 60e3 }).name, stamp(T0));
  // a newest directory with no manifest is a missing copy, not licence to read the one before it
  mkdirSync(join(root, stamp(T0 + 60e3)));
  assert.throws(() => readVpsRun(root, OUR_SLUGS, { now: T0 + 120e3 }), /no readable manifest/);
});

test('a page that does not match its checksum, is missing, or was refused is not read; its neighbours still are', async () => {
  const root = fresh();
  makeRun(root, {
    edit: (man, dir) => {
      writeFileSync(join(dir, man.pages[0].file), Buffer.concat([HTML, Buffer.from('<!-- tampered -->')]));   // size and sha differ
      man.pages[1].status = 500; man.pages[1].file = null;
      man.pages.splice(2, 1);                                                                                 // no page for resort three
      man.pages[2].file = '../../etc/passwd';                                                                 // only its base name is ever opened
    },
  });
  const c = collect();
  const found = await sweepVps(OUR_SLUGS, { dir: root, now: T0 + 60e3, onResort: c.onResort });
  const bad = c.seen.filter((s) => s.err);
  assert.deepEqual(bad.map((s) => s.slug), [OUR_SLUGS[0], OUR_SLUGS[1], OUR_SLUGS[2], OUR_SLUGS[3]]);
  assert.match(bad[0].err.message, /does not match its checksum/);
  assert.match(bad[1].err.message, /returned 500/);
  assert.match(bad[2].err.message, /has no page for/);
  assert.match(bad[3].err.message, /did not arrive/);
  assert.deepEqual([...new Set(found.map((f) => f.slug))], OUR_SLUGS.slice(4), 'only the resorts that arrived whole');
});

test('a challenge page that got past the VPS is caught here too, and stops everything', async () => {
  const root = fresh();
  const wall = Buffer.from('<html><title>Just a moment...</title>Please verify you are human</html>');
  makeRun(root, { html: wall });
  useStopFile(join(root, 'stop.json'));
  const c = collect();
  assert.deepEqual(await sweepVps(OUR_SLUGS, { dir: root, now: T0 + 60e3, onResort: c.onResort }), []);
  assert.equal(c.seen.length, 1, 'the first one ends it');
  assert.ok(c.seen[0].err instanceof RedWeekStop);
  assert.match(c.seen[0].err.message, /challenge page.*via the VPS/);
  assert.ok(stopped());
});

test('a copy dated in the future is not believed: it would put seen_at ahead of the clock', async () => {
  const root = fresh();
  makeRun(root, { at: T0 + 3 * 3600e3 });
  assert.throws(() => readVpsRun(root, OUR_SLUGS, { now: T0 }), /in the future/);
});

test('sweep() with source "vps" and a missing copy falls through to the direct read, and only then (network is blocked here)', async () => {
  const root = fresh();
  const c = collect();
  tried.length = 0;
  await sweep([OUR_SLUGS[0]], { source: 'vps', vps: { dir: root, now: T0 }, onResort: c.onResort, pauseMs: 0 });
  assert.equal(tried.length, 1, 'the direct path asked for robots.txt — the stub refused');
  assert.match(c.seen[0].err.message, /test tried to reach the real network/);
  tried.length = 0;
});

test('pulling is rsync of the whole out/ directory over ssh as user redweek, read-only key, host key pinned', async () => {
  let call;
  const exec = (cmd, args, opts, cb) => { call = { cmd, args, opts }; cb(null, '', ''); };
  await pullFromVps({ dir: '/x/pulled', host: '100.122.79.25', key: '/root/.ssh/vps_redweek', knownHosts: '/root/.ssh/vps_redweek_known_hosts', exec });
  assert.equal(call.cmd, 'rsync');
  assert.deepEqual(call.args.slice(0, 3), ['-rt', '--delete', '--exclude=.tmp-*']);
  assert.match(call.args[4], /ssh -i \/root\/\.ssh\/vps_redweek -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=\/root\/\.ssh\/vps_redweek_known_hosts/);
  assert.deepEqual(call.args.slice(5), ['redweek@100.122.79.25:/', '/x/pulled/']);
  const failing = (cmd, args, opts, cb) => cb(new Error('Command failed'), '', 'ssh: connect to host 100.122.79.25 port 22: Connection timed out\nrsync error: unexplained error');
  await assert.rejects(() => pullFromVps({ dir: '/x', host: 'h', key: 'k', knownHosts: 'kh', exec: failing }),
    (e) => e instanceof VpsMissing && e.message === 'could not pull from the VPS: ssh: connect to host 100.122.79.25 port 22: Connection timed out');
});

// ---------------------------------------------------------------- what is written to the board
test('refreshSeen writes the time each page was read, and weeks that share a time go in one request', async () => {
  const calls = [];
  const circle = { call: async (path, opts) => { calls.push({ path, body: JSON.parse(opts.body) }); return { ok: true, json: async () => [{ source_ref: 'x' }] }; } };
  const t1 = iso(T0 + 3000), t2 = iso(T0 + 13000);
  const r = await refreshSeen(circle, ['redweek:A', 'redweek:B', 'redweek:C'], (ref) => (ref === 'redweek:C' ? t2 : t1));
  assert.deepEqual(calls.map((c) => c.body), [{ seen_at: t1 }, { seen_at: t2 }]);
  assert.match(decodeURIComponent(calls[0].path), /source_ref=in\.\("redweek:A","redweek:B"\)/);
  assert.deepEqual(r, { asked: 3, moved: 2, said: '' });
  // no times given: now, as it always was
  calls.length = 0;
  await refreshSeen(circle, ['redweek:A']);
  assert.ok(Math.abs(Date.parse(calls[0].body.seen_at) - Date.now()) < 5000);
});

test('re-checking the board with a copy of the page: each week still listed is seen when the VPS fetched it, not when it was pulled', async () => {
  const SLUG = OUR_SLUGS[0];
  const root = fresh();
  const { man } = makeRun(root, { slugs: [SLUG] });
  const found = await sweepVps([SLUG], { dir: root, now: T0 + 600e3, includeTaken: true });
  const stay = { id: 'stay-surf', name: ARUBA[SLUG], kind: 'aruba', rate_low_usd: 135, rate_high_usd: 310, rate_peak_usd: 580, retail_usd: 850, min_nights: 7 };
  const catalog = new Map([[stay.id, stay]]);
  const cfg = { onlyOurStays: true, mustBeatOurs: true, beatBy: 0.15, maxPerResortMonth: 3, pointsPerUsd: 100, maxPlausibleNightly: 1500 };
  const settings = { pointsPerDollar: 100, serviceRate: 0.15 };
  const pts = (id) => { const l = found.find((f) => f.externalId === id); const f = { ...l, stayId: stay.id }; worthPosting(f, catalog, cfg); return asDeal(f, cfg, settings).pointsTotal; };
  // The second week's price has moved on RedWeek (a believable figure either way: the floor and the ceiling still apply), so it is repriced — and reprice_deal stamps seen_at = now() in the database.
  const rows = [['R1503417', pts('R1503417')], ['R1493294', pts('R1493294') + 20000]].map(([id, points_total]) => ({ id, source: 'redweek', source_ref: `redweek:${id}`, stay_id: stay.id, nights: 7, points_total, title: 't' }));
  const patches = [], order = [];
  const circle = {
    settings: async () => settings, liveRows: async () => rows,
    call: async (path, opts) => { order.push('clocks'); patches.push(JSON.parse(opts.body)); return { ok: true, json: async () => rows.map((r) => ({ source_ref: r.source_ref })) }; },
    reprice: async () => { order.push('reprice'); return 1; }, retireGone: async () => 0, retireStale: async () => 0, markBoardChecked: async () => {},
  };
  const out = await verifyBoard({ circle, catalog, listings: found, okSlugs: [SLUG], full: false, apply: true, cfg, log: () => {}, slugOf: (id) => (id === stay.id ? SLUG : null) });
  assert.equal(out.applied, true);
  assert.equal(out.repriced, 1);
  assert.deepEqual(patches, [{ seen_at: man.pages[0].fetchedAt }], 'both weeks, one request, the page\'s own time');
  assert.deepEqual(order, ['reprice', 'clocks'], 'the clocks are set after the repricing, which would otherwise stamp them with now()');
});

test('markChecked tells the database when and from where, and falls back to the old call until 20261026_redweek_via.sql is applied', async () => {
  const calls = [];
  const rpc = (failNew) => async (fn, args) => { calls.push([fn, args]); if (failNew && 'p_at' in args) throw Object.assign(new Error('Could not find the function'), { code: 'PGRST202', status: 404 }); return null; };
  const at = iso(T0 + 3000);
  await Circle.prototype.markChecked.call({ rpc: rpc(false) }, 'stay-1', { at, via: 'vps' });
  assert.deepEqual(calls, [['mark_redweek_checked', { p_stay: 'stay-1', p_at: at, p_via: 'vps' }]]);
  calls.length = 0;
  await Circle.prototype.markChecked.call({ rpc: rpc(true) }, 'stay-1', { at, via: 'vps' });
  assert.deepEqual(calls.map((c) => Object.keys(c[1])), [['p_stay', 'p_at', 'p_via'], ['p_stay']], 'asked the new way, then the old way');
  calls.length = 0;
  await Circle.prototype.markChecked.call({ rpc: rpc(true) }, 'stay-1');
  assert.deepEqual(calls, [['mark_redweek_checked', { p_stay: 'stay-1' }]], 'a direct read sends what it always sent');
  await assert.rejects(() => Circle.prototype.markChecked.call({ rpc: async () => { throw Object.assign(new Error('no'), { status: 500 }); } }, 's', { via: 'vps' }), /no/);
});

test('in the end, nothing in this file reached a real host', () => {
  assert.deepEqual(tried, []);
});
