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
import { isStale, isFresh, seenWords, ageDays, boardOrder, retiredToday, seenMs, RETIRE_AFTER_DAYS, FRESH_HOURS, WATCHED_SOURCES, setOutages, outages, pausedMs, atWords, sinceWords, redweekWords } from './freshness.js';
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
  assert.deepEqual(await store.boardStatus(), { at, verified: 41, repriced: 3, retired: 2, retiredToday: 1, redweekAt: null, redweekVia: null, outage: null });
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

// ---------------------------------------------------------------- a source being out stops its clock
// RedWeek stopped answering this server on 22 Oct 2026; Victor decided to wait. Seven days of a source being
// unreachable must not empty the board, and nothing that is shown may lie about when a row was last seen.
test('while RedWeek is out, its rows\' seven days do not run — the Barceló row seen 16 Oct is still on the 25th, and stale on the 29th', () => {
  const seen = '2026-10-16T14:00:00Z';
  const out = [{ source: 'redweek', since: '2026-10-17T00:00:00Z', until: null }];            // still out
  const row = row0('redweek', seen);
  assert.equal(isStale(row, Date.parse('2026-10-25T15:00:00Z'), 7, []), true, 'with no outage known it would have gone on the 24th');
  assert.equal(isStale(row, Date.parse('2026-10-25T15:00:00Z'), 7, out), false, 'RedWeek has been out since the 17th: only one of its nine days counted');
  assert.equal(isStale(row, Date.parse('2026-11-30T15:00:00Z'), 7, out), false, 'however long it is out');
  const back = [{ source: 'redweek', since: '2026-10-17T00:00:00Z', until: '2026-10-27T00:00:00Z' }];
  assert.equal(isStale(row, Date.parse('2026-11-02T00:00:00Z'), 7, back), false, 'out for ten days, then back: only the ten hours before it and the six days since count');
  assert.equal(isStale(row, Date.parse('2026-11-03T00:00:00Z'), 7, back), true, 'and once more than seven counted days have passed it is stale, as ever');
});

const row0 = (source, seenAt) => ({ id: `${source}-${seenAt}`, source, seenAt, postedAt: seenAt, status: 'live' });

test('the pause belongs to the source that was out: RedWeek being down does not keep an Interval or a VakayMood row alive', () => {
  const out = [{ source: 'redweek', since: '2026-10-10T00:00:00Z', until: null }];
  const now = Date.parse('2026-10-25T00:00:00Z');
  assert.equal(isStale(row0('interval', '2026-10-12T00:00:00Z'), now, 7, out), true);
  assert.equal(isStale(row0('vakaymood', '2026-10-12T00:00:00Z'), now, 7, out), true);
  assert.equal(isStale(row0('redweek', '2026-10-12T00:00:00Z'), now, 7, out), false);
});

test('only the time the source was out AFTER the row was last seen is paused', () => {
  const D = 24 * 3600e3, now = Date.parse('2026-10-25T00:00:00Z');
  const out = [{ source: 'redweek', since: '2026-10-10T00:00:00Z', until: '2026-10-14T00:00:00Z' }, { source: 'redweek', since: '2026-10-20T00:00:00Z', until: null }];
  assert.equal(pausedMs('redweek', Date.parse('2026-10-01T00:00:00Z'), now, out), 4 * D + 5 * D, 'both outages, whole');
  assert.equal(pausedMs('redweek', Date.parse('2026-10-12T00:00:00Z'), now, out), 2 * D + 5 * D, 'seen in the middle of the first: its last two days and all of the second');
  assert.equal(pausedMs('redweek', Date.parse('2026-10-15T00:00:00Z'), now, out), 5 * D, 'seen after the first had ended: only the second');
  assert.equal(pausedMs('redweek', Date.parse('2026-10-24T00:00:00Z'), now, out), D);
  assert.equal(pausedMs('interval', 0, now, out), 0);
  assert.equal(pausedMs('redweek', 0, now, []), 0);
  assert.equal(pausedMs('redweek', 0, now, [{ source: 'redweek', since: 'garbage', until: null }]), 0, 'a bad row is nothing');
});

test('the outages the page holds are the ones the clock uses, by default — and a row\'s own "seen" is never altered by them', () => {
  const was = outages();
  try {
    setOutages([{ source: 'redweek', since: '2026-10-17T00:00:00Z', until: null }]);
    const r = row0('redweek', '2026-10-16T14:00:00Z');
    assert.equal(isStale(r, Date.parse('2026-10-29T00:00:00Z')), false);
    assert.equal(r.seenAt, '2026-10-16T14:00:00Z');
    assert.equal(seenWords(r, Date.parse('2026-10-29T00:00:00Z')), 'seen 12 days ago', 'and it still says honestly how long ago it was seen');
    setOutages(null); assert.deepEqual(outages(), []);
    assert.equal(isStale(r, Date.parse('2026-10-29T00:00:00Z')), true);
    // The store reads the same: liveDeals() drops a stale row and keeps a paused one.
    const store = new Store(); store.state = emptyState();
    store.state.deals = [{ ...r, id: 'barcelo' }];
    const at = Date.now();
    store.state.deals[0].seenAt = store.state.deals[0].postedAt = new Date(at - 9 * D).toISOString();
    assert.equal(store.liveDeals().length, 0);
    setOutages([{ source: 'redweek', since: new Date(at - 8 * D).toISOString(), until: null }]);
    assert.equal(store.liveDeals().length, 1, 'RedWeek has been out for eight of the nine days');
  } finally { setOutages(was); }
});

test('"RedWeek checked at 06:00" and "not reachable since 14:20": a time in words, today, yesterday or a date', () => {
  const now = new Date(2026, 9, 22, 15, 0).getTime();                    // 22 Oct, 15:00 local
  const at = (d, h, m = 0) => new Date(2026, 9, d, h, m).toISOString();
  assert.equal(atWords(at(22, 6), now), 'at 06:00');
  assert.equal(atWords(at(22, 18), now), 'at 18:00');
  assert.equal(atWords(at(21, 18), now), 'yesterday at 18:00');
  assert.equal(atWords(at(19, 6), now), '19 Oct at 06:00');
  assert.equal(sinceWords(at(22, 14, 20), now), '14:20');
  assert.equal(sinceWords(at(21, 14, 20), now), 'yesterday 14:20');
  assert.equal(sinceWords(at(18, 14, 20), now), '18 Oct 14:20');
  assert.equal(atWords('nonsense', now), '');
  assert.equal(sinceWords(null, now), '');
});

test('"RedWeek checked at 05:51 (via VPS)": the time the page was read, and where from, only when it is the VPS', () => {
  const now = new Date(2026, 9, 23, 7, 0).getTime();
  const at = new Date(2026, 9, 23, 5, 51).toISOString();
  assert.equal(redweekWords(at, 'vps', now), 'RedWeek checked at 05:51 (via VPS)');
  assert.equal(redweekWords(at, null, now), 'RedWeek checked at 05:51', 'a direct read says nothing about a VPS');
  assert.equal(redweekWords(at, undefined, now), 'RedWeek checked at 05:51');
  assert.equal(redweekWords(at, 'something else', now), 'RedWeek checked at 05:51', 'only a word the app knows is repeated');
  assert.equal(redweekWords(new Date(2026, 9, 22, 17, 51).toISOString(), 'vps', now), 'RedWeek checked yesterday at 17:51 (via VPS)');
  assert.equal(redweekWords('nonsense', 'vps', now), '', 'no time, no line');
  assert.doesNotMatch(redweekWords(at, 'vps', now), /available|confirmed|sold out/i);
});

test('the via migration: a new column, one function (the old argument list dropped), never a time in the future, never an older reading over a newer', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/20261026_redweek_via.sql', import.meta.url), 'utf8');
  assert.match(sql, /alter table redweek_checks add column if not exists via text/);
  assert.match(sql, /drop function if exists mark_redweek_checked\(uuid\);/);
  assert.match(sql, /mark_redweek_checked\(p_stay uuid, p_at timestamptz default null, p_via text default null\)/);
  assert.match(sql, /current_is_bot\(\)/);
  assert.match(sql, /least\(coalesce\(p_at, now\(\)\), now\(\)\)/);
  assert.match(sql, /where excluded\.checked_at >= redweek_checks\.checked_at/);
  assert.match(sql, /revoke all on function mark_redweek_checked\(uuid, timestamptz, text\) from public, anon;/);
  assert.match(sql, /grant execute on function mark_redweek_checked\(uuid, timestamptz, text\) to authenticated;/);
  const schema = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8');
  assert.ok(schema.includes(sql.trim()), 'schema.sql carries the same text, as for every migration before it');
});

test('the migrations say what was decided: dates carried by a tap, widened not dropped; an outage pauses the clock, in the database too', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/20261022_tap_window.sql', import.meta.url), 'utf8');
  assert.match(sql, /alter table stay_taps add column if not exists from_date date/);
  assert.match(sql, /alter table stay_taps add column if not exists to_date   date/);
  for (const fn of ['record_stay_tap', 'record_board_tap']) {
    const body = sql.slice(sql.indexOf(`create or replace function ${fn}`));
    assert.ok(/security definer/.test(body.slice(0, 300)), `${fn} is security definer, as before`);
    assert.ok(body.slice(0, 500).includes('current_member_id() is null'), `${fn} is a member's alone`);
    assert.ok(body.slice(0, 900).includes('least(from_date, w.o_from)') && body.slice(0, 900).includes('greatest(to_date, w.o_to)'), `${fn} widens a waiting tap`);
  }
  assert.match(sql, /p_from date default null, p_to date default null/, 'an older phone\'s call with no dates still works');
  assert.match(sql, /drop function if exists record_stay_tap\(uuid\);/);
  assert.match(sql, /drop function if exists record_board_tap\(\);/);
  assert.match(sql, /returns table \(stay uuid, tapped timestamptz, window_from date, window_to date\)/);
  assert.ok(sql.slice(sql.indexOf('function take_stay_taps')).slice(0, 300).includes('current_is_bot()'), 'the watcher alone collects them');
  assert.match(sql, /o_to := least\(p_to, o_from \+ 366\)/, 'a year at most');
  assert.match(sql, /p_to < today then return/, 'dates that are over are no window');
  const out = readFileSync(new URL('../../supabase/migrations/20261022_source_outage.sql', import.meta.url), 'utf8');
  assert.match(out, /create unique index if not exists source_outages_one_open_idx on source_outages\(source\) where until is null/);
  for (const fn of ['mark_source_unreachable', 'mark_source_reachable']) assert.ok(out.slice(out.indexOf(`function ${fn}`)).slice(0, 400).includes('current_is_bot()'), `${fn} is the watcher's alone`);
  assert.match(out, /outage_paused\(source::text, coalesce\(seen_at, posted_at\)\) < now\(\)/, 'the seven days are seven days of the source being up');
  assert.match(out, /grant select on source_outages to authenticated/);
  assert.ok(!/grant (insert|update|delete)/.test(out), 'nothing grants a write on the table');
  const schema = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8');
  assert.ok(schema.includes(sql), 'schema.sql carries the tap-window text whole');
  assert.ok(schema.includes(out), 'and the outage text whole');
});
