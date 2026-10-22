// deno test -A circle/supabase/functions/concierge/
// Both concierge migrations, run twice in a real Postgres (PGlite, with pgcrypto) on the smallest
// copy of the live shapes they touch, then every rule they make, tried as each kind of member.

import { assert, assertEquals, assertMatch } from 'jsr:@std/assert@1';
import { PGlite } from 'npm:@electric-sql/pglite@0.5.11';
import { pgcrypto } from 'npm:@electric-sql/pglite@0.5.11/contrib/pgcrypto';
import { hmac } from './handler.ts';
import { worstCaseUsd } from './ian.ts';

const MIGRATIONS = ['20261023_concierge.sql', '20261024_ian_fixes.sql']
  .map(f => Deno.readTextFileSync(new URL(`../../migrations/${f}`, import.meta.url)));

const BASE = `
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  create table members (id uuid primary key default gen_random_uuid(), auth_user_id uuid, name text, roles text[] not null default '{member}', bot boolean not null default false, status text not null default 'active');
  create table settings (id int primary key default 1, service_rate numeric default 0.15);
  insert into settings default values;
  create table stays (id uuid primary key default gen_random_uuid(), name text, kind text not null default 'aruba', active boolean not null default true);
  create table redemptions (id uuid primary key default gen_random_uuid(), member_id uuid references members(id), stay_id uuid references stays(id), check_in date, check_out date, status text not null default 'requested');
  create table crews (id uuid primary key default gen_random_uuid(), name text not null, about text, created_by uuid not null references members(id), created_at timestamptz not null default now(), archived_at timestamptz, redemption_id uuid references redemptions(id));
  create table crew_members (crew_id uuid references crews(id) on delete cascade, member_id uuid references members(id), role text, primary key (crew_id, member_id));
  create table audit (id bigserial primary key, actor_id uuid, action text not null, entity text not null, entity_id text, meta jsonb not null default '{}', at timestamptz not null default now());
  create or replace function current_member_id() returns uuid language sql stable security definer set search_path = public as $$ select id from members where auth_user_id = auth.uid() limit 1 $$;
  create or replace function has_role(variadic wanted text[]) returns boolean language sql stable security definer set search_path = public as $$ select exists (select 1 from members m where m.auth_user_id = auth.uid() and m.roles && wanted) $$;
  create or replace function current_is_bot() returns boolean language sql stable security definer set search_path = public as $$ select exists (select 1 from members where auth_user_id = auth.uid() and bot and status = 'active') $$;
  revoke all on function current_is_bot() from public, anon, authenticated;
  create or replace function log_audit(p_action text, p_entity text, p_entity_id text, p_meta jsonb default '{}') returns void language sql security definer set search_path = public as $$ insert into audit(actor_id, action, entity, entity_id, meta) values (current_member_id(), p_action, p_entity, p_entity_id, coalesce(p_meta,'{}')) $$;
  create or replace function available_points(p_member uuid) returns int language sql stable security definer set search_path = public as $$ select case when p_member is null then 0 else 4242 end $$;
  revoke all on function available_points(uuid) from public, anon, authenticated;
  create or replace function create_crew(p_name text, p_about text, p_redemption uuid default null) returns uuid language plpgsql security definer set search_path = public as $$ begin raise exception 'old'; end $$;
  grant select on crews, crew_members, redemptions, stays, members, settings to authenticated;
  grant insert on redemptions to authenticated;`;

const U = { ana: '00000000-0000-0000-0000-0000000000a1', luis: '00000000-0000-0000-0000-0000000000a2', desk: '00000000-0000-0000-0000-0000000000d1', bot: '00000000-0000-0000-0000-0000000000b1' } as const;
type Who = keyof typeof U | 'anon';
const KEY = 'test-key-not-the-real-one-0123456789abcdef';
const day = (n: number) => new Date(Date.now() - 4 * 36e5 + n * 864e5).toISOString().slice(0, 10);

async function boot({ crypto = true } = {}) {
  const db = new PGlite(crypto ? { extensions: { pgcrypto } } : {});
  await db.exec(`create schema extensions; ${crypto ? 'create extension pgcrypto schema extensions;' : ''}${BASE}`);
  const M: Record<string, string> = {};
  for (const [k, uid] of Object.entries(U)) {
    M[k] = (await db.query<{ id: string }>(`insert into members(auth_user_id, name, roles, bot) values ($1, $2, $3, $4) returning id`, [uid, k, k === 'desk' ? ['admin'] : ['member'], k === 'bot'])).rows[0].id;
  }
  const stay = (await db.query<{ id: string }>(`insert into stays(name) values ('Surf Club') returning id`)).rows[0].id;
  for (const sql of [...MIGRATIONS, ...MIGRATIONS]) await db.exec(sql);        // each one, twice
  const as = async (who: Who, sql: string, params: unknown[] = []) => {
    await db.exec(`set role ${who === 'anon' ? 'anon' : 'authenticated'}; select set_config('request.jwt.claim.sub', '${who === 'anon' ? '' : U[who]}', false);`);
    try { return { rows: (await db.query<any>(sql, params)).rows, err: '' }; }
    catch (e) { return { rows: [] as any[], err: (e as Error).message }; }
    finally { await db.exec('reset role'); }
  };
  const one = async (sql: string, p: unknown[] = []) => (await db.query<any>(sql, p)).rows;
  return { db, M, stay, as, one };
}
const T = await boot();
await T.db.query(`insert into concierge_key(secret) values ($1)`, [KEY]);
const allowSig = (who: keyof typeof U, minuteOffset = 0) => hmac(KEY, `allow:${T.M[who]}:${Math.floor(Date.now() / 60e3) + minuteOffset}`);
const open = async (who: keyof typeof U) => (await T.as(who, `select concierge_allow($1) a`, [await allowSig(who)])).rows[0]?.a;
const unblock = () => T.db.query(`update concierge_turns set at = at - interval '1 minute'`);   // past the five-second rule

Deno.test('fail closed: no hmac, no Ian (pgcrypto missing in a fresh build)', async () => {
  const bare = await boot({ crypto: false });
  await bare.db.query(`insert into concierge_key(secret) values ($1)`, [KEY]);
  const r = await bare.as('ana', `select concierge_allow('x') a`);
  assertEquals(r.rows[0]?.a, { ok: false, why: 'off' });
  assertEquals((await bare.one(`select count(*)::int n from concierge_turns`))[0].n, 0, 'and nothing was opened');
});

Deno.test('fail closed: no key on file, no Ian', async () => {
  const fresh = await boot();
  assertEquals((await fresh.as('ana', `select concierge_allow('x') a`)).rows[0]?.a, { ok: false, why: 'off' });
});

Deno.test('only the function opens a turn: a member calling the gate from a console gets nothing', async () => {
  assertMatch((await T.as('ana', `select concierge_allow('forged') a`)).err, /Only the concierge opens a turn/);
  assertMatch((await T.as('ana', `select concierge_allow(null) a`)).err, /Only the concierge opens a turn/);
  assertMatch((await T.as('luis', `select concierge_allow($1) a`, [await allowSig('ana')])).err, /Only the concierge/, "one member's signature does not open another's turn");
  assertMatch((await T.as('ana', `select concierge_allow($1) a`, [await allowSig('ana', -5)])).err, /Only the concierge/, 'an old signature does not work');
  assert((await T.as('anon', `select concierge_allow('x')`)).err, 'anon cannot call it');
});

Deno.test('a turn is charged its worst case before it runs, and the real cost after', async () => {
  const a = await open('ana');
  assert(a.ok);
  assertEquals(Number(a.provisional_usd), 0.04);
  assertEquals(Number((await T.one(`select cost_usd from concierge_turns where id = $1`, [a.turn_id]))[0].cost_usd), 0.04, 'charged up front');
  assertEquals((await open('ana'))?.why, 'too_fast', 'one at a time');
  const log = (who: Who, sig: string, cost: number) => T.as(who, `select log_concierge_turn($1,$2,'claude-haiku-5-5',100,2000,300,50,$3,'hi','hello','[]',true)`, [a.turn_id, sig, cost]);
  assertMatch((await log('ana', 'forged', 0)).err, /Only the concierge logs/, 'a member cannot rewrite the charge');
  assertMatch((await log('luis', await hmac(KEY, a.turn_id), 0)).err, /No open turn/, "nor log someone else's turn");
  assertEquals((await log('ana', await hmac(KEY, a.turn_id), 0.0021)).err, '');
  assertEquals(Number((await T.one(`select cost_usd from concierge_turns where id = $1`, [a.turn_id]))[0].cost_usd), 0.0021, 'the real cost replaces it');
  assertMatch((await log('ana', await hmac(KEY, a.turn_id), 0)).err, /No open turn/, 'once logged, never rewritten');
  await unblock();
});

Deno.test('the provisional charge covers the most a turn can cost at today\'s prices', () => {
  const m = MIGRATIONS[1].match(/PROVISIONAL: haiku ([\d.]+), sonnet ([\d.]+)/)!;
  assert(m, 'the migration states its provisional figures');
  assert(MIGRATIONS[1].includes(`when 'claude-sonnet-5-5' then ${m[2]} else ${m[1]} end`), 'and uses the ones it states');
  assert(Number(m[1]) >= worstCaseUsd('claude-haiku-5-5'), `haiku ${m[1]} < ${worstCaseUsd('claude-haiku-5-5')}`);
  assert(Number(m[2]) >= worstCaseUsd('claude-sonnet-5-5'), `sonnet ${m[2]} < ${worstCaseUsd('claude-sonnet-5-5')}`);
});

Deno.test('a turn that dies keeps its charge, and the ceiling counts turns in flight', async () => {
  await T.db.query(`delete from concierge_turns`);
  await T.db.query(`update settings set concierge_daily_usd = 0.10`);
  const a = await open('ana'); await unblock();
  const b = await open('luis'); await unblock();                    // two open, never logged: 0.08
  assert(a.ok && b.ok);
  const c = await open('desk'); await unblock();                     // 0.08 < 0.10: one more
  assert(c.ok);
  assertEquals((await open('bot'))?.why, 'ceiling', '0.12 of 0.10: closed, though nothing was ever logged');
  await T.db.exec(`delete from concierge_turns; update settings set concierge_daily_usd = 5`);
});

Deno.test('forty a day each, then tomorrow', async () => {
  await T.db.query(`insert into concierge_turns(member_id, model, at, ok) select $1, 'x', now() - interval '2 minutes', true from generate_series(1, 40)`, [T.M.ana]);
  assertEquals((await open('ana'))?.why, 'member_day');
  assert((await open('luis'))?.ok, 'others still can');
  await unblock();
  await T.db.query(`update concierge_turns set at = now() - interval '2 days'`);
  assert((await open('ana'))?.ok, "yesterday's turns do not count today");
  await T.db.query(`delete from concierge_turns`);
});

Deno.test('the log: members read none, the Desk reads all, nobody writes it directly', async () => {
  const a = await open('ana'); await unblock();
  assertEquals((await T.as('ana', `select * from concierge_turns`)).rows.length, 0);
  assertEquals((await T.as('desk', `select * from concierge_turns`)).rows.length, 1);
  assert((await T.as('ana', `insert into concierge_turns(member_id, model) values ($1, 'x')`, [T.M.ana])).err);
  assert((await T.as('ana', `select * from concierge_key`)).err, 'nor reads the key');
  await T.db.query(`delete from concierge_turns where id = $1`, [a.turn_id]);
});

Deno.test('feedback: your own finished answers only, 1 or -1, a note of 200', async () => {
  const a = await open('ana'); await unblock();
  const fb = (who: Who, score: number, note: string | null = null) => T.as(who, `select feedback_concierge_turn($1, $2, $3)`, [a.turn_id, score, note]);
  assertMatch((await fb('ana', 1)).err, /not yours/, 'an open turn cannot be rated');
  await T.as('ana', `select log_concierge_turn($1,$2,'claude-haiku-5-5',1,1,1,1,0.001,'p','r','[]',true)`, [a.turn_id, await hmac(KEY, a.turn_id)]);
  assertMatch((await fb('luis', 1)).err, /not yours/);
  assert((await fb('ana', 5)).err);
  assertEquals((await fb('ana', -1, ' I wanted December '.padEnd(300, 'x'))).err, '');
  const row = (await T.one(`select feedback, feedback_note from concierge_turns where id = $1`, [a.turn_id]))[0];
  assertEquals([row.feedback, row.feedback_note.length, row.feedback_note.startsWith('I wanted')], [-1, 200, true]);
});

Deno.test("Ian's notes: one row a member, theirs alone, size-bounded", async () => {
  assertEquals((await T.as('ana', `insert into concierge_memory(member_id, notes) values ($1, '{"usual_month":"October"}')`, [T.M.ana])).err, '');
  assertEquals((await T.as('luis', `select * from concierge_memory`)).rows.length, 0);
  assert((await T.as('luis', `insert into concierge_memory(member_id, notes) values ($1, '{}')`, [T.M.ana])).err);
  assertEquals((await T.as('luis', `update concierge_memory set notes = '{}' where member_id = $1 returning 1`, [T.M.ana])).rows.length, 0);
  assert((await T.as('ana', `update concierge_memory set notes = $1 where member_id = $2`, [JSON.stringify({ x: 'y'.repeat(9000) }), T.M.ana])).err);
});

Deno.test('crews from a plan: three waiting each, 14 nights, within 18 months', async () => {
  const mk = (n: string, from: string, to: string) => T.as('ana', `select create_crew($1, null, null, $2, $3, $4) id`, [n, T.stay, from, to]);
  assertMatch((await mk('Long', day(30), day(45))).err, /at most 14 nights/);
  assertMatch((await mk('Far', day(600), day(605))).err, /within 18 months/);
  assertMatch((await mk('Past', day(-9), day(-2))).err, /passed/);
  for (const n of ['One', 'Two', 'Three']) assertEquals((await mk(n, day(30), day(37))).err, '');
  assertMatch((await mk('Four', day(30), day(37))).err, /three crews waiting/);
  assertEquals((await T.as('luis', `select create_crew('Luis one', null, null, $1, $2, $3)`, [T.stay, day(30), day(37)])).err, '', 'the cap is per member');
});

Deno.test('one crew per booking, and a private booking stays private', async () => {
  const held = (await T.one(`insert into redemptions(member_id, stay_id, check_in, check_out, status) values ($1,$2,$3,$4,'held') returning id`, [T.M.ana, T.stay, day(100), day(107)]))[0].id;
  const r = await T.as('ana', `select create_crew(p_name => 'Room crew', p_about => null, p_redemption => $1) id`, [held]);
  assertEquals(r.err, '', "the app's existing call still works");
  const row = (await T.one(`select stay_id, plan_from from crews where id = $1`, [r.rows[0].id]))[0];
  assertEquals([row.stay_id, row.plan_from], [null, null]);
  assertMatch((await T.as('ana', `select create_crew(p_name => 'Again', p_about => null, p_redemption => $1)`, [held])).err, /already has a crew/);
  let dup = '';
  try { await T.db.query(`insert into crews(name, created_by, redemption_id) values ('raw', $1, $2)`, [T.M.ana, held]); } catch (e) { dup = (e as Error).message; }
  assertMatch(dup, /crews_one_per_booking/, 'and the database itself holds it');
});

Deno.test("a plan joins its lead's booking, nobody else's", async () => {
  const c = (await T.as('luis', `select create_crew('Plan', null, null, $1, $2, $3) id`, [T.stay, day(200), day(207)])).rows[0]?.id
    ?? (await T.one(`select id from crews where created_by = $1 and redemption_id is null order by created_at desc limit 1`, [T.M.luis]))[0].id;
  await T.as('ana', `insert into redemptions(member_id, stay_id, check_in, check_out) values ($1,$2,$3,$4)`, [T.M.ana, T.stay, day(201), day(206)]);
  assertEquals((await T.one(`select redemption_id from crews where id = $1`, [c]))[0].redemption_id, null);
  const mine = (await T.as('luis', `insert into redemptions(member_id, stay_id, check_in, check_out) values ($1,$2,$3,$4) returning id`, [T.M.luis, T.stay, day(202), day(208)])).rows[0].id;
  assertEquals((await T.one(`select redemption_id from crews where id = $1`, [c]))[0].redemption_id, mine);
});

Deno.test('what you hold, for yourself only', async () => {
  assert((await T.as('ana', `select available_points($1)`, [T.M.ana])).err);
  assertEquals((await T.as('ana', `select my_available_points() n`)).rows[0].n, 4242);
  assert((await T.as('anon', `select my_available_points()`)).err);
});
