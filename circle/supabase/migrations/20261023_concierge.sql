-- 23 Oct 2026. Ian, the Circle's concierge. Victor: "Go ahead" (22 Oct).
--
-- Safe to run twice. Seven things:
--
--   1. settings          which model Ian runs on, and the club's daily ceiling in dollars.
--   2. crews from a plan a crew can start from a place and dates, before any room is asked for,
--                        and is tied to the booking the moment its lead asks for that room.
--   3. concierge_turns   every turn Ian takes: tokens, cost, each tool call, the answer, and the
--                        member's "Helped" / "Not it". Read by the Desk, written only by functions.
--   4. concierge_allow   the gate in front of every turn: the club ceiling (a hard stop), 40 turns
--                        a member a day, and one at a time.
--   5. feedback          a member marks one of their own answers.
--   6. concierge_memory  what Ian has noted about one member, readable and writable by that
--                        member alone (Ian writes it with the member's own token).
--   7. my_available_points  the points you can spend, for yourself: available_points() is revoked
--                        from members by the helper lock-down in schema.sql.
--
-- No service key anywhere: the concierge function calls all of this as the member.

-- ---------- 1. settings ----------
alter table settings add column if not exists concierge_model text not null default 'claude-haiku-5-5';
alter table settings drop constraint if exists settings_concierge_model_check;
alter table settings add constraint settings_concierge_model_check
  check (concierge_model in ('claude-haiku-5-5', 'claude-sonnet-5-5'));
alter table settings add column if not exists concierge_daily_usd numeric(8,2) not null default 5.00
  check (concierge_daily_usd >= 0);

-- ---------- 2. a crew from a plan ----------
-- Victor, 22 Oct 2026: a crew can be born from a plan. The rule it replaces ("a circle starts
-- from an approved room") still holds for a crew started from a room; what is new is the other
-- door, and it has its own guard: a place, and dates that have not passed.
alter table crews add column if not exists stay_id   uuid references stays(id);
alter table crews add column if not exists plan_from date;
alter table crews add column if not exists plan_to   date;
alter table crews drop constraint if exists crews_plan_dates;
alter table crews add constraint crews_plan_dates check (plan_from is null or plan_to > plan_from);

-- Adding arguments makes an overload, not a replacement (see the note at the top of schema.sql),
-- so the three-argument form is dropped by its exact signature. The app's existing call names
-- p_name, p_about and p_redemption, which the six-argument form still answers.
drop function if exists create_crew(text, text, uuid);
create or replace function create_crew(p_name text, p_about text, p_redemption uuid default null,
  p_stay uuid default null, p_from date default null, p_to date default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid; c uuid; r redemptions; nm text; st uuid; pf date; pt date;
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
    st := r.stay_id; pf := r.check_in; pt := r.check_out;
  else
    if p_stay is null or p_from is null or p_to is null then
      raise exception 'A crew starts from a room the Desk has approved, or from a plan: a place and the dates';
    end if;
    if p_to <= p_from then raise exception 'The dates run backwards'; end if;
    if p_from < (now() at time zone 'America/Aruba')::date then raise exception 'Those dates have passed'; end if;
    if not exists (select 1 from stays where id = p_stay and active) then raise exception 'No such place'; end if;
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

-- The plan becomes the booking: when the crew's lead asks for a room at that place on dates that
-- overlap the plan, the newest such crew is tied to it. One crew per booking, as before.
create or replace function link_planned_crew() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update crews set redemption_id = new.id
   where id = (select c.id from crews c
                where c.redemption_id is null and c.archived_at is null
                  and c.created_by = new.member_id and c.stay_id = new.stay_id
                  and c.plan_from < new.check_out and c.plan_to > new.check_in
                order by c.created_at desc limit 1)
     and not exists (select 1 from crews c2 where c2.redemption_id = new.id);
  return new;
end $$;
revoke all on function link_planned_crew() from public, anon, authenticated;
drop trigger if exists redemptions_link_crew on redemptions;
create trigger redemptions_link_crew after insert on redemptions
  for each row execute function link_planned_crew();

-- ---------- 3. the turns ----------
create table if not exists concierge_turns (
  id                 uuid primary key default gen_random_uuid(),   -- unguessable: it is the turn's key
  member_id          uuid not null references members(id) on delete cascade,
  at                 timestamptz not null default now(),           -- when the turn STARTED
  model              text not null,
  input_tokens       int not null default 0,
  cached_tokens      int not null default 0,                       -- read from the cache
  cache_write_tokens int not null default 0,
  output_tokens      int not null default 0,
  cost_usd           numeric(10,6) not null default 0,
  prompt             text,
  reply              text,
  tools              jsonb not null default '[]',
  ok                 boolean,                                      -- null while the turn is running
  error              text,
  feedback           smallint check (feedback in (-1, 1)),
  feedback_note      text check (length(feedback_note) <= 200)
);
create index if not exists concierge_turns_at on concierge_turns(at);
create index if not exists concierge_turns_member on concierge_turns(member_id, at desc);
alter table concierge_turns enable row level security;
revoke all on concierge_turns from anon, authenticated;
grant select on concierge_turns to authenticated;
drop policy if exists concierge_turns_read on concierge_turns;
create policy concierge_turns_read on concierge_turns for select to authenticated
  using ((select has_role('admin','treasurer')));

-- Midnight in Aruba, as a timestamp: "today" for the ceiling and the daily count.
create or replace function concierge_day_start() returns timestamptz
language sql stable set search_path = public as $$
  select date_trunc('day', now() at time zone 'America/Aruba') at time zone 'America/Aruba'
$$;

-- ---------- 4. the gate ----------
-- Called before every turn. On yes it opens the turn's row and hands back its id, which only the
-- function ever sees; log_concierge_turn fills that row in afterwards, once. A turn that dies in
-- between leaves its row open (ok null), which is itself the record that it started.
-- ponytail: turns in flight are not yet counted, so a burst can pass the ceiling by a few cents.
create or replace function concierge_allow() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid; s settings; since timestamptz; spent numeric; n int; last timestamptz; tid uuid;
begin
  me := current_member_id();
  if me is null then raise exception 'Not a member'; end if;
  perform pg_advisory_xact_lock(hashtext('concierge:' || me::text));      -- one at a time, per member
  select * into s from settings where id = 1;
  since := concierge_day_start();
  select coalesce(sum(cost_usd), 0) into spent from concierge_turns where at >= since;
  if spent >= s.concierge_daily_usd then
    -- Said once a day in the record, which is what the Desk and the dashboard card read.
    if not exists (select 1 from audit where action = 'concierge.resting' and at >= since) then
      perform log_audit('concierge.resting', 'settings', 'concierge',
        jsonb_build_object('spent_usd', spent, 'ceiling_usd', s.concierge_daily_usd));
    end if;
    return jsonb_build_object('ok', false, 'why', 'ceiling');
  end if;
  select count(*), max(at) into n, last from concierge_turns where member_id = me and at >= since;
  if n >= 40 then return jsonb_build_object('ok', false, 'why', 'member_day'); end if;
  if last > now() - interval '5 seconds' then return jsonb_build_object('ok', false, 'why', 'too_fast'); end if;
  insert into concierge_turns (member_id, model) values (me, s.concierge_model) returning id into tid;
  return jsonb_build_object('ok', true, 'model', s.concierge_model, 'turn_id', tid);
end $$;
revoke all on function concierge_allow() from public, anon;
grant execute on function concierge_allow() to authenticated;

create or replace function log_concierge_turn(p_id uuid, p_model text, p_input int, p_cached int, p_cache_write int,
  p_output int, p_cost numeric, p_prompt text, p_reply text, p_tools jsonb, p_ok boolean, p_error text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if current_member_id() is null then raise exception 'Not a member'; end if;
  update concierge_turns set
    model = coalesce(p_model, model),
    input_tokens = greatest(coalesce(p_input, 0), 0), cached_tokens = greatest(coalesce(p_cached, 0), 0),
    cache_write_tokens = greatest(coalesce(p_cache_write, 0), 0), output_tokens = greatest(coalesce(p_output, 0), 0),
    cost_usd = greatest(coalesce(p_cost, 0), 0),
    prompt = left(p_prompt, 4000), reply = left(p_reply, 8000),
    tools = coalesce(p_tools, '[]'), ok = coalesce(p_ok, false), error = left(p_error, 500)
  where id = p_id and member_id = current_member_id() and ok is null;
  if not found then raise exception 'No open turn to log'; end if;
end $$;
revoke all on function log_concierge_turn(uuid, text, int, int, int, int, numeric, text, text, jsonb, boolean, text) from public, anon;
grant execute on function log_concierge_turn(uuid, text, int, int, int, int, numeric, text, text, jsonb, boolean, text) to authenticated;

-- For the dashboard card on the VPS (the watcher's robot account) and the Desk: today's spend.
-- Resting is a fact about now: raise the ceiling and Ian is awake again, the same minute.
create or replace function concierge_today() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare since timestamptz := concierge_day_start(); s settings; spent numeric;
begin
  if not (current_is_bot() or has_role('admin','treasurer')) then raise exception 'Only the Desk reads this'; end if;
  select * into s from settings where id = 1;
  select coalesce(sum(cost_usd), 0) into spent from concierge_turns where at >= since;
  return jsonb_build_object(
    'spent_usd', spent,
    'turns', (select count(*) from concierge_turns where at >= since),
    'ceiling_usd', s.concierge_daily_usd, 'model', s.concierge_model,
    'resting', spent >= s.concierge_daily_usd,
    'resting_since', case when spent >= s.concierge_daily_usd
      then (select min(at) from audit where action = 'concierge.resting' and at >= since) end);
end $$;
revoke all on function concierge_today() from public, anon;
grant execute on function concierge_today() to authenticated;

-- ---------- 5. feedback ----------
create or replace function feedback_concierge_turn(p_turn uuid, p_score int, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if current_member_id() is null then raise exception 'Not a member'; end if;
  if p_score is null or p_score not in (1, -1) then raise exception 'Helped is 1, not it is -1'; end if;
  update concierge_turns
     set feedback = p_score, feedback_note = nullif(left(btrim(coalesce(p_note, '')), 200), '')
   where id = p_turn and member_id = current_member_id() and ok;
  if not found then raise exception 'That answer is not yours'; end if;
end $$;
revoke all on function feedback_concierge_turn(uuid, int, text) from public, anon;
grant execute on function feedback_concierge_turn(uuid, int, text) to authenticated;

-- ---------- 6. what Ian remembers ----------
-- One row a member, theirs alone. The size check is the backstop for a member writing to it
-- directly: the function keeps it to 20 notes of 200 characters.
create table if not exists concierge_memory (
  member_id  uuid primary key references members(id) on delete cascade,
  notes      jsonb not null default '{}' check (jsonb_typeof(notes) = 'object' and pg_column_size(notes) <= 8192),
  updated_at timestamptz not null default now()
);
alter table concierge_memory enable row level security;
revoke all on concierge_memory from anon, authenticated;
grant select, insert, update, delete on concierge_memory to authenticated;
drop policy if exists concierge_memory_own on concierge_memory;
create policy concierge_memory_own on concierge_memory for all to authenticated
  using (member_id = current_member_id()) with check (member_id = current_member_id());

-- ---------- 7. what you hold ----------
create or replace function my_available_points() returns int
language sql stable security definer set search_path = public as $$
  select available_points(current_member_id())
$$;
revoke all on function my_available_points() from public, anon;
grant execute on function my_available_points() to authenticated;
