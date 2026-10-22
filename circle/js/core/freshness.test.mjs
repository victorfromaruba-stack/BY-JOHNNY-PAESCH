// The 7-day rule, the 48-hour test and the order of the Stays list.
//
// Victor, 22 Oct 2026, after a screenshot of a Barceló week "owner asking $9 a night", last seen 16 Oct,
// sitting at No. 1: a live row not seen for 7 days is retired; Stays puts what was seen lately above
// what was not and says "seen N days ago" in words; Interval is on top of the rest.
//
//   node --test circle/js/core/freshness.test.mjs
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isStale, isFresh, seenWords, ageDays, boardOrder, retiredToday, seenMs, RETIRE_AFTER_DAYS, FRESH_HOURS, WATCHED_SOURCES } from './freshness.js';
import { Store, emptyState } from './store.js';
import { SupabaseStore } from './supabase-store.js';

const NOW = Date.parse('2026-10-22T18:00:00Z');
const ago = (ms) => new Date(NOW - ms).toISOString();
const H = 3600e3, D = 24 * H;
const row = (source, seenAt, extra = {}) => ({ id: `${source}-${seenAt}`, source, seenAt, postedAt: seenAt, status: 'live', ...extra });

test('the numbers are Victor\'s: 7 days to retirement, 48 hours to be recommended', () => {
  assert.equal(RETIRE_AFTER_DAYS, 7);
  assert.equal(FRESH_HOURS, 48);
  assert.deepEqual([...WATCHED_SOURCES], ['redweek', 'interval', 'vakaymood']);
});

test('a watched row not seen for more than 7 days is stale — and the Barceló $9 week of 16 Oct is', () => {
  assert.equal(isStale(row('redweek', ago(6 * D + 23 * H)), NOW), false);
  assert.equal(isStale(row('redweek', ago(7 * D + 1000)), NOW), true);
  assert.equal(isStale(row('redweek', '2026-10-16T14:00:00Z'), NOW), false, 'seen 16 Oct is six days old on the 22nd: the clock does not have it yet');
  assert.equal(isStale(row('redweek', '2026-10-16T14:00:00Z'), Date.parse('2026-10-23T15:00:00Z')), true, 'and does the next afternoon');
  for (const s of ['interval', 'vakaymood']) assert.equal(isStale(row(s, ago(8 * D)), NOW), true, `${s} gets the same rule from its own last-seen`);
});

test('a rate Victor typed in by hand is not retired by a clock nothing could move', () => {
  for (const s of ['iberostar', 'hotel', 'member', 'airbnb', 'vrbo', 'other']) assert.equal(isStale(row(s, ago(30 * D)), NOW), false, s);
});

test('last seen wins over first posted; a row nobody has re-read falls back to when it was posted; no time at all is neither stale nor fresh', () => {
  assert.equal(isStale({ source: 'redweek', seenAt: ago(1 * H), postedAt: ago(30 * D) }, NOW), false, 'posted a month ago but seen an hour ago');
  assert.equal(isStale({ source: 'redweek', seenAt: null, postedAt: ago(9 * D) }, NOW), true);
  assert.equal(seenMs({ seen_at: ago(1 * H) }) != null, true, 'the database\'s own column names are read too');
  assert.equal(isStale({ source: 'redweek' }, NOW), false);
  assert.equal(isFresh({ source: 'redweek' }, NOW), false);
});

test('fresh is the last 48 hours, no longer', () => {
  assert.equal(isFresh(row('redweek', ago(47 * H)), NOW), true);
  assert.equal(isFresh(row('redweek', ago(49 * H)), NOW), false);
});

test('"seen N days ago", in plain words and never a verdict', () => {
  assert.equal(seenWords(row('redweek', ago(30e3)), NOW), 'seen just now');
  assert.equal(seenWords(row('redweek', ago(12 * 60e3)), NOW), 'seen 12 min ago');
  assert.equal(seenWords(row('redweek', ago(1 * H)), NOW), 'seen 1 hour ago');
  assert.equal(seenWords(row('redweek', ago(5 * H)), NOW), 'seen 5 hours ago');
  assert.equal(seenWords(row('redweek', ago(1 * D + H)), NOW), 'seen 1 day ago');
  assert.equal(seenWords(row('redweek', ago(6 * D + 2 * H)), NOW), 'seen 6 days ago');
  assert.equal(seenWords({}, NOW), '');
  assert.equal(ageDays(row('redweek', ago(6 * D + 2 * H)), NOW), 6);
  for (const t of [30e3, 5 * H, 3 * D]) assert.doesNotMatch(seenWords(row('redweek', ago(t)), NOW), /newest|latest|available|confirmed|sold out|verified/i);
});

test('the Stays order: seen lately above not, Interval above the rest, cheapest a night within each — and a $9 old week is never No. 1', () => {
  const nightly = (d) => d.n;
  const rows = [
    row('redweek', ago(2 * H), { id: 'rw-cheap-fresh', n: 120 }),
    row('interval', ago(20 * H), { id: 'iv-dear-fresh', n: 330 }),
    row('interval', ago(5 * H), { id: 'iv-cheap-fresh', n: 250 }),
    row('vakaymood', ago(1 * H), { id: 'vm-fresh', n: 140 }),
    row('redweek', ago(6 * D), { id: 'rw-nine-dollars-old', n: 9 }),
    row('interval', ago(4 * D), { id: 'iv-old', n: 90 }),
  ];
  const order = rows.slice().sort(boardOrder(nightly, NOW)).map((d) => d.id);
  assert.deepEqual(order, ['iv-cheap-fresh', 'iv-dear-fresh', 'rw-cheap-fresh', 'vm-fresh', 'iv-old', 'rw-nine-dollars-old']);
  assert.notEqual(order[0], 'rw-nine-dollars-old');
});

test('ties settle on the row seen most recently, so the list does not shuffle between loads', () => {
  const nightly = () => 200;
  const a = row('redweek', ago(5 * H), { id: 'a' }), b = row('redweek', ago(1 * H), { id: 'b' });
  assert.deepEqual([a, b].sort(boardOrder(nightly, NOW)).map((d) => d.id), ['b', 'a']);
  assert.deepEqual([b, a].sort(boardOrder(nightly, NOW)).map((d) => d.id), ['b', 'a']);
});

test('weeks retired today are counted from the deals a phone already holds', () => {
  const day = new Date('2026-10-22T15:00:00');
  const deals = [
    { status: 'gone', retiredAt: '2026-10-22T09:00:00' }, { status: 'gone', retiredAt: '2026-10-22T11:30:00' },
    { status: 'gone', retiredAt: '2026-10-21T23:00:00' }, { status: 'live', retiredAt: null }, { status: 'booked', retiredAt: '2026-10-22T10:00:00' },
  ];
  assert.equal(retiredToday(deals, day), 2);
  assert.equal(retiredToday(undefined, day), 0);
});

test('the store stops showing a stale watched row even if the watcher is down — and keeps everything else', () => {
  const store = new Store();
  store.state = emptyState();
  const now = Date.now();
  store.state.deals = [
    { id: 'old', source: 'redweek', status: 'live', seenAt: new Date(now - 9 * D).toISOString(), postedAt: new Date(now - 9 * D).toISOString() },
    { id: 'new', source: 'redweek', status: 'live', seenAt: new Date(now - 1 * H).toISOString(), postedAt: new Date(now - 9 * D).toISOString() },
    { id: 'hand', source: 'iberostar', status: 'live', seenAt: null, postedAt: new Date(now - 30 * D).toISOString() },
  ];
  assert.deepEqual(store.liveDeals().map((d) => d.id).sort(), ['hand', 'new']);
});

// ---------------------------------------------------------------- the Stays list taps the watcher
const stubClient = (extra = {}) => ({
  from: () => ({ select: () => ({ then: (r) => Promise.resolve({ data: [], error: null }).then(r), eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
  storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: null } }) }) },
  auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange() {} },
  ...extra,
});

test('opening Stays taps the whole board once a minute from a phone, invisibly', async () => {
  const calls = [];
  const store = new SupabaseStore({ client: stubClient({ rpc: (fn, args) => { calls.push([fn, args]); return Promise.resolve({ data: null, error: null }); } }) });
  store.noteBoardLook(); store.noteBoardLook(); store.noteBoardLook();
  assert.deepEqual(calls, [['record_board_tap', undefined]]);
  for (const rpc of [() => Promise.resolve({ error: { code: 'PGRST202' } }), () => Promise.reject(new Error('offline')), () => { throw new Error('boom'); }]) {
    assert.doesNotThrow(() => new SupabaseStore({ client: stubClient({ rpc }) }).noteBoardLook());
  }
  await new Promise((r) => setTimeout(r, 5));
});

test('the line at the top of Stays: when the board was last re-checked, from the watcher\'s own row, or nothing', async () => {
  const at = '2026-10-22T18:00:00+00:00';
  const withRow = (res) => stubClient({ from: (t) => (t === 'board_checks'
    ? { select: () => ({ eq: () => ({ maybeSingle: async () => (res instanceof Error ? Promise.reject(res) : res) }) }) }
    : stubClient().from(t)) });
  const store = new SupabaseStore({ client: withRow({ data: { checked_at: at, verified: 41, repriced: 3, retired: 2 }, error: null }) });
  store.state.deals = [{ status: 'gone', retiredAt: new Date().toISOString() }];
  assert.deepEqual(await store.boardStatus(), { at, verified: 41, repriced: 3, retired: 2, retiredToday: 1 });
  assert.equal(await new SupabaseStore({ client: withRow({ data: null, error: null }) }).boardStatus(), null);
  assert.equal(await new SupabaseStore({ client: withRow({ data: null, error: { code: '42P01', message: 'relation does not exist' } }) }).boardStatus(), null, 'the migration not being applied is no line, not an error');
  assert.equal(await new SupabaseStore({ client: withRow(new Error('offline')) }).boardStatus(), null);
  assert.equal(await new Store().boardStatus(), null, 'the preview has no watcher');
});

test('the migration says what Victor decided: seven days, and the reason a member is shown', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/20261022_board_freshness.sql', import.meta.url), 'utf8');
  assert.match(sql, /'not seen for ' \|\| p_days \|\| ' days'/);
  assert.match(sql, /p_days int default 7/);
  assert.match(sql, /source in \('redweek', 'interval', 'vakaymood'\)/);
  assert.match(sql, /status = 'live'/);
  for (const fn of ['retire_deals_gone', 'retire_stale_deals', 'reprice_deal', 'mark_board_checked']) {
    const body = sql.slice(sql.indexOf(`function ${fn}`));
    assert.ok(body.slice(0, 600).includes('current_is_bot()'), `${fn} is the watcher's alone`);
    assert.match(sql, new RegExp(`revoke all on function ${fn}`), `${fn} is revoked from the public`);
  }
  const schema = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8');
  assert.ok(schema.includes(sql.slice(sql.indexOf('create or replace function retire_stale_deals'))), 'schema.sql carries the same text');
});
