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
