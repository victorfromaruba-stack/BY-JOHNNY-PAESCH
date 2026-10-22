-- 24 Oct 2026. Ian v1.1, from the review after Ian went live. Safe to run twice.
--
--   1. The gate fails closed. concierge_allow() now answers "off" unless the log key is on file and
--      pgcrypto's hmac resolves (schema.sql creates pgcrypto without naming a schema, so a fresh
--      build could have it somewhere else), instead of opening turns that could never be logged.
--   2. The gate is signed, like the log: only the concierge function opens a turn. A member calling
--      the RPC from a browser console gets nothing.
--   3. A turn is charged before it runs. The row concierge_allow() opens carries a provisional cost
--      at least the most one turn can spend (ian.ts worstCaseUsd; a test reads these two figures out
--      of this file). log_concierge_turn() replaces it with the real cost. A turn that crashes, times
--      out or cannot be logged keeps it, so the ceiling counts it at its worst, never at nothing.
--   4. Crews from a plan are bounded: three waiting on a plan per member, at most 14 nights, starting
--      within 18 months. One crew per booking is now a unique index, not only a check.

-- ---------- 4. one crew per booking ----------
create unique index if not exists crews_one_per_booking on crews(redemption_id) where redemption_id is not null;

create or replace function create_crew(p_name text, p_about text, p_redemption uuid default null,
  p_stay uuid default null, p_from date default null, p_to date default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid; c uuid; r redemptions; nm text; st uuid; pf date; pt date;
        today date := (now() at time zone 'America/Aruba')::date;
begin
  me := current_member_id();
  if me is null then raise exception 'Not a member'; end if;

  nm := btrim(coalesce(p_name, ''));
  if length(nm) < 2  then raise exception 'A circle needs a name'; end if;
  if length(nm) > 40 then raise exception 'That name is too long — 40 characters at most'; end if;

  if p_redemption is not null then
    select * into r from redemptions where id = p_redemption;
    if not found then raise exception 'No such booking'; end if;
    if r.member_id <> me then raise exception 'That booking is not yours'; end if;
    if r.status = 'quoted' then
      raise exception 'Accept the quote first — once the points are committed the room is yours and the circle can start.';
    end if;
    if r.status not in ('held','confirmed','completed') then
      raise exception 'That room is not approved yet — it is %. Once the Desk quotes it and you accept, you can start the circle around it.', r.status;
    end if;
    if exists (select 1 from crews where redemption_id = p_redemption) then raise exception 'That booking already has a crew'; end if;
    -- st, pf and pt stay null: every member can read crews, and a booking that is not shared is
    -- private, so its place and dates are not copied onto the crew row.
  else
    if p_stay is null or p_from is null or p_to is null then
      raise exception 'A crew starts from a room the Desk has approved, or from a plan: a place and the dates';
    end if;
    if p_to <= p_from then raise exception 'The dates run backwards'; end if;
    if p_from < today then raise exception 'Those dates have passed'; end if;
    if p_to - p_from > 14 then raise exception 'A plan is at most 14 nights'; end if;
    if p_from > today + interval '18 months' then raise exception 'A plan starts within 18 months'; end if;
    if not exists (select 1 from stays where id = p_stay and active) then raise exception 'No such place'; end if;
    if (select count(*) from crews where created_by = me and redemption_id is null and stay_id is not null and archived_at is null) >= 3 then
      raise exception 'You have three crews waiting on a plan already. Ask for a room for one of them first.';
    end if;
    st := p_stay; pf := p_from; pt := p_to;
  end if;

  insert into crews (name, about, created_by, redemption_id, stay_id, plan_from, plan_to)
  values (nm, nullif(btrim(coalesce(p_about, '')), ''), me, p_redemption, st, pf, pt)
  returning id into c;

  insert into crew_members (crew_id, member_id, role) values (c, me, 'lead');
  perform log_audit('crew.create', 'crew', c::text,
    jsonb_build_object('name', nm, 'redemption', p_redemption, 'stay', st, 'from', pf, 'to', pt));
  return c;
end $$;
revoke all on function create_crew(text, text, uuid, uuid, date, date) from public, anon;
grant execute on function create_crew(text, text, uuid, uuid, date, date) to authenticated;

-- ---------- 1, 2, 3. the gate ----------
drop function if exists concierge_allow();
create or replace function concierge_allow(p_sig text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid; s settings; since timestamptz; spent numeric; n int; last timestamptz; tid uuid;
        k text; m bigint; prov numeric;
begin
  me := current_member_id();
  if me is null then raise exception 'Not a member'; end if;
  select secret into k from concierge_key where id = 1;
  if k is null or to_regprocedure('extensions.hmac(text,text,text)') is null then
    return jsonb_build_object('ok', false, 'why', 'off');
  end if;
  m := floor(extract(epoch from now()) / 60)::bigint;
  if p_sig is null or p_sig not in (
       encode(extensions.hmac('allow:' || me || ':' || m,       k, 'sha256'), 'hex'),
       encode(extensions.hmac('allow:' || me || ':' || (m - 1), k, 'sha256'), 'hex'),
       encode(extensions.hmac('allow:' || me || ':' || (m + 1), k, 'sha256'), 'hex')) then
    raise exception 'Only the concierge opens a turn';
  end if;
  perform pg_advisory_xact_lock(hashtext('concierge:' || me::text));      -- one at a time, per member
  select * into s from settings where id = 1;
  since := concierge_day_start();
  -- Includes every open turn at its provisional cost: a turn in flight counts.
  select coalesce(sum(cost_usd), 0) into spent from concierge_turns where at >= since;
  if spent >= s.concierge_daily_usd then
    if not exists (select 1 from audit where action = 'concierge.resting' and at >= since) then
      perform log_audit('concierge.resting', 'settings', 'concierge',
        jsonb_build_object('spent_usd', spent, 'ceiling_usd', s.concierge_daily_usd));
    end if;
    return jsonb_build_object('ok', false, 'why', 'ceiling');
  end if;
  select count(*), max(at) into n, last from concierge_turns where member_id = me and at >= since;
  if n >= 40 then return jsonb_build_object('ok', false, 'why', 'member_day'); end if;
  if last > now() - interval '5 seconds' then return jsonb_build_object('ok', false, 'why', 'too_fast'); end if;
  -- PROVISIONAL: haiku 0.04, sonnet 0.70 (concierge.test.ts holds these to ian.ts worstCaseUsd)
  prov := case s.concierge_model when 'claude-sonnet-5-5' then 0.70 else 0.04 end;
  insert into concierge_turns (member_id, model, cost_usd) values (me, s.concierge_model, prov) returning id into tid;
  return jsonb_build_object('ok', true, 'model', s.concierge_model, 'turn_id', tid, 'provisional_usd', prov);
end $$;
revoke all on function concierge_allow(text) from public, anon;
grant execute on function concierge_allow(text) to authenticated;
