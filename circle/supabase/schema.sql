-- =====================================================================
--  Circle — Supabase schema, row-level security and server-side rules
--  Apply once in the Supabase SQL editor (or `supabase db push`).
--  Everything money-related runs inside SECURITY DEFINER functions so a
--  member can never credit their own points from the browser.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- enums ----------
do $$ begin
  create type member_role as enum ('member','treasurer','planner','comms','admin');
exception when duplicate_object then null; end $$;
do $$ begin
  create type member_status as enum ('active','paused','left','invited');
exception when duplicate_object then null; end $$;
do $$ begin
  create type contribution_status as enum ('pending','confirmed','rejected','withdrawn');
exception when duplicate_object then null; end $$;
do $$ begin
  create type redemption_status as enum ('requested','approved','confirmed','completed','declined','cancelled');
exception when duplicate_object then null; end $$;
do $$ begin
  create type ledger_kind as enum ('earn','bonus','redeem','refund','adjust');
exception when duplicate_object then null; end $$;

-- ---------- settings (single row) ----------
create table if not exists settings (
  id            int primary key default 1 check (id = 1),
  service_rate  numeric(5,4) not null default 0.15,
  points_per_dollar numeric(10,2) not null default 100,      -- 100 points = $1
  awg_per_usd   numeric(6,3) not null default 1.79,
  tiers         jsonb not null default '[{"id":"t100","monthlyUsd":100,"bonusRate":0},{"id":"t150","monthlyUsd":150,"bonusRate":0.02},{"id":"t200","monthlyUsd":200,"bonusRate":0.04}]',
  streak_bonuses jsonb not null default '{"6":1000,"12":2500,"24":5000}',
  treasurer_bank jsonb not null default '{}',   -- {bank, accountName, accountNumber, swift, note}
  club_name     text not null default 'Circle',
  updated_at    timestamptz not null default now()
);
insert into settings (id) values (1) on conflict do nothing;

-- ---------- members ----------
create table if not exists members (
  id           uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  email        text unique,
  name         text not null,
  phone        text,
  roles        member_role[] not null default '{member}',
  status       member_status not null default 'invited',
  monthly_usd  int not null default 100 check (monthly_usd in (100,150,200)),
  hue          int not null default 200,
  home         text,
  joined_at    timestamptz not null default now(),
  notes        text
);

-- ---------- contributions ----------
create table if not exists contributions (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references members(id) on delete cascade,
  amount_usd    numeric(10,2) not null check (amount_usd > 0),
  for_month     text not null check (for_month ~ '^\d{4}-\d{2}$'),
  method        text not null default 'bank',
  reference     text,
  note          text,
  proof_path    text,                         -- storage object path in bucket `proofs`
  submitted_at  timestamptz not null default now(),
  status        contribution_status not null default 'pending',
  reviewed_by   uuid references members(id),
  reviewed_at   timestamptz,
  reason        text,
  to_circle_usd numeric(10,2),
  backing_usd   numeric(10,2),
  points        int,
  bonus_points  int,
  bonus_cost_usd numeric(10,2)
);
create index if not exists contributions_member_idx on contributions(member_id, submitted_at desc);
create index if not exists contributions_status_idx on contributions(status);
-- One live submission per member per month (a rejected/withdrawn one can be re-sent).
create unique index if not exists contributions_one_per_month on contributions(member_id, for_month) where status in ('pending','confirmed');

-- ---------- ledger (append-only) ----------
create table if not exists ledger (
  id        uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  kind      ledger_kind not null,
  points    int not null,
  usd       numeric(10,2),
  ref_type  text,
  ref_id    uuid,
  note      text,
  at        timestamptz not null default now()
);
create index if not exists ledger_member_idx on ledger(member_id, at desc);
-- The ledger is append-only: corrections are new 'adjust' rows, never edits.
create or replace function ledger_immutable() returns trigger language plpgsql as $$
begin raise exception 'The points ledger is append-only'; end $$;
drop trigger if exists ledger_no_update on ledger;
create trigger ledger_no_update before update or delete on ledger for each row execute function ledger_immutable();

-- ---------- stays (catalog) ----------
create table if not exists stays (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null default 'aruba' check (kind in ('aruba','world')),
  name           text not null,
  area           text,
  country        text default 'Aruba',
  category       int not null default 3 check (category between 1 and 5),
  rate_low_usd   numeric(10,2) not null check (rate_low_usd > 0),    -- member rate per night, Apr 6 – Dec 19
  rate_high_usd  numeric(10,2) not null check (rate_high_usd > 0),   -- Dec 20 – Apr 5
  rate_peak_usd  numeric(10,2) not null check (rate_peak_usd > 0),   -- Dec 20 – Jan 3 and Carnival week
  retail_usd     numeric(10,2),                                      -- typical public rate, for the "you save" line
  min_nights     int not null default 2,
  peak_min_nights int not null default 7,
  on_sand        boolean not null default true,
  adults_only    boolean not null default false,
  vibe           text,
  features       text[] default '{}',
  deal_note      text,
  season_note    text,
  image          text,          -- URL or a gradient descriptor the app understands
  available_from date,
  available_to   date,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

-- ---------- redemptions ----------
create table if not exists redemptions (
  id               uuid primary key default gen_random_uuid(),
  member_id        uuid not null references members(id) on delete cascade,
  stay_id          uuid not null references stays(id),
  check_in         date not null,
  check_out        date not null,
  nights           int not null check (nights > 0),
  guests           int not null default 2,
  note             text,
  points           int not null,               -- points covered by balance
  full_points      int not null,               -- full price in points
  seasons          jsonb not null default '{}', -- {low:n, high:n, peak:n} nights per season
  cash_top_up_usd  numeric(10,2) not null default 0,
  status           redemption_status not null default 'requested',
  requested_at     timestamptz not null default now(),
  decided_by       uuid references members(id),
  decided_at       timestamptz,
  decision         text,
  confirmed_at     timestamptz,
  completed_at     timestamptz,
  confirmation_ref text,
  check (check_out > check_in)
);
create index if not exists redemptions_member_idx on redemptions(member_id, requested_at desc);
create index if not exists redemptions_status_idx on redemptions(status);

-- ---------- announcements ----------
create table if not exists announcements (
  id        uuid primary key default gen_random_uuid(),
  author_id uuid references members(id),
  title     text not null,
  body      text not null,
  kind      text not null default 'news',
  pinned    boolean not null default false,
  at        timestamptz not null default now()
);

-- ---------- audit ----------
create table if not exists audit (
  id        uuid primary key default gen_random_uuid(),
  actor_id  uuid references members(id),
  action    text not null,
  entity    text not null,
  entity_id text,
  meta      jsonb default '{}',
  at        timestamptz not null default now()
);

-- =====================================================================
--  Helpers
-- =====================================================================
create or replace function current_member_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from members where auth_user_id = auth.uid() limit 1
$$;

create or replace function has_role(variadic wanted member_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from members m
    where m.auth_user_id = auth.uid() and m.roles && wanted
  )
$$;

create or replace function log_audit(p_action text, p_entity text, p_entity_id text, p_meta jsonb default '{}')
returns void language sql security definer set search_path = public as $$
  insert into audit(actor_id, action, entity, entity_id, meta) values (current_member_id(), p_action, p_entity, p_entity_id, coalesce(p_meta,'{}'))
$$;

-- Link a freshly signed-in auth user to their invited member row by email.
create or replace function claim_membership() returns members
language plpgsql security definer set search_path = public as $$
declare m members;
begin
  update members set auth_user_id = auth.uid(),
         status = case when status = 'invited' then 'active' else status end
  where lower(email) = lower((select email from auth.users where id = auth.uid()))
    and (auth_user_id is null or auth_user_id = auth.uid())
  returning * into m;
  return m;
end $$;

-- =====================================================================
--  Money rules (server-side, treasurer only)
-- =====================================================================
create or replace function confirm_contribution(p_id uuid, p_note text default '')
returns contributions language plpgsql security definer set search_path = public as $$
declare c contributions; s settings; m members; tier jsonb; bonus_rate numeric;
        to_circle numeric; backing numeric; base_pts int; bonus_pts int; bonus_cost numeric; streak_n int; streak_pts int;
begin
  if not has_role('treasurer','admin') then raise exception 'Only the treasurer can confirm money'; end if;
  select * into c from contributions where id = p_id for update;
  if c.id is null then raise exception 'No such contribution'; end if;
  if c.status <> 'pending' then raise exception 'Contribution is not pending'; end if;
  select * into s from settings where id = 1;
  select * into m from members where id = c.member_id;
  select t into tier from jsonb_array_elements(s.tiers) t where (t->>'monthlyUsd')::int = m.monthly_usd limit 1;
  bonus_rate := coalesce((tier->>'bonusRate')::numeric, 0);
  to_circle := round(c.amount_usd * s.service_rate, 2);
  backing   := round(c.amount_usd - to_circle, 2);
  base_pts  := round(backing * s.points_per_dollar);
  bonus_pts := round(c.amount_usd * bonus_rate * s.points_per_dollar);   -- % of gross
  bonus_cost := round(bonus_pts / s.points_per_dollar, 2);
  update contributions set status='confirmed', reviewed_by=current_member_id(), reviewed_at=now(), reason=p_note,
         to_circle_usd=to_circle, backing_usd=backing, points=base_pts+bonus_pts, bonus_points=bonus_pts, bonus_cost_usd=bonus_cost
  where id = p_id returning * into c;
  insert into ledger(member_id, kind, points, usd, ref_type, ref_id, note)
    values (c.member_id, 'earn', base_pts, backing, 'contribution', c.id, c.for_month || ' contribution confirmed');
  if bonus_pts > 0 then
    insert into ledger(member_id, kind, points, usd, ref_type, ref_id, note)
      values (c.member_id, 'bonus', bonus_pts, bonus_cost, 'contribution', c.id, 'Tier bonus ' || round(bonus_rate*100) || '% of $' || c.amount_usd);
  end if;
  -- streak bonus: Nth consecutive confirmed month, once per milestone
  select count(*) into streak_n from (
    with recursive months as (
      select c.for_month as m, 1 as n
      union all
      select to_char((to_date(months.m || '-01','YYYY-MM-DD') - interval '1 month')::date, 'YYYY-MM'), n + 1 from months
      where exists (select 1 from contributions x where x.member_id = c.member_id and x.status = 'confirmed'
                    and x.for_month = to_char((to_date(months.m || '-01','YYYY-MM-DD') - interval '1 month')::date, 'YYYY-MM'))
        and n < 120
    ) select 1 from months) q;
  streak_pts := (s.streak_bonuses ->> streak_n::text)::int;
  if streak_pts is not null and not exists (select 1 from ledger l where l.member_id = c.member_id and l.ref_type = 'streak' and l.note = streak_n || '-month streak bonus') then
    insert into ledger(member_id, kind, points, usd, ref_type, ref_id, note)
      values (c.member_id, 'bonus', streak_pts, round(streak_pts / s.points_per_dollar, 2), 'streak', c.id, streak_n || '-month streak bonus');
  end if;
  perform log_audit('contribution.confirm', 'contribution', c.id::text, jsonb_build_object('points', c.points, 'amountUsd', c.amount_usd));
  return c;
end $$;

create or replace function reject_contribution(p_id uuid, p_reason text)
returns contributions language plpgsql security definer set search_path = public as $$
declare c contributions;
begin
  if not has_role('treasurer','admin') then raise exception 'Only the treasurer can reject money'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'A reason is required'; end if;
  update contributions set status='rejected', reviewed_by=current_member_id(), reviewed_at=now(), reason=trim(p_reason)
  where id = p_id and status = 'pending' returning * into c;
  if c.id is null then raise exception 'Contribution is not pending'; end if;
  perform log_audit('contribution.reject', 'contribution', c.id::text, jsonb_build_object('reason', c.reason));
  return c;
end $$;

-- =====================================================================
--  Balances
-- =====================================================================
create or replace function ledger_balance(p_member uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(points),0)::int from ledger where member_id = p_member
$$;
create or replace function held_points(p_member uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(points),0)::int from redemptions where member_id = p_member and status = 'approved'
$$;
create or replace function available_points(p_member uuid) returns int
language sql stable security definer set search_path = public as $$
  select ledger_balance(p_member) - held_points(p_member)
$$;


-- Season of a night: peak (Dec 20 – Jan 3, Carnival week), high (Jan 4 – Apr 5), low (Apr 6 – Dec 19)
create or replace function easter_sunday(y int) returns date language sql immutable as $$
  select make_date(y, (h + l - 7*m + 114) / 31, ((h + l - 7*m + 114) % 31) + 1) from (
    select a, b, c, d, e, f, g, h, i, k, l, (a + 11*h + 22*l) / 451 as m from (
      select a, b, c, d, e, f, g, h, i, k, (32 + 2*e + 2*i - h - k) % 7 as l from (
        select a, b, c, d, e, f, g, (19*a + b - d - g + 15) % 30 as h, c / 4 as i, c % 4 as k from (
          select y % 19 as a, y / 100 as b, y % 100 as c, (y/100)/4 as d, (y/100) % 4 as e, ((y/100) + 8)/25 as f, ((y/100) - ((y/100)+8)/25 + 1)/3 as g
        ) q1 ) q2 ) q3 ) q4
$$;
create or replace function season_for(d date) returns text language plpgsql immutable as $$
declare md int; ash date; parade date;
begin
  md := extract(month from d)::int * 100 + extract(day from d)::int;
  if md >= 1220 or md <= 103 then return 'peak'; end if;
  ash := easter_sunday(extract(year from d)::int) - 46;
  parade := ash - 3;
  if d >= parade - 7 and d < ash + 1 then return 'peak'; end if;
  if md >= 104 and md <= 405 then return 'high'; end if;
  return 'low';
end $$;

-- =====================================================================
--  Redemption rules (planner / admin decide; member requests & cancels)
-- =====================================================================
create or replace function request_redemption(p_stay uuid, p_check_in date, p_check_out date, p_guests int default 2, p_note text default '')
returns redemptions language plpgsql security definer set search_path = public as $$
declare st stays; s settings; me uuid; n int; full_pts int := 0; avail int; r redemptions; d date; sea text;
        n_low int := 0; n_high int := 0; n_peak int := 0; rate numeric; min_n int; open_count int;
begin
  me := current_member_id();
  if me is null then raise exception 'Not a member'; end if;
  select * into st from stays where id = p_stay and active;
  if st.id is null then raise exception 'No such stay'; end if;
  n := p_check_out - p_check_in;
  if n < 1 then raise exception 'Check-out must be after check-in'; end if;
  select * into s from settings where id = 1;
  d := p_check_in;
  while d < p_check_out loop
    sea := season_for(d);
    rate := case sea when 'peak' then st.rate_peak_usd when 'high' then st.rate_high_usd else st.rate_low_usd end;
    full_pts := full_pts + round(rate * s.points_per_dollar);
    if sea = 'peak' then n_peak := n_peak + 1; elsif sea = 'high' then n_high := n_high + 1; else n_low := n_low + 1; end if;
    d := d + 1;
  end loop;
  min_n := case when n_peak > 0 then greatest(st.min_nights, st.peak_min_nights) else st.min_nights end;
  if n < min_n then raise exception 'Minimum % nights for these dates', min_n; end if;
  select count(*) into open_count from redemptions where member_id = me and status in ('requested','approved','confirmed');
  if open_count >= 2 then raise exception 'You can hold 2 open trips at a time'; end if;
  avail := greatest(available_points(me), 0);
  insert into redemptions(member_id, stay_id, check_in, check_out, nights, guests, note, points, full_points, cash_top_up_usd, seasons)
    values (me, p_stay, p_check_in, p_check_out, n, p_guests, p_note, least(full_pts, avail), full_pts,
            round(greatest(full_pts - avail, 0) / s.points_per_dollar, 2), jsonb_build_object('low', n_low, 'high', n_high, 'peak', n_peak))
    returning * into r;
  perform log_audit('redemption.request', 'redemption', r.id::text, jsonb_build_object('stay', st.name, 'nights', n, 'points', full_pts));
  return r;
end $$;

create or replace function approve_redemption(p_id uuid, p_note text default '')
returns redemptions language plpgsql security definer set search_path = public as $$
declare r redemptions;
begin
  if not has_role('planner','admin') then raise exception 'Only planners can approve stays'; end if;
  select * into r from redemptions where id = p_id for update;
  if r.status <> 'requested' then raise exception 'Request is not open'; end if;
  if available_points(r.member_id) < r.points then raise exception 'Member no longer has enough points'; end if;
  update redemptions set status='approved', decided_by=current_member_id(), decided_at=now(), decision=p_note where id=p_id returning * into r;
  perform log_audit('redemption.approve', 'redemption', r.id::text, jsonb_build_object('points', r.points));
  return r;
end $$;

create or replace function confirm_redemption(p_id uuid, p_confirmation_ref text default '')
returns redemptions language plpgsql security definer set search_path = public as $$
declare r redemptions; s settings; st stays;
begin
  if not has_role('planner','admin') then raise exception 'Only planners can confirm stays'; end if;
  select * into r from redemptions where id = p_id for update;
  if r.status not in ('approved','requested') then raise exception 'Request cannot be confirmed'; end if;
  if r.status = 'requested' and available_points(r.member_id) < r.points then raise exception 'Member no longer has enough points'; end if;
  select * into s from settings where id = 1;
  select * into st from stays where id = r.stay_id;
  update redemptions set status='confirmed', decided_by=coalesce(decided_by, current_member_id()), decided_at=coalesce(decided_at, now()),
         confirmed_at=now(), confirmation_ref=p_confirmation_ref where id=p_id returning * into r;
  insert into ledger(member_id, kind, points, usd, ref_type, ref_id, note)
    values (r.member_id, 'redeem', -r.points, -round(r.points / s.points_per_dollar, 2), 'redemption', r.id, coalesce(st.name,'Stay') || ' · ' || r.nights || ' nights');
  perform log_audit('redemption.confirm', 'redemption', r.id::text, jsonb_build_object('points', r.points, 'confirmationRef', p_confirmation_ref));
  return r;
end $$;

create or replace function complete_redemption(p_id uuid)
returns redemptions language plpgsql security definer set search_path = public as $$
declare r redemptions;
begin
  if not has_role('planner','admin') then raise exception 'Only planners can complete stays'; end if;
  update redemptions set status='completed', completed_at=now() where id=p_id and status='confirmed' returning * into r;
  if r.id is null then raise exception 'Only confirmed stays can be completed'; end if;
  perform log_audit('redemption.complete', 'redemption', r.id::text, '{}');
  return r;
end $$;

create or replace function decline_redemption(p_id uuid, p_reason text)
returns redemptions language plpgsql security definer set search_path = public as $$
declare r redemptions;
begin
  if not has_role('planner','admin') then raise exception 'Only planners can decline stays'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'A reason is required'; end if;
  update redemptions set status='declined', decided_by=current_member_id(), decided_at=now(), decision=trim(p_reason)
  where id=p_id and status='requested' returning * into r;
  if r.id is null then raise exception 'Request is not open'; end if;
  perform log_audit('redemption.decline', 'redemption', r.id::text, jsonb_build_object('reason', r.decision));
  return r;
end $$;

create or replace function cancel_redemption(p_id uuid, p_reason text default '')
returns redemptions language plpgsql security definer set search_path = public as $$
declare r redemptions; s settings; st stays; me uuid;
begin
  me := current_member_id();
  select * into r from redemptions where id = p_id for update;
  if r.id is null then raise exception 'No such request'; end if;
  if r.member_id <> me and not has_role('planner','admin') then raise exception 'Not your request'; end if;
  if r.status in ('requested','approved') then
    update redemptions set status='cancelled', decided_by=me, decided_at=now(), decision=p_reason where id=p_id returning * into r;
  elsif r.status = 'confirmed' and has_role('planner','admin') then
    select * into s from settings where id = 1;
    select * into st from stays where id = r.stay_id;
    update redemptions set status='cancelled', decided_by=me, decided_at=now(), decision=p_reason where id=p_id returning * into r;
    insert into ledger(member_id, kind, points, usd, ref_type, ref_id, note)
      values (r.member_id, 'refund', r.points, round(r.points / s.points_per_dollar, 2), 'redemption', r.id, 'Refund · ' || coalesce(st.name,'Stay'));
  else
    raise exception 'Request cannot be cancelled';
  end if;
  perform log_audit('redemption.cancel', 'redemption', r.id::text, jsonb_build_object('reason', p_reason));
  return r;
end $$;

create or replace function adjust_points(p_member uuid, p_points int, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare s settings;
begin
  if not has_role('admin') then raise exception 'Only an admin can adjust points'; end if;
  if coalesce(trim(p_note),'') = '' then raise exception 'A note is required'; end if;
  select * into s from settings where id = 1;
  insert into ledger(member_id, kind, points, usd, ref_type, note) values (p_member, 'adjust', p_points, round(p_points / s.points_per_dollar, 2), 'adjust', trim(p_note));
  perform log_audit('ledger.adjust', 'member', p_member::text, jsonb_build_object('points', p_points, 'note', p_note));
end $$;

-- =====================================================================
--  Row-level security
-- =====================================================================
-- Signed-out visitors get nothing; the browser never writes the ledger or redemptions directly.
revoke all on all tables in schema public from anon;
revoke insert, update, delete on ledger, redemptions, audit from authenticated;
alter table settings      enable row level security;
alter table members       enable row level security;
alter table contributions enable row level security;
alter table ledger        enable row level security;
alter table stays         enable row level security;
alter table redemptions   enable row level security;
alter table announcements enable row level security;
alter table audit         enable row level security;

-- settings: everyone signed in reads; admin writes
drop policy if exists settings_read on settings;
create policy settings_read on settings for select to authenticated using (true);
drop policy if exists settings_write on settings;
create policy settings_write on settings for update to authenticated using (has_role('admin')) with check (has_role('admin'));

-- members: every member sees the circle (names, tiers, roles); only admin edits others; you may edit your own contact fields
drop policy if exists members_read on members;
create policy members_read on members for select to authenticated using (current_member_id() is not null);
drop policy if exists members_admin_write on members;
create policy members_admin_write on members for all to authenticated using (has_role('admin')) with check (has_role('admin'));
drop policy if exists members_self_update on members;
create policy members_self_update on members for update to authenticated using (auth_user_id = auth.uid()) with check (auth_user_id = auth.uid());

-- contributions: members see their own; treasurer/planner/admin see all; members insert their own pending rows; withdraw own pending
drop policy if exists contributions_read on contributions;
create policy contributions_read on contributions for select to authenticated
  using (member_id = current_member_id() or has_role('treasurer','planner','admin'));
drop policy if exists contributions_insert on contributions;
create policy contributions_insert on contributions for insert to authenticated
  with check (member_id = current_member_id() and status = 'pending' and points is null and to_circle_usd is null);
drop policy if exists contributions_withdraw on contributions;
create policy contributions_withdraw on contributions for update to authenticated
  using (member_id = current_member_id() and status = 'pending')
  with check (member_id = current_member_id() and status = 'withdrawn');

-- ledger: read own; treasurer/planner/admin read all; NO direct writes (functions only)
drop policy if exists ledger_read on ledger;
create policy ledger_read on ledger for select to authenticated
  using (member_id = current_member_id() or has_role('treasurer','planner','admin'));

-- stays: all members read active; planners/admin write
drop policy if exists stays_read on stays;
create policy stays_read on stays for select to authenticated using (active or has_role('planner','admin'));
drop policy if exists stays_write on stays;
create policy stays_write on stays for all to authenticated using (has_role('planner','admin')) with check (has_role('planner','admin'));

-- redemptions: read own; planners/treasurer/admin read all; writes only via functions
drop policy if exists redemptions_read on redemptions;
create policy redemptions_read on redemptions for select to authenticated
  using (member_id = current_member_id() or has_role('planner','treasurer','admin'));

-- announcements: all read; comms/planner/admin write
drop policy if exists announcements_read on announcements;
create policy announcements_read on announcements for select to authenticated using (current_member_id() is not null);
drop policy if exists announcements_write on announcements;
create policy announcements_write on announcements for all to authenticated
  using (has_role('comms','planner','admin')) with check (has_role('comms','planner','admin'));

-- audit: treasurer/admin read
drop policy if exists audit_read on audit;
create policy audit_read on audit for select to authenticated using (has_role('treasurer','admin'));

-- =====================================================================
--  Storage bucket for transfer proofs (private)
-- =====================================================================
insert into storage.buckets (id, name, public) values ('proofs','proofs', false) on conflict do nothing;
drop policy if exists proofs_upload on storage.objects;
create policy proofs_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'proofs' and (storage.foldername(name))[1] = current_member_id()::text);
drop policy if exists proofs_read on storage.objects;
create policy proofs_read on storage.objects for select to authenticated
  using (bucket_id = 'proofs' and ((storage.foldername(name))[1] = current_member_id()::text or has_role('treasurer','admin')));

-- =====================================================================
--  Realtime (treasurer inbox / member home update live)
-- =====================================================================
do $$ begin
  alter publication supabase_realtime add table contributions, redemptions, ledger, announcements;
exception when others then null; end $$;
