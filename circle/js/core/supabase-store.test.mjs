// What reload() does when the database says no.
//
// Signed out, EVERY table and settings is refused: schema.sql revokes all tables in the schema
// from `anon` and every policy is `to authenticated`. That is the design, not an outage — but
// the abort that exists for real outages used to fire on it, before publicOnly was computed, so
// the bundled-catalog fallback below it never ran once. The front page of an invitation-only
// club met strangers with "0 of 40 taken · 0 places", both false.
//
// These tests hold the line on both sides of that: a stranger gets the public page, and a member
// who IS signed in and gets nothing back still gets told the Circle is not answering.
//
//   node --test 'circle/js/core/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseStore } from './supabase-store.js';

const REFUSED = { message: 'permission denied for table', code: '42501' };

/** A Supabase client stub. `deny` is a set of table names that answer with an error; everything
 *  else answers with `rows`. Shaped to match the two call styles reload() uses: a bare
 *  `.select('*')` awaited directly, and settings' `.select('*').eq(...).maybeSingle()`. */
function stubClient({ deny = new Set(), rows = {} } = {}) {
  const answer = (t) => (deny.has(t) ? { data: null, error: REFUSED } : { data: rows[t] || [], error: null });
  return {
    from(t) {
      return {
        select() {
          const result = answer(t);
          return {
            then: (res, rej) => Promise.resolve(result).then(res, rej),
            eq() { return { maybeSingle: async () => result }; },
          };
        },
      };
    },
    storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: null } }) }) },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange() {} },
  };
}

const ALL = new Set(['members', 'contributions', 'ledger', 'stays', 'redemptions', 'pledges', 'looks',
  'announcements', 'audit', 'invitations', 'month_closes', 'promo_deferrals', 'room_types', 'watches',
  'deals', 'standings', 'crews', 'crew_members', 'crew_messages', 'moments', 'moment_reactions',
  'badge_catalog', 'member_badges', 'members_v', 'standing_v', 'settings']);

const newStore = (client) => new SupabaseStore({ client });

test('signed out: a wall of refusals is the public page, not an outage', async () => {
  const store = newStore(stubClient({ deny: ALL }));
  await store.reload();                       // must not throw

  assert.equal(store.publicOnly, true, 'the stranger is on the public page');
  assert.ok(store.state.stays.length > 0, 'the bundled catalog fills in so the page is not blank');
  assert.deepEqual(store.partial, [], 'nothing is stale when there was nothing to refresh');
});

test('signed out: publicOnly survives a second reload', async () => {
  // The latch this guards: the fallback writes the catalog into state.stays and a failed fetch
  // keeps the last known rows, so a row-count check finds stays sitting there on the second
  // pass and concludes the stranger signed in — then prints the empty store as fact.
  const store = newStore(stubClient({ deny: ALL }));
  await store.reload();
  await store.reload();

  assert.equal(store.publicOnly, true, 'still the public page on the second pass');
  assert.equal(store.state.members.length, 0, 'and members is still empty, so no count is invented');
});

test('signed in: a wall of refusals IS an outage, and says so', async () => {
  const store = newStore(stubClient({ deny: ALL }));
  store.state.session = { memberId: 'mem_victor', at: new Date().toISOString() };

  await assert.rejects(() => store.reload(), /not answering right now/,
    'a member who gets nothing back must be told, not shown a stranger\'s page');
});

test('signed in and answered: the public fallback stays out of the way', async () => {
  const store = newStore(stubClient({ rows: { stays: [{ id: 'stay_x', name: 'A place' }] } }));
  store.state.session = { memberId: 'mem_victor', at: new Date().toISOString() };
  await store.reload();

  assert.equal(store.publicOnly, false, 'a signed-in member is never on the public page');
  assert.equal(store.state.stays.length, 1, 'and sees the database, not the bundled catalog');
});

test('signed in, one table down after a good load: kept, flagged, not fatal', async () => {
  const store = newStore(stubClient({ rows: { stays: [{ id: 'stay_x', name: 'A place' }] } }));
  store.state.session = { memberId: 'mem_victor', at: new Date().toISOString() };
  await store.reload();

  store.sb = stubClient({ deny: new Set(['deals']), rows: { stays: [{ id: 'stay_x', name: 'A place' }] } });
  await store.reload();                       // must not throw: _loadedOnce is set

  assert.ok(store.partial.includes('deals'), 'the member is told which table is stale');
  assert.equal(store.publicOnly, false, 'and is still not treated as a stranger');
});

// God's Eye View: the pass comes from the gev-pass function. A member must be told plainly
// when it is not set up, rather than "try again" forever.
const invoking = (result) => ({ ...stubClient(), functions: { invoke: async () => result } });
const httpError = (status, body) => ({ data: null, error: { context: { status, json: async () => body } } });

test('god’s eye: a pass comes back as its url', async () => {
  const store = newStore(invoking({ data: { url: 'https://x.example/__gate?t=a.b' }, error: null }));
  assert.deepEqual(await store.godsEyePass(), { url: 'https://x.example/__gate?t=a.b' });
});

test('god’s eye: a function that is not deployed reads as not switched on', async () => {
  const store = newStore(invoking(httpError(404, { code: 'NOT_FOUND' })));
  await assert.rejects(store.godsEyePass(), /not switched on yet/);
});

test('god’s eye: the function’s own refusal is what the member reads', async () => {
  const store = newStore(invoking(httpError(403, { error: 'God’s Eye View is for active Insiders.' })));
  await assert.rejects(store.godsEyePass(), /for active Insiders/);
});

test('god’s eye: an unreachable server gets a plain sentence', async () => {
  const store = newStore(invoking({ data: null, error: { message: 'Failed to send a request' } }));
  await assert.rejects(store.godsEyePass(), /could not hand out a pass/);
});

// A member opening a stay: tell the watcher, and never let that be seen.
import { mock } from 'node:test';

const tapClient = ({ rpc, checked = { data: null, error: null } } = {}) => ({
  ...stubClient(),
  rpc,
  from(t) {
    if (t !== 'redweek_checks') return stubClient().from(t);
    return { select: () => ({ eq: () => ({ maybeSingle: async () => (checked instanceof Error ? Promise.reject(checked) : checked) }) }) };
  },
});

test('a tap on a stay records one tap, and a redraw of the same page does not tap again', () => {
  const calls = [];
  const store = newStore(tapClient({ rpc: (fn, args) => { calls.push([fn, args]); return Promise.resolve({ data: null, error: null }); } }));
  store.noteStayLook('stay-surf'); store.noteStayLook('stay-surf'); store.noteStayLook('stay-surf');
  store.noteStayLook('stay-ocean');
  assert.deepEqual(calls, [['record_stay_tap', { p_stay: 'stay-surf' }], ['record_stay_tap', { p_stay: 'stay-ocean' }]]);
});

test('a tap that cannot be recorded is invisible: not installed yet, offline, or throwing', async () => {
  for (const rpc of [
    () => Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }),
    () => Promise.reject(new Error('Failed to fetch')),
    () => { throw new Error('boom'); },
  ]) {
    const store = newStore(tapClient({ rpc }));
    assert.doesNotThrow(() => store.noteStayLook('stay-surf'));
  }
  await new Promise(r => setTimeout(r, 5));      // an unhandled rejection would fail the run here
});

test('a tap does not reload the store the way rpc() does', () => {
  let reloads = 0;
  const store = newStore(tapClient({ rpc: () => Promise.resolve({ data: null, error: null }) }));
  store.reload = async () => { reloads++; };
  store.noteStayLook('stay-surf');
  assert.equal(reloads, 0);
});

test('the check time is the watcher’s timestamp, or null when there is none or no table', async () => {
  const at = '2026-10-22T12:00:00+00:00';
  assert.equal(await newStore(tapClient({ checked: { data: { checked_at: at }, error: null } })).redweekCheckedAt('s'), at);
  assert.equal(await newStore(tapClient({ checked: { data: null, error: null } })).redweekCheckedAt('s'), null);
  assert.equal(await newStore(tapClient({ checked: { data: null, error: { code: '42P01', message: 'relation does not exist' } } })).redweekCheckedAt('s'), null,
    'the migration not being applied yet is no line, not an error');
  assert.equal(await newStore(tapClient({ checked: new Error('offline') })).redweekCheckedAt('s'), null);
});

test('a burst of realtime events is one reload, not one per row', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const handlers = [];
    const channel = { on: (_t, _f, cb) => { handlers.push(cb); return channel; }, subscribe: () => channel };
    const store = newStore({ ...stubClient(), channel: () => channel });
    let reloads = 0;
    store.reload = async () => { reloads++; };
    store.subscribeRealtime();
    for (let i = 0; i < 24; i++) handlers[3]();          // the watcher moves 24 clocks at once
    assert.equal(reloads, 0, 'nothing reloads on the first event');
    mock.timers.tick(1400); assert.equal(reloads, 0, 'still gathering');
    mock.timers.tick(200);  assert.equal(reloads, 1, 'one reload answers the whole burst');
  } finally { mock.timers.reset(); }
});

// ---------------------------------------------------------------- the dates a tap carries (22 Oct 2026)
test('a tap on a stay carries the dates the member is looking for; the same dates five minutes apart are one tap, new dates are another', () => {
  const calls = [];
  const store = newStore(tapClient({ rpc: (fn, args) => { calls.push([fn, args]); return Promise.resolve({ data: null, error: null }); } }));
  const xmas = { from: '2026-12-20', to: '2027-01-03' }, soon = { from: '2026-10-22', to: '2026-12-21' };
  store.noteStayLook('stay-surf', xmas); store.noteStayLook('stay-surf', xmas); store.noteStayLook('stay-surf', xmas);
  store.noteStayLook('stay-surf', soon);
  store.noteStayLook('stay-ocean');
  assert.deepEqual(calls, [
    ['record_stay_tap', { p_stay: 'stay-surf', p_from: '2026-12-20', p_to: '2027-01-03' }],
    ['record_stay_tap', { p_stay: 'stay-surf', p_from: '2026-10-22', p_to: '2026-12-21' }],
    ['record_stay_tap', { p_stay: 'stay-ocean' }],
  ]);
});

test('opening the Stays list carries the dates; changing them taps again at once, the same dates do not inside a minute', () => {
  const calls = [];
  const store = newStore(tapClient({ rpc: (fn, args) => { calls.push([fn, args]); return Promise.resolve({ data: null, error: null }); } }));
  const a = { from: '2026-10-22', to: '2026-12-21' }, b = { from: '2026-12-20', to: '2027-01-03' };
  store.noteBoardLook(a); store.noteBoardLook(a);
  store.noteBoardLook(b); store.noteBoardLook(b);
  store.noteBoardLook(a);
  assert.deepEqual(calls, [
    ['record_board_tap', { p_from: '2026-10-22', p_to: '2026-12-21' }],
    ['record_board_tap', { p_from: '2026-12-20', p_to: '2027-01-03' }],
    ['record_board_tap', { p_from: '2026-10-22', p_to: '2026-12-21' }],
  ]);
});

test('a tap with a window is as invisible as one without: not installed, offline, throwing', async () => {
  for (const rpc of [() => Promise.resolve({ data: null, error: { code: 'PGRST202' } }), () => Promise.reject(new Error('offline')), () => { throw new Error('boom'); }]) {
    const store = newStore(tapClient({ rpc }));
    assert.doesNotThrow(() => store.noteBoardLook({ from: '2026-10-22', to: '2026-12-21' }));
    assert.doesNotThrow(() => store.noteStayLook('s', { from: '2026-10-22', to: '2026-12-21' }));
  }
  await new Promise((r) => setTimeout(r, 5));
});

// ---------------------------------------------------------------- the line at the top of Stays, and the outages the clock uses
const tableClient = (tables) => ({
  ...stubClient(),
  from(t) {
    const hit = tables[t];
    if (!hit) return stubClient().from(t);
    const chain = {
      select: () => chain, order: () => chain, limit: () => (hit.rows !== undefined ? Promise.resolve(hit.rows) : chain),
      eq: () => chain, is: () => chain, maybeSingle: async () => (hit.one instanceof Error ? Promise.reject(hit.one) : hit.one),
      then: (res, rej) => Promise.resolve(hit.all ?? { data: [], error: null }).then(res, rej),
    };
    return chain;
  },
});

test('the Stays line: when RedWeek was last read, whether it is out right now since when, and the board check', async () => {
  const read = '2026-10-22T10:00:00+00:00', since = '2026-10-22T18:20:00+00:00';
  const store = newStore(tableClient({
    board_checks: { one: { data: { checked_at: '2026-10-22T18:00:00+00:00', verified: 4, repriced: 0, retired: 1 }, error: null } },
    redweek_checks: { rows: { data: [{ checked_at: read }], error: null } },
    source_outages: { one: { data: { since }, error: null } },
  }));
  store.state.deals = [];
  const st = await store.boardStatus();
  assert.equal(st.redweekAt, read);
  assert.deepEqual(st.outage, { source: 'redweek', since });
  assert.equal(st.at, '2026-10-22T18:00:00+00:00');
  // No outage: the line is "checked at", nothing about reachability.
  const calm = await newStore(tableClient({ redweek_checks: { rows: { data: [{ checked_at: read }], error: null } }, source_outages: { one: { data: null, error: null } } })).boardStatus();
  assert.deepEqual([calm.redweekAt, calm.outage, calm.at], [read, null, null], 'RedWeek alone is enough to say something');
  // Nothing at all, or none of the tables: no line, not an error.
  assert.equal(await newStore(tableClient({})).boardStatus(), null);
  assert.equal(await newStore(tableClient({ redweek_checks: { rows: { data: null, error: { code: '42P01' } } }, source_outages: { one: new Error('offline') } })).boardStatus(), null);
});

test('the outages are loaded for the clock; a table that is not there, or a stranger who may not read it, is none', async () => {
  const { outages, setOutages } = await import('./freshness.js');
  try {
    const rows = [{ source: 'redweek', since: '2026-10-22T18:20:00+00:00', until: null }];
    await newStore(tableClient({ source_outages: { all: { data: rows, error: null } } })).loadOutages();
    assert.deepEqual(outages(), rows);
    setOutages([]);
    await newStore(tableClient({ source_outages: { all: { data: null, error: { code: '42P01' } } } })).loadOutages();
    assert.deepEqual(outages(), []);
    await newStore(tableClient({ source_outages: { all: Promise.reject(new Error('offline')).catch((e) => { throw e; }) } })).loadOutages().catch(() => {});
  } finally { setOutages([]); }
});
