-- =====================================================================
--  Hunto — the Inner Circle
--  Schema, row-level security and the money rules, for Supabase/Postgres.
--
--  Apply once in the SQL editor. Everything that touches money runs inside a
--  SECURITY DEFINER function with a role check on its first line, so a browser
--  can never mint a point, edit the ledger, or confirm its own transfer.
--
--  These rules are the same ones in js/core/money.js and js/core/store.js.
--  If you change one, change the other.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- enums ----------
do $$ begin create type member_role as enum ('member','treasurer','deputy','planner','comms','admin');
exception when duplicate_object then null; end $$;
do $$ begin create type member_status as enum ('invited','active','paused','inactive','left');
exception when duplicate_object then null; end $$;
do $$ begin create type contribution_status as enum ('pending','confirmed','rejected','withdrawn','reversed');
exception when duplicate_object then null; end $$;
do $$ begin create type redemption_status as enum ('requested','quoted','held','confirmed','completed','declined','expired','cancelled');
exception when duplicate_object then null; end $$;
do $$ begin create type ledger_kind as enum ('earn','bonus','streak','founding','burn','refund','adjust','expire','reverse');
exception when duplicate_object then null; end $$;

-- ---------- settings (one row) ----------
create table if not exists settings (
  id                int primary key default 1 check (id = 1),
  club_name         text not null default 'Hunto',
  service_rate      numeric(5,4) not null default 0.15,
  points_per_dollar int not null default 100,
  awg_per_usd       numeric(6,3) not null default 1.79,
  tiers             jsonb not null default
    '[{"id":"t100","monthlyUsd":100,"bonusRate":0,"holds":1,"guestCerts":2,"windowMonths":10,"firstLookHours":0},
      {"id":"t150","monthlyUsd":150,"bonusRate":0.02,"holds":2,"guestCerts":3,"windowMonths":12,"firstLookHours":48},
      {"id":"t200","monthlyUsd":200,"bonusRate":0.04,"holds":2,"guestCerts":4,"windowMonths":13,"firstLookHours":72}]',
  streak_bonuses    jsonb not null default '{"6":1000,"12":2500,"24":5000}',
  founding_bonus    int not null default 2000,
  founding_seats    int not null default 20,
  promo_cap_rate    numeric(4,2) not null default 0.40,
  bonus_expire_months int not null default 24,
  quote_hours       int not null default 72,
  sla_hours         int not null default 72,
  banker_sla_hours  int not null default 48,
  undo_seconds      int not null default 60,
  close_tolerance_usd numeric(8,2) not null default 5,
  exit_fee_usd      numeric(8,2) not null default 25,
  member_cap        int not null default 40,
  due_day           int not null default 5,
  reserve_account   jsonb not null default '{}',   -- {bank, holder, number}
  operating_account jsonb not null default '{}',
  reserve_verified  jsonb,                          -- {balanceUsd, at, byId} — set at each month close
  whatsapp_group_url text,
  wallet            jsonb not null default '{}',      -- {url, token} for the pass service
  rules_version     text not null default '1.0',
  rules_date        date not null default '2026-09-05',
  updated_at        timestamptz not null default now()
);
insert into settings (id) values (1) on conflict do nothing;

-- ---------- members ----------
create table if not exists members (
  id             uuid primary key default gen_random_uuid(),
  auth_user_id   uuid unique references auth.users(id) on delete set null,
  email          text unique,
  name           text not null,
  phone          text,
  roles          member_role[] not null default '{member}',
  status         member_status not null default 'invited',
  monthly_usd    int not null default 100 check (monthly_usd in (100,150,200)),
  hue            int not null default 200,
  home           text,
  title          text,
  joined_at      timestamptz not null default now(),
  founding       boolean not null default false,
  sponsor_id     uuid references members(id),
  card_code      text unique,
  household      jsonb not null default '[]',
  preferences    jsonb not null default '{}',
  standing_order boolean not null default false,
  show_on_rollcall boolean not null default false,
  paused_until   text,                              -- 'YYYY-MM'
  paused_months  text[] not null default '{}',      -- a pause freezes a streak; it does not reset it
  dream_stay_id  uuid,
  left_at        timestamptz,
  notes          text
);

-- ---------- invitations ----------
create table if not exists invitations (
  code         text primary key,
  email        text,
  name         text,
  sponsor_id   uuid references members(id),
  monthly_usd  int not null default 100,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '1 month',
  accepted_member_id uuid references members(id)
);

-- ---------- contributions ----------
create table if not exists contributions (
  id             uuid primary key default gen_random_uuid(),
  member_id      uuid not null references members(id) on delete cascade,
  for_month      text not null check (for_month ~ '^\d{4}-\d{2}$'),
  expected_usd   numeric(10,2) not null check (expected_usd > 0),
  received_usd   numeric(10,2),
  currency       text not null default 'USD',
  received_native numeric(12,2),
  method         text not null default 'bank',
  bank           text,
  reference      text,
  note           text,
  proof_path     text,                               -- object in the private `proofs` bucket
  sent_on        date,
  submitted_at   timestamptz not null default now(),
  status         contribution_status not null default 'pending',
  reviewed_by    uuid references members(id),
  reviewed_at    timestamptz,
  reason         text,
  share_usd      numeric(10,2),
  backing_usd    numeric(10,2),
  base_points    int,
  bonus_points   int default 0,
  streak_points  int default 0,
  founding_points int default 0,
  points         int,
  full_amount    boolean,                            -- did the whole tier amount arrive?
  reversed_of    uuid references contributions(id)
);
create index if not exists contributions_member_idx on contributions(member_id, submitted_at desc);
create index if not exists contributions_status_idx on contributions(status);
-- One live submission per member per month; a returned or withdrawn one can be re-sent.
create unique index if not exists contributions_one_per_month
  on contributions(member_id, for_month) where status in ('pending','confirmed');

-- ---------- the ledger (append-only) ----------
create table if not exists ledger (
  id         bigserial primary key,
  member_id  uuid not null references members(id) on delete cascade,
  kind       ledger_kind not null,
  points     int not null check (points <> 0),
  usd        numeric(10,2),
  ref_type   text,
  ref_id     uuid,
  note       text,
  by_id      uuid references members(id),
  expires_at timestamptz,                            -- promotional points only
  at         timestamptz not null default now()
);
create index if not exists ledger_member_idx on ledger(member_id, at desc);

-- Corrections are new lines with a reason; nothing is ever edited or deleted.
create or replace function ledger_is_append_only() returns trigger
language plpgsql as $$ begin raise exception 'The points ledger is append-only'; end $$;
drop trigger if exists ledger_no_edit on ledger;
create trigger ledger_no_edit before update or delete on ledger
  for each row execute function ledger_is_append_only();

-- ---------- promotional points deferred by the monthly cap ----------
create table if not exists promo_deferrals (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references members(id) on delete cascade,
  kind       ledger_kind not null,
  points     int not null,
  reason     text not null default 'cap',
  for_month  text not null,
  ref_id     uuid,
  minted_at  timestamptz
);

-- ---------- the catalog: stays on the island, and trips ----------
create table if not exists stays (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null default 'aruba' check (kind in ('aruba','trip')),
  name            text not null,
  area            text,
  country         text not null default 'Aruba',
  category        text,
  vibe            text,
  features        text[] not null default '{}',
  deal_note       text,
  -- stays: the Circle's all-in cost per night, per season (points = usd × points_per_dollar)
  rate_low_usd    numeric(10,2),
  rate_high_usd   numeric(10,2),
  rate_peak_usd   numeric(10,2),
  retail_usd      numeric(10,2),
  min_nights      int not null default 2,
  peak_min_nights int not null default 7,
  on_sand         boolean not null default true,
  adults_only     boolean not null default false,
  all_inclusive   boolean not null default false,
  taxes_included  boolean not null default false,
  -- trips
  starts_on       date,
  ends_on         date,
  nights          int,
  points_per_seat int,
  guest_cash_usd  numeric(10,2),
  seats           int,
  hold_deadline   date,
  is_drop         boolean not null default false,
  active          boolean not null default true,
  curated_by      uuid references members(id),
  created_at      timestamptz not null default now(),
  check (kind <> 'aruba' or (rate_low_usd > 0 and rate_high_usd > 0 and rate_peak_usd > 0)),
  check (kind <> 'trip' or (points_per_seat > 0 and starts_on is not null))
);

-- ---------- redemptions: Request → Quote → Hold → Paid → Completed ----------
create table if not exists redemptions (
  id                uuid primary key default gen_random_uuid(),
  member_id         uuid not null references members(id) on delete cascade,
  stay_id           uuid not null references stays(id),
  kind              text not null default 'stay',
  check_in          date not null,
  check_out         date not null,
  nights            int not null check (nights > 0),
  guests            int not null default 2,
  seats             int,
  flex_days         int not null default 0,
  note              text,
  indicative_points int,
  seasons           jsonb not null default '{}',
  retail_usd        numeric(10,2),
  points            int not null default 0,          -- points committed from the balance
  quoted_points     int,                             -- the binding all-in price
  quote_stack       jsonb,
  top_up_usd        numeric(10,2) not null default 0,
  top_up_confirmed  boolean not null default false,
  hotel_terms       text,
  hotel_deadline    date,
  quoted_by         uuid references members(id),
  quoted_at         timestamptz,
  quote_expires_at  timestamptz,
  status            redemption_status not null default 'requested',
  requested_at      timestamptz not null default now(),
  decided_by        uuid references members(id),
  decided_at        timestamptz,
  decision          text,
  held_at           timestamptz,
  confirmed_at      timestamptz,
  completed_at      timestamptz,
  paid_usd          numeric(10,2),
  penalty_points    int,
  confirmation_ref  text,
  shared            boolean not null default false,   -- open for the Circle to chip in
  check (check_out > check_in)
);

-- ---------- chipping in: other members' points on someone else's booking ----------
create table if not exists pledges (
  id            uuid primary key default gen_random_uuid(),
  redemption_id uuid not null references redemptions(id) on delete cascade,
  member_id     uuid not null references members(id) on delete cascade,
  points        int not null check (points > 0),
  at            timestamptz not null default now(),
  unique (redemption_id, member_id)
);
create index if not exists pledges_member_idx on pledges(member_id);
create index if not exists redemptions_member_idx on redemptions(member_id, requested_at desc);
create index if not exists redemptions_status_idx on redemptions(status);

-- ---------- notes from the Voice of the Circle ----------
create table if not exists announcements (
  id        uuid primary key default gen_random_uuid(),
  author_id uuid references members(id),
  title     text not null,
  body      text not null,
  kind      text not null default 'note',
  pinned    boolean not null default false,
  at        timestamptz not null default now()
);

-- ---------- month closes and the audit trail ----------
create table if not exists month_closes (
  id                 uuid primary key default gen_random_uuid(),
  month              text not null unique,
  closed_by          uuid not null references members(id),
  cosigned_by        uuid not null references members(id),
  bank_balance_usd   numeric(12,2) not null,
  ledger_reserve_usd numeric(12,2) not null,
  variance_usd       numeric(12,2) not null,
  coverage           numeric(8,5) not null,
  gross_usd          numeric(12,2),
  share_usd          numeric(12,2),
  confirmed_count    int,
  missing_count      int,
  note               text,
  closed_at          timestamptz not null default now(),
  check (closed_by <> cosigned_by)
);

create table if not exists audit (
  id        bigserial primary key,
  actor_id  uuid references members(id),
  action    text not null,
  entity    text not null,
  entity_id text,
  meta      jsonb not null default '{}',
  at        timestamptz not null default now()
);

create table if not exists rules_acceptances (
  member_id uuid not null references members(id) on delete cascade,
  version   text not null,
  at        timestamptz not null default now(),
  primary key (member_id, version)
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
  select exists (select 1 from members m where m.auth_user_id = auth.uid() and m.roles && wanted)
$$;

create or replace function log_audit(p_action text, p_entity text, p_entity_id text, p_meta jsonb default '{}')
returns void language sql security definer set search_path = public as $$
  insert into audit(actor_id, action, entity, entity_id, meta)
  values (current_member_id(), p_action, p_entity, p_entity_id, coalesce(p_meta,'{}'))
$$;

-- Link a freshly signed-in account to the member row invited under that email.
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

-- ---------- balances ----------
create or replace function ledger_balance(p_member uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(points),0)::int from ledger where member_id = p_member
$$;
-- Points a member cannot spend twice: their own held booking, plus anything they have
-- chipped in to someone else's while that booking is live.
create or replace function committed_points(p_member uuid) returns int
language sql stable security definer set search_path = public as $$
  select (coalesce((select sum(points) from redemptions where member_id = p_member and status = 'held'),0)
        + coalesce((select sum(pl.points) from pledges pl join redemptions r on r.id = pl.redemption_id
                    where pl.member_id = p_member and r.status in ('quoted','held')),0))::int
$$;

-- Everything covered on a booking so far: the requester's own points plus every pledge.
create or replace function covered_points(p_redemption uuid) returns int
language sql stable security definer set search_path = public as $$
  select (coalesce((select points from redemptions where id = p_redemption),0)
        + coalesce((select sum(points) from pledges where redemption_id = p_redemption),0))::int
$$;
create or replace function available_points(p_member uuid) returns int
language sql stable security definer set search_path = public as $$
  select ledger_balance(p_member) - committed_points(p_member)
$$;

-- Consecutive confirmed full months ending at p_month. Paused months are stepped over.
create or replace function consecutive_months(p_member uuid, p_month text) returns int
language plpgsql stable security definer set search_path = public as $$
declare n int := 0; m text := p_month; joined text; paused text[];
begin
  select to_char(joined_at,'YYYY-MM'), paused_months into joined, paused from members where id = p_member;
  while m >= coalesce(joined,'0000-00') loop
    if exists (select 1 from contributions c where c.member_id = p_member and c.for_month = m
               and c.status = 'confirmed' and c.full_amount) then
      n := n + 1;
    elsif not (m = any(coalesce(paused,'{}'))) then
      exit;
    end if;
    m := to_char((to_date(m || '-01','YYYY-MM-DD') - interval '1 month')::date, 'YYYY-MM');
  end loop;
  return n;
end $$;

-- ---------- seasons: Summer Apr 6–Dec 19 · Winter Jan 4–Apr 5 · Peak Dec 20–Jan 3 and Carnival week ----------
create or replace function easter_sunday(y int) returns date language plpgsql immutable as $$
declare a int; b int; c int; d int; e int; f int; g int; h int; i int; k int; l int; m int; mo int; da int;
begin
  a := y % 19; b := y / 100; c := y % 100; d := b / 4; e := b % 4;
  f := (b + 8) / 25; g := (b - f + 1) / 3; h := (19*a + b - d - g + 15) % 30;
  i := c / 4; k := c % 4; l := (32 + 2*e + 2*i - h - k) % 7; m := (a + 11*h + 22*l) / 451;
  mo := (h + l - 7*m + 114) / 31; da := ((h + l - 7*m + 114) % 31) + 1;
  return make_date(y, mo, da);
end $$;

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

-- The all-in points price for a stay over a range, plus the minimum that applies.
create or replace function quote_points(p_stay uuid, p_in date, p_out date, p_seats int default 1,
  out points int, out min_nights int, out nights int, out seasons jsonb)
language plpgsql stable security definer set search_path = public as $$
declare st stays; s settings; d date; sea text; rate numeric; n_low int := 0; n_high int := 0; n_peak int := 0;
begin
  select * into st from stays where id = p_stay;
  if st.id is null then raise exception 'No such stay'; end if;
  select * into s from settings where id = 1;
  if st.kind = 'trip' then
    points := st.points_per_seat * greatest(p_seats,1);
    nights := st.nights; min_nights := st.nights;
    seasons := '{}'::jsonb;
    return;
  end if;
  points := 0; nights := p_out - p_in; d := p_in;
  while d < p_out loop
    sea := season_for(d);
    rate := case sea when 'peak' then st.rate_peak_usd when 'high' then st.rate_high_usd else st.rate_low_usd end;
    points := points + round(rate * s.points_per_dollar);
    if sea = 'peak' then n_peak := n_peak + 1; elsif sea = 'high' then n_high := n_high + 1; else n_low := n_low + 1; end if;
    d := d + 1;
  end loop;
  min_nights := case when n_peak > 0 then greatest(st.min_nights, st.peak_min_nights) else st.min_nights end;
  seasons := jsonb_build_object('low', n_low, 'high', n_high, 'peak', n_peak);
end $$;

-- =====================================================================
--  Money. Only the Banker mints; only the Desk quotes.
-- =====================================================================

-- How many promotional points may still be minted for a month (40% of that month's share).
create or replace function promo_room(p_month text) returns int
language sql stable security definer set search_path = public as $$
  select greatest(0, floor(
      coalesce((select sum(c.share_usd) from contributions c where c.for_month = p_month and c.status = 'confirmed'),0)
        * (select points_per_dollar * promo_cap_rate from settings where id = 1)
      - coalesce((select sum(l.points) from ledger l
                  join contributions c2 on c2.id = l.ref_id and l.ref_type = 'contribution'
                  where l.kind in ('bonus','streak','founding') and c2.for_month = p_month),0)
    ))::int
$$;

create or replace function confirm_contribution(p_id uuid, p_received_usd numeric default null,
  p_currency text default 'USD', p_native numeric default null, p_note text default '')
returns contributions language plpgsql security definer set search_path = public as $$
declare c contributions; s settings; m members; tier jsonb; bonus_rate numeric; received numeric;
        share numeric; backing numeric; base_pts int; bonus_pts int := 0; streak_pts int := 0; found_pts int := 0;
        is_full boolean; n_streak int; sb int; room int;
begin
  if not has_role('treasurer','deputy','admin') then raise exception 'Only the Banker can confirm money'; end if;
  select * into c from contributions where id = p_id for update;
  if c.id is null then raise exception 'No such contribution'; end if;
  if c.status <> 'pending' then raise exception 'This contribution is not waiting for the Banker'; end if;
  select * into s from settings where id = 1;
  select * into m from members where id = c.member_id;
  received := round(coalesce(p_received_usd, c.expected_usd), 2);
  if received <= 0 then raise exception 'Received amount must be positive'; end if;

  share   := round(received * s.service_rate, 2);
  backing := round(received - share, 2);
  base_pts := round(backing * s.points_per_dollar);

  select t into tier from jsonb_array_elements(s.tiers) t where (t->>'monthlyUsd')::int = m.monthly_usd limit 1;
  bonus_rate := coalesce((tier->>'bonusRate')::numeric, 0);
  is_full := received + 0.005 >= m.monthly_usd;

  update contributions set status='confirmed', reviewed_by=current_member_id(), reviewed_at=now(), reason=p_note,
         received_usd=received, currency=p_currency, received_native=p_native,
         share_usd=share, backing_usd=backing, base_points=base_pts, full_amount=is_full
  where id = p_id returning * into c;

  insert into ledger(member_id, kind, points, usd, ref_type, ref_id, note, by_id)
    values (c.member_id, 'earn', base_pts, backing, 'contribution', c.id,
            to_char(to_date(c.for_month || '-01','YYYY-MM-DD'),'FMMonth YYYY') || ' contribution'
              || case when is_full then '' else ' · part of it' end,
            current_member_id());

  -- Promotional points are funded by the Circle out of its own share, and capped per month.
  if is_full and bonus_rate > 0 then
    bonus_pts := round(m.monthly_usd * bonus_rate * s.points_per_dollar);
    room := promo_room(c.for_month);
    if bonus_pts > room then
      insert into promo_deferrals(member_id, kind, points, reason, for_month, ref_id)
        values (c.member_id, 'bonus', bonus_pts, 'cap', c.for_month, c.id);
      bonus_pts := 0;
    else
      insert into ledger(member_id, kind, points, usd, ref_type, ref_id, note, by_id, expires_at)
        values (c.member_id, 'bonus', bonus_pts, round(bonus_pts::numeric / s.points_per_dollar, 2), 'contribution', c.id,
                (tier->>'id') || ' bonus ' || round(bonus_rate*100) || '% of $' || m.monthly_usd,
                current_member_id(), now() + make_interval(months => s.bonus_expire_months));
    end if;
  end if;

  if is_full then
    n_streak := consecutive_months(c.member_id, c.for_month);
    sb := (s.streak_bonuses ->> n_streak::text)::int;
    if sb is not null and not exists (
      select 1 from ledger l where l.member_id = c.member_id and l.kind = 'streak'
        and l.note = n_streak || ' consecutive contributions') then
      room := promo_room(c.for_month);
      if sb > room then
        insert into promo_deferrals(member_id, kind, points, reason, for_month, ref_id)
          values (c.member_id, 'streak', sb, 'cap', c.for_month, c.id);
      else
        streak_pts := sb;
        insert into ledger(member_id, kind, points, usd, ref_type, ref_id, note, by_id, expires_at)
          values (c.member_id, 'streak', sb, round(sb::numeric / s.points_per_dollar, 2), 'contribution', c.id,
                  n_streak || ' consecutive contributions', current_member_id(),
                  now() + make_interval(months => s.bonus_expire_months));
      end if;
    end if;
  end if;

  if m.founding and s.founding_bonus > 0
     and not exists (select 1 from ledger l where l.member_id = c.member_id and l.kind = 'founding') then
    room := promo_room(c.for_month);
    if s.founding_bonus > room then
      insert into promo_deferrals(member_id, kind, points, reason, for_month, ref_id)
        values (c.member_id, 'founding', s.founding_bonus, 'cap', c.for_month, c.id);
    else
      found_pts := s.founding_bonus;
      insert into ledger(member_id, kind, points, usd, ref_type, ref_id, note, by_id, expires_at)
        values (c.member_id, 'founding', found_pts, round(found_pts::numeric / s.points_per_dollar, 2), 'contribution', c.id,
                'Founding Insider · ' || to_char(m.joined_at,'YYYY'), current_member_id(),
                now() + make_interval(months => s.bonus_expire_months));
    end if;
  end if;

  update contributions set bonus_points = bonus_pts, streak_points = streak_pts, founding_points = found_pts,
         points = base_pts + bonus_pts + streak_pts + found_pts
  where id = p_id returning * into c;

  perform log_audit('contribution.confirm','contribution',c.id::text,
    jsonb_build_object('receivedUsd', received, 'points', c.points, 'full', is_full));
  return c;
end $$;

create or replace function reject_contribution(p_id uuid, p_reason text)
returns contributions language plpgsql security definer set search_path = public as $$
declare c contributions;
begin
  if not has_role('treasurer','deputy','admin') then raise exception 'Only the Banker can return a transfer'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'A reason is required so the member knows what to fix'; end if;
  update contributions set status='rejected', reviewed_by=current_member_id(), reviewed_at=now(), reason=trim(p_reason)
  where id = p_id and status = 'pending' returning * into c;
  if c.id is null then raise exception 'This contribution is not waiting for the Banker'; end if;
  perform log_audit('contribution.return','contribution',c.id::text, jsonb_build_object('reason', c.reason));
  return c;
end $$;

-- Undo, for a minute, by the officer who confirmed it: the whole transaction reverses
-- and the transfer goes back into the queue.
create or replace function reverse_contribution(p_id uuid)
returns contributions language plpgsql security definer set search_path = public as $$
declare c contributions; s settings; again contributions; l ledger;
begin
  if not has_role('treasurer','deputy','admin') then raise exception 'Only the Banker can undo a confirmation'; end if;
  select * into s from settings where id = 1;
  select * into c from contributions where id = p_id for update;
  if c.status <> 'confirmed' then raise exception 'This confirmation can no longer be undone'; end if;
  if c.reviewed_by <> current_member_id() then raise exception 'Only the officer who confirmed it can undo it'; end if;
  if now() - c.reviewed_at > make_interval(secs => s.undo_seconds) then
    raise exception 'This confirmation can no longer be undone';
  end if;
  for l in select * from ledger where ref_type = 'contribution' and ref_id = c.id loop
    insert into ledger(member_id, kind, points, usd, ref_type, ref_id, note, by_id)
      values (l.member_id, 'reverse', -l.points, -coalesce(l.usd,0), 'contribution', c.id, 'Reversal · ' || l.note, current_member_id());
  end loop;
  delete from promo_deferrals where ref_id = c.id and minted_at is null;
  update contributions set status = 'reversed' where id = c.id;
  insert into contributions (member_id, for_month, expected_usd, currency, method, bank, reference, note,
                             proof_path, sent_on, submitted_at, status, reversed_of)
    values (c.member_id, c.for_month, c.expected_usd, c.currency, c.method, c.bank, c.reference, c.note,
            c.proof_path, c.sent_on, c.submitted_at, 'pending', c.id)
    returning * into again;
  perform log_audit('contribution.reverse','contribution',c.id::text, jsonb_build_object('reopenedAs', again.id));
  return again;
end $$;

-- ---------- redemptions ----------
create or replace function request_redemption(p_stay uuid, p_check_in date, p_check_out date,
  p_guests int default 2, p_seats int default 1, p_note text default '', p_flex int default 0,
  p_shared boolean default false)
returns redemptions language plpgsql security definer set search_path = public as $$
declare st stays; s settings; m members; tier jsonb; me uuid; q record; r redemptions; open_count int; window_months int;
begin
  me := current_member_id();
  if me is null then raise exception 'Not a member'; end if;
  select * into st from stays where id = p_stay and active;
  if st.id is null then raise exception 'No such stay'; end if;
  select * into s from settings where id = 1;
  select * into m from members where id = me;
  select t into tier from jsonb_array_elements(s.tiers) t where (t->>'monthlyUsd')::int = m.monthly_usd limit 1;

  select * into q from quote_points(p_stay, coalesce(st.starts_on, p_check_in), coalesce(st.ends_on, p_check_out), p_seats);
  if q.nights < 1 then raise exception 'Check-out must be after check-in'; end if;
  if q.nights < q.min_nights then raise exception 'Minimum % nights for these dates', q.min_nights; end if;

  select count(*) into open_count from redemptions
    where member_id = me and status in ('requested','quoted','held');
  if open_count >= coalesce((tier->>'holds')::int, 1) then
    raise exception 'You can hold % open request(s) at a time', coalesce((tier->>'holds')::int, 1);
  end if;

  window_months := coalesce((tier->>'windowMonths')::int, 10);
  if st.kind = 'aruba' and p_check_in > (current_date + make_interval(months => window_months)) then
    raise exception 'Your tier can request up to % months ahead', window_months;
  end if;
  if st.kind = 'trip' and (select coalesce(sum(coalesce(seats,1)),0) from redemptions
      where stay_id = p_stay and status in ('requested','quoted','held','confirmed')) + p_seats > coalesce(st.seats, 99) then
    raise exception 'Not enough seats left on this trip';
  end if;

  insert into redemptions(member_id, stay_id, kind, check_in, check_out, nights, guests, seats, flex_days, note,
                          indicative_points, seasons, retail_usd, points, status, shared)
    values (me, p_stay, st.kind, coalesce(st.starts_on, p_check_in), coalesce(st.ends_on, p_check_out), q.nights,
            case when st.kind = 'trip' then p_seats else p_guests end,
            case when st.kind = 'trip' then p_seats else null end, p_flex, p_note,
            q.points, q.seasons, coalesce(st.retail_usd,0) * case when st.kind='trip' then p_seats else q.nights end,
            q.points, 'requested', p_shared)
    returning * into r;
  perform log_audit('redemption.request','redemption',r.id::text,
    jsonb_build_object('stay', st.name, 'nights', q.nights, 'points', q.points));
  return r;
end $$;

create or replace function quote_redemption(p_id uuid, p_points int, p_stack jsonb default null,
  p_terms text default '', p_deadline date default null, p_note text default '')
returns redemptions language plpgsql security definer set search_path = public as $$
declare r redemptions; s settings; st stays; avail int; covered int; pledged int;
begin
  select * into r from redemptions where id = p_id for update;
  if r.id is null then raise exception 'No such request'; end if;
  select * into st from stays where id = r.stay_id;
  if not (has_role('planner','admin') or (has_role('comms') and st.kind = 'trip')) then
    raise exception 'Only the Desk can quote a stay';
  end if;
  if r.status <> 'requested' then raise exception 'Only an open request can be quoted'; end if;
  if p_points <= 0 then raise exception 'A quote must be positive'; end if;
  select * into s from settings where id = 1;
  avail := greatest(available_points(r.member_id), 0);
  pledged := coalesce((select sum(points) from pledges where redemption_id = p_id), 0);
  covered := least(greatest(p_points - pledged, 0), avail);
  update redemptions set status='quoted', quoted_points=p_points, points=covered,
         top_up_usd = round(greatest(p_points - covered - pledged, 0)::numeric / s.points_per_dollar, 2),
         quote_stack=p_stack, hotel_terms=p_terms, hotel_deadline=p_deadline, decision=p_note,
         quoted_by=current_member_id(), quoted_at=now(),
         quote_expires_at = now() + make_interval(hours => s.quote_hours)
  where id = p_id returning * into r;
  perform log_audit('redemption.quote','redemption',r.id::text,
    jsonb_build_object('points', p_points, 'topUpUsd', r.top_up_usd));
  return r;
end $$;

create or replace function accept_quote(p_id uuid)
returns redemptions language plpgsql security definer set search_path = public as $$
declare r redemptions; s settings; avail int; pledged int;
begin
  select * into r from redemptions where id = p_id for update;
  if r.id is null then raise exception 'No such request'; end if;
  if r.member_id <> current_member_id() then raise exception 'Only the member can accept their quote'; end if;
  if r.status <> 'quoted' then raise exception 'There is no open quote to accept'; end if;
  if r.quote_expires_at < now() then
    update redemptions set status='expired', decided_at=now(),
           decision='Quote expired before it was accepted' where id = p_id;
    raise exception 'That quote has expired';
  end if;
  select * into s from settings where id = 1;
  pledged := coalesce((select sum(points) from pledges where redemption_id = p_id), 0);
  avail := greatest(available_points(r.member_id), 0);
  update redemptions set status='held', held_at=now(),
         points = least(r.points, avail),
         top_up_usd = round(greatest(r.quoted_points - least(r.points, avail) - pledged, 0)::numeric / s.points_per_dollar, 2)
  where id = p_id returning * into r;
  perform log_audit('redemption.hold','redemption',r.id::text,
    jsonb_build_object('points', r.points, 'topUpUsd', r.top_up_usd));
  return r;
end $$;

create or replace function confirm_top_up(p_id uuid)
returns redemptions language plpgsql security definer set search_path = public as $$
declare r redemptions;
begin
  if not has_role('treasurer','deputy','admin') then raise exception 'Only the Banker can confirm a top-up'; end if;
  update redemptions set top_up_confirmed = true where id = p_id returning * into r;
  if r.id is null then raise exception 'No such request'; end if;
  perform log_audit('redemption.topup','redemption',r.id::text, jsonb_build_object('topUpUsd', r.top_up_usd));
  return r;
end $$;

create or replace function pledge_to_redemption(p_id uuid, p_points int)
returns redemptions language plpgsql security definer set search_path = public as $$
declare r redemptions; s settings; me uuid; avail int; outstanding int; amount int;
begin
  me := current_member_id();
  if me is null then raise exception 'Not a member'; end if;
  select * into r from redemptions where id = p_id for update;
  if r.id is null then raise exception 'No such request'; end if;
  if not r.shared then raise exception 'This booking is not open for the Circle to chip in'; end if;
  if r.status not in ('quoted','held') then raise exception 'This booking is not taking contributions right now'; end if;
  if r.member_id = me then raise exception 'You are already covering your own share'; end if;
  if p_points <= 0 then raise exception 'Chip in at least one point'; end if;
  avail := available_points(me);
  if p_points > avail then raise exception 'You have % points available', avail; end if;
  outstanding := coalesce(r.quoted_points, r.indicative_points, 0) - covered_points(p_id);
  if outstanding <= 0 then raise exception 'This booking is already covered'; end if;
  amount := least(p_points, outstanding);
  insert into pledges(redemption_id, member_id, points) values (p_id, me, amount)
    on conflict (redemption_id, member_id) do update set points = pledges.points + excluded.points;
  select * into s from settings where id = 1;
  update redemptions set top_up_usd = round(greatest(0, coalesce(quoted_points,0) - covered_points(p_id))::numeric / s.points_per_dollar, 2)
    where id = p_id returning * into r;
  perform log_audit('redemption.pledge','redemption',p_id::text, jsonb_build_object('points', amount));
  return r;
end $$;

create or replace function withdraw_pledge(p_id uuid, p_member uuid default null)
returns redemptions language plpgsql security definer set search_path = public as $$
declare r redemptions; s settings; target uuid; n int;
begin
  target := coalesce(p_member, current_member_id());
  if target <> current_member_id() and not has_role('planner','admin') then raise exception 'Not your contribution'; end if;
  select * into r from redemptions where id = p_id for update;
  if r.id is null then raise exception 'No such request'; end if;
  if r.status in ('confirmed','completed') then raise exception 'The hotel is already paid'; end if;
  delete from pledges where redemption_id = p_id and member_id = target;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'You have not chipped in to this one'; end if;
  select * into s from settings where id = 1;
  update redemptions set top_up_usd = round(greatest(0, coalesce(quoted_points,0) - covered_points(p_id))::numeric / s.points_per_dollar, 2)
    where id = p_id returning * into r;
  perform log_audit('redemption.pledge.withdraw','redemption',p_id::text, jsonb_build_object('memberId', target));
  return r;
end $$;

create or replace function pay_redemption(p_id uuid, p_paid_usd numeric default null, p_confirmation text default '')
returns redemptions language plpgsql security definer set search_path = public as $$
declare r redemptions; s settings; st stays;
begin
  if not has_role('treasurer','deputy','planner','admin') then raise exception 'Only the Banker or the Desk can pay a hotel'; end if;
  select * into r from redemptions where id = p_id for update;
  if r.id is null then raise exception 'No such request'; end if;
  if r.status <> 'held' then raise exception 'The member has not accepted a quote yet'; end if;
  if r.top_up_usd > 0 and not r.top_up_confirmed then
    raise exception 'The top-up of $% has not been confirmed as received', to_char(r.top_up_usd,'FM999999.00');
  end if;
  select * into s from settings where id = 1;
  select * into st from stays where id = r.stay_id;
  update redemptions set status='confirmed', confirmed_at=now(), decided_by=current_member_id(), decided_at=now(),
         paid_usd = coalesce(p_paid_usd, round(r.quoted_points::numeric / s.points_per_dollar, 2)),
         confirmation_ref = p_confirmation
  where id = p_id returning * into r;
  if r.points > 0 then
    insert into ledger(member_id, kind, points, usd, ref_type, ref_id, note, by_id)
      values (r.member_id, 'burn', -r.points, -round(r.points::numeric / s.points_per_dollar, 2), 'redemption', r.id,
              st.name || ' · ' || r.nights || ' nights', current_member_id());
  end if;
  -- each person who chipped in burns their own share, from their own ledger
  insert into ledger(member_id, kind, points, usd, ref_type, ref_id, note, by_id)
    select pl.member_id, 'burn', -pl.points, -round(pl.points::numeric / s.points_per_dollar, 2), 'redemption', r.id,
           st.name || ' · chipped in for ' || split_part((select name from members where id = r.member_id), ' ', 1),
           current_member_id()
    from pledges pl where pl.redemption_id = r.id;
  perform log_audit('redemption.pay','redemption',r.id::text,
    jsonb_build_object('points', r.points, 'paidUsd', r.paid_usd, 'confirmationRef', p_confirmation));
  return r;
end $$;

create or replace function complete_redemption(p_id uuid)
returns redemptions language plpgsql security definer set search_path = public as $$
declare r redemptions;
begin
  if not has_role('planner','admin','treasurer') then raise exception 'Only the Desk can complete a stay'; end if;
  update redemptions set status='completed', completed_at=now() where id=p_id and status='confirmed' returning * into r;
  if r.id is null then raise exception 'Only a confirmed stay can be completed'; end if;
  perform log_audit('redemption.complete','redemption',r.id::text,'{}');
  return r;
end $$;

create or replace function decline_redemption(p_id uuid, p_reason text)
returns redemptions language plpgsql security definer set search_path = public as $$
declare r redemptions; st stays;
begin
  select * into r from redemptions where id = p_id;
  select * into st from stays where id = r.stay_id;
  if not (has_role('planner','admin') or (has_role('comms') and st.kind = 'trip')) then
    raise exception 'Only the Desk can decline a request';
  end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'A reason is required — the member reads it word for word'; end if;
  update redemptions set status='declined', decided_by=current_member_id(), decided_at=now(), decision=trim(p_reason)
  where id=p_id and status in ('requested','quoted') returning * into r;
  if r.id is null then raise exception 'This request cannot be declined now'; end if;
  perform log_audit('redemption.decline','redemption',r.id::text, jsonb_build_object('reason', r.decision));
  return r;
end $$;

create or replace function cancel_redemption(p_id uuid, p_reason text default '', p_penalty_points int default 0)
returns redemptions language plpgsql security definer set search_path = public as $$
declare r redemptions; s settings; st stays; me uuid; refund int;
begin
  me := current_member_id();
  select * into r from redemptions where id = p_id for update;
  if r.id is null then raise exception 'No such request'; end if;
  select * into s from settings where id = 1;
  select * into st from stays where id = r.stay_id;
  if r.status in ('requested','quoted','held') then
    if r.member_id <> me and not has_role('planner','admin','treasurer') then raise exception 'Not your request'; end if;
    update redemptions set status='cancelled', decided_by=me, decided_at=now(), decision=p_reason where id=p_id returning * into r;
  elsif r.status = 'confirmed' then
    if not has_role('planner','admin','treasurer') then raise exception 'Only the Desk or the Banker can cancel a booked stay'; end if;
    -- the hotel's penalty is shared in proportion to what each person put in
    declare covered int; penalty int; taken int := 0; part record; share int; n int; i int := 0;
    begin
      covered := covered_points(p_id);
      penalty := least(greatest(p_penalty_points,0), covered);
      update redemptions set status='cancelled', decided_by=me, decided_at=now(), decision=p_reason,
             penalty_points=penalty where id=p_id returning * into r;
      select count(*) into n from (
        select r.member_id as mid, r.points as pts where r.points > 0
        union all select pl.member_id, pl.points from pledges pl where pl.redemption_id = p_id) q;
      for part in select r.member_id as mid, r.points as pts where r.points > 0
                  union all select pl.member_id, pl.points from pledges pl where pl.redemption_id = p_id loop
        i := i + 1;
        share := case when i = n then penalty - taken else round(penalty * (part.pts::numeric / covered)) end;
        taken := taken + share;
        refund := greatest(0, part.pts - share);
        if refund > 0 then
          insert into ledger(member_id, kind, points, usd, ref_type, ref_id, note, by_id)
            values (part.mid, 'refund', refund, round(refund::numeric / s.points_per_dollar, 2), 'redemption', r.id,
                    'Refund · ' || st.name || case when share > 0 then ' · after a ' || share || ' point penalty' else '' end, me);
        end if;
      end loop;
    end;
  else
    raise exception 'This request cannot be cancelled';
  end if;
  perform log_audit('redemption.cancel','redemption',r.id::text,
    jsonb_build_object('reason', p_reason, 'penaltyPoints', p_penalty_points));
  return r;
end $$;

-- Quotes that were never accepted release themselves.
create or replace function release_expired_quotes() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update redemptions set status='expired', decided_at=now(), decision='Quote expired before it was accepted'
  where status='quoted' and quote_expires_at < now();
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function adjust_points(p_member uuid, p_points int, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare s settings;
begin
  if not has_role('admin') then raise exception 'Only an admin can adjust points'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'A written reason is required'; end if;
  if p_points = 0 then raise exception 'Nothing to adjust'; end if;
  select * into s from settings where id = 1;
  insert into ledger(member_id, kind, points, usd, ref_type, note, by_id)
    values (p_member, 'adjust', p_points, round(p_points::numeric / s.points_per_dollar, 2), 'adjust', trim(p_reason), current_member_id());
  perform log_audit('ledger.adjust','member',p_member::text, jsonb_build_object('points', p_points, 'note', p_reason));
end $$;

-- =====================================================================
--  The Reserve, and closing a month
-- =====================================================================
create or replace view treasury as
with confirmed as (select * from contributions where status = 'confirmed'),
     promo as (select coalesce(sum(l.points),0)::numeric as pts from ledger l
               left join contributions c on c.id = l.ref_id and l.ref_type = 'contribution'
               where l.kind in ('bonus','streak','founding') and (c.id is null or c.status <> 'reversed')),
     -- every booking the club has paid for, including ones later cancelled: whatever the
     -- hotel gave back comes in again as a refund line, so the two never double-count
     settled as (select * from redemptions where confirmed_at is not null),
     s as (select * from settings where id = 1)
select
  round(coalesce((select sum(received_usd) from confirmed),0),2) as collected_usd,
  round(coalesce((select sum(share_usd) from confirmed),0),2)    as share_usd,
  round(coalesce((select sum(backing_usd) from confirmed),0),2)  as backing_usd,
  round((select pts from promo) / (select points_per_dollar from s), 2) as promo_usd,
  round(coalesce((select sum(coalesce(paid_usd,0)) from settled),0),2) as paid_out_usd,
  round(coalesce((select sum(top_up_usd) from settled where top_up_confirmed),0),2) as top_ups_usd,
  round(coalesce((select sum(points) from ledger where kind='refund'),0)::numeric / (select points_per_dollar from s),2) as refunded_usd,
  round(coalesce((select sum(points) from ledger where kind='adjust'),0)::numeric / (select points_per_dollar from s),2) as adjust_usd,
  round(-coalesce((select sum(points) from ledger where kind='expire'),0)::numeric / (select points_per_dollar from s),2) as expired_usd,
  coalesce((select sum(points) from ledger),0)::int as outstanding_points,
  round(coalesce((select sum(points) from ledger),0)::numeric / (select points_per_dollar from s),2) as liability_usd;

create or replace function reserve_expected_usd() returns numeric
language sql stable security definer set search_path = public as $$
  select round(backing_usd + promo_usd + top_ups_usd - paid_out_usd + refunded_usd + adjust_usd - expired_usd, 2)
  from treasury
$$;

create or replace function close_month(p_month text, p_bank_balance_usd numeric, p_cosigner uuid, p_note text default '')
returns month_closes language plpgsql security definer set search_path = public as $$
declare s settings; expected_reserve numeric; variance numeric; c month_closes; t treasury%rowtype;
        pending_count int; l ledger; d promo_deferrals; room int;
begin
  if not has_role('treasurer','deputy','admin') then raise exception 'Only the Banker can close a month'; end if;
  if exists (select 1 from month_closes where month = p_month) then raise exception '% is already closed', p_month; end if;
  if p_cosigner is null or p_cosigner = current_member_id() then raise exception 'A second officer must co-sign the close'; end if;
  select count(*) into pending_count from contributions where for_month = p_month and status = 'pending';
  if pending_count > 0 then
    raise exception '% sent contribution(s) are still waiting — confirm or return them first', pending_count;
  end if;
  select * into s from settings where id = 1;
  expected_reserve := reserve_expected_usd();
  variance := round(p_bank_balance_usd - expected_reserve, 2);
  if variance < -s.close_tolerance_usd then
    raise exception 'Reserve is short by $% against the points outstanding. Fund it or add a reconciliation line with a reason.',
      to_char(abs(variance),'FM999999.00');
  end if;

  -- promotional points past their date go back to Operating
  for l in select * from ledger where kind in ('bonus','streak','founding')
           and expires_at is not null and to_char(expires_at,'YYYY-MM') <= p_month
           and not exists (select 1 from ledger x where x.kind='expire' and x.ref_type='ledger' and x.ref_id::text = ledger.id::text) loop
    insert into ledger(member_id, kind, points, usd, ref_type, note, by_id)
      values (l.member_id, 'expire', -l.points, -coalesce(l.usd,0), 'ledger', 'Expired · ' || l.note, current_member_id());
  end loop;

  -- deferred promotional points are minted if there is room now
  for d in select * from promo_deferrals where minted_at is null order by id loop
    room := promo_room(p_month);
    exit when d.points > room;
    insert into ledger(member_id, kind, points, usd, ref_type, ref_id, note, by_id, expires_at)
      values (d.member_id, d.kind, d.points, round(d.points::numeric / s.points_per_dollar,2), 'contribution', d.ref_id,
              'Deferred ' || d.kind || ' minted at the ' || p_month || ' close', current_member_id(),
              now() + make_interval(months => s.bonus_expire_months));
    update promo_deferrals set minted_at = now() where id = d.id;
  end loop;

  select * into t from treasury;
  insert into month_closes(month, closed_by, cosigned_by, bank_balance_usd, ledger_reserve_usd, variance_usd,
                           coverage, gross_usd, share_usd, confirmed_count, missing_count, note)
    values (p_month, current_member_id(), p_cosigner, p_bank_balance_usd, expected_reserve, variance,
            case when t.liability_usd = 0 then 1 else round(reserve_expected_usd() / t.liability_usd, 5) end,
            (select coalesce(sum(received_usd),0) from contributions where for_month=p_month and status='confirmed'),
            (select coalesce(sum(share_usd),0) from contributions where for_month=p_month and status='confirmed'),
            (select count(*) from contributions where for_month=p_month and status='confirmed'),
            (select count(*) from members mm where mm.status in ('active','paused')
               and not exists (select 1 from contributions cc where cc.member_id=mm.id and cc.for_month=p_month and cc.status='confirmed')),
            p_note)
    returning * into c;
  update settings set reserve_verified = jsonb_build_object(
    'balanceUsd', p_bank_balance_usd, 'at', now(), 'byId', current_member_id()) where id = 1;
  perform log_audit('month.close','month',p_month, jsonb_build_object('bankBalanceUsd', p_bank_balance_usd, 'variance', variance));
  return c;
end $$;

-- =====================================================================
--  Row-level security
-- =====================================================================
alter table settings          enable row level security;
alter table members           enable row level security;
alter table invitations       enable row level security;
alter table contributions     enable row level security;
alter table ledger            enable row level security;
alter table promo_deferrals   enable row level security;
alter table stays             enable row level security;
alter table redemptions       enable row level security;
alter table announcements     enable row level security;
alter table month_closes      enable row level security;
alter table audit             enable row level security;
alter table rules_acceptances enable row level security;

-- Signed-out visitors get nothing, and the browser never writes money tables directly.
revoke all on all tables in schema public from anon;
revoke insert, update, delete on ledger, redemptions, pledges, month_closes, promo_deferrals, audit from authenticated;
revoke update, delete on contributions from authenticated;

drop policy if exists settings_read on settings;
create policy settings_read on settings for select to authenticated using (true);
drop policy if exists settings_write on settings;
create policy settings_write on settings for update to authenticated
  using ((select has_role('admin','treasurer'))) with check ((select has_role('admin','treasurer')));

drop policy if exists members_read on members;
create policy members_read on members for select to authenticated using (current_member_id() is not null);
-- Nobody edits a member row directly: roles, status and founding are not the member's to
-- change, and row-level security cannot restrict columns. Both paths below are functions.
drop policy if exists members_self on members;
drop policy if exists members_admin on members;
revoke insert, update, delete on members from authenticated;

create or replace function update_my_profile(p_patch jsonb)
returns members language plpgsql security definer set search_path = public as $$
declare m members; me uuid;
begin
  me := current_member_id();
  if me is null then raise exception 'Not a member'; end if;
  update members set
    name             = coalesce(p_patch->>'name', name),
    phone            = coalesce(p_patch->>'phone', phone),
    preferences      = coalesce(p_patch->'preferences', preferences),
    household        = coalesce(p_patch->'household', household),
    show_on_rollcall = coalesce((p_patch->>'showOnRollcall')::boolean, show_on_rollcall),
    standing_order   = coalesce((p_patch->>'standingOrder')::boolean, standing_order),
    dream_stay_id    = coalesce((p_patch->>'dreamStayId')::uuid, dream_stay_id),
    monthly_usd      = coalesce((p_patch->>'monthlyUsd')::int, monthly_usd)
  where id = me returning * into m;
  perform log_audit('member.update','member',me::text, p_patch);
  return m;
end $$;

-- Pausing and leaving are the member's own to do; being made inactive is not.
create or replace function set_my_status(p_status member_status, p_paused_until text default null)
returns members language plpgsql security definer set search_path = public as $$
declare m members; me uuid;
begin
  me := current_member_id();
  if p_status not in ('active','paused','left') then raise exception 'You can pause, resume or leave'; end if;
  update members set status = p_status,
    paused_until = case when p_status = 'paused' then p_paused_until else null end,
    paused_months = case when p_status = 'paused' then paused_months || to_char(now(),'YYYY-MM') else paused_months end,
    left_at = case when p_status = 'left' then now() else null end
  where id = me returning * into m;
  perform log_audit('member.status','member',me::text, jsonb_build_object('status', p_status));
  return m;
end $$;

create or replace function admin_update_member(p_id uuid, p_patch jsonb)
returns members language plpgsql security definer set search_path = public as $$
declare m members;
begin
  if not has_role('admin') then raise exception 'Only an admin can change a membership'; end if;
  update members set
    name        = coalesce(p_patch->>'name', name),
    email       = coalesce(p_patch->>'email', email),
    phone       = coalesce(p_patch->>'phone', phone),
    roles       = coalesce((select array_agg(x::member_role) from jsonb_array_elements_text(p_patch->'roles') x), roles),
    status      = coalesce((p_patch->>'status')::member_status, status),
    monthly_usd = coalesce((p_patch->>'monthlyUsd')::int, monthly_usd),
    founding    = coalesce((p_patch->>'founding')::boolean, founding),
    title       = coalesce(p_patch->>'title', title),
    notes       = coalesce(p_patch->>'notes', notes)
  where id = p_id returning * into m;
  if m.id is null then raise exception 'No such member'; end if;
  perform log_audit('member.admin_update','member',p_id::text, p_patch);
  return m;
end $$;

create or replace function admin_add_member(p_patch jsonb)
returns members language plpgsql security definer set search_path = public as $$
declare m members; s settings;
begin
  if not has_role('admin') then raise exception 'Only an admin can add a member'; end if;
  select * into s from settings where id = 1;
  if (select count(*) from members where status in ('active','paused')) >= s.member_cap then
    raise exception 'The Circle is capped at % Insiders', s.member_cap;
  end if;
  insert into members(email, name, phone, monthly_usd, roles, status, founding, card_code)
    values (p_patch->>'email', p_patch->>'name', p_patch->>'phone',
            coalesce((p_patch->>'monthlyUsd')::int, 100), '{member}', 'invited',
            (select count(*) from members) < s.founding_seats,
            upper(substr(md5(random()::text), 1, 6)))
    returning * into m;
  perform log_audit('member.add','member',m.id::text, jsonb_build_object('name', m.name));
  return m;
end $$;

drop policy if exists invitations_read on invitations;
create policy invitations_read on invitations for select to authenticated using ((select has_role('admin','comms')));
drop policy if exists invitations_write on invitations;
create policy invitations_write on invitations for all to authenticated
  using ((select has_role('admin'))) with check ((select has_role('admin')));

drop policy if exists contributions_read on contributions;
create policy contributions_read on contributions for select to authenticated
  using (member_id = current_member_id() or (select has_role('treasurer','deputy','comms','planner','admin')));
drop policy if exists contributions_insert on contributions;
create policy contributions_insert on contributions for insert to authenticated
  with check (member_id = current_member_id() and status = 'pending' and reviewed_by is null
              and points is null and share_usd is null and received_usd is null);

drop policy if exists ledger_read on ledger;
create policy ledger_read on ledger for select to authenticated
  using (member_id = current_member_id() or (select has_role('treasurer','deputy','planner','admin')));

drop policy if exists promo_read on promo_deferrals;
create policy promo_read on promo_deferrals for select to authenticated
  using (member_id = current_member_id() or (select has_role('treasurer','deputy','admin')));

drop policy if exists stays_read on stays;
create policy stays_read on stays for select to authenticated using (active or (select has_role('planner','comms','admin')));
drop policy if exists stays_write on stays;
create policy stays_write on stays for all to authenticated
  using ((select has_role('planner','comms','admin'))) with check ((select has_role('planner','comms','admin')));

drop policy if exists redemptions_read on redemptions;
create policy redemptions_read on redemptions for select to authenticated
  using (member_id = current_member_id()
      or (shared and status in ('quoted','held'))            -- open to the Circle to chip in
      or exists (select 1 from pledges p where p.redemption_id = redemptions.id and p.member_id = current_member_id())
      or (select has_role('planner','comms','treasurer','deputy','admin')));

alter table pledges enable row level security;
drop policy if exists pledges_read on pledges;
create policy pledges_read on pledges for select to authenticated using (current_member_id() is not null);

drop policy if exists announcements_read on announcements;
create policy announcements_read on announcements for select to authenticated using (current_member_id() is not null);
drop policy if exists announcements_write on announcements;
create policy announcements_write on announcements for all to authenticated
  using ((select has_role('comms','planner','admin'))) with check ((select has_role('comms','planner','admin')));

drop policy if exists closes_read on month_closes;
create policy closes_read on month_closes for select to authenticated using (current_member_id() is not null);

drop policy if exists audit_read on audit;
create policy audit_read on audit for select to authenticated using ((select has_role('treasurer','deputy','admin')));

drop policy if exists rules_read on rules_acceptances;
create policy rules_read on rules_acceptances for select to authenticated
  using (member_id = current_member_id() or (select has_role('admin')));
drop policy if exists rules_accept on rules_acceptances;
create policy rules_accept on rules_acceptances for insert to authenticated with check (member_id = current_member_id());

-- The member's own pending row may only be withdrawn, never edited into shape.
create or replace function withdraw_contribution(p_id uuid)
returns contributions language plpgsql security definer set search_path = public as $$
declare c contributions;
begin
  update contributions set status='withdrawn', reviewed_at=now()
  where id = p_id and member_id = current_member_id() and status = 'pending' returning * into c;
  if c.id is null then raise exception 'Only your own sent contribution can be withdrawn'; end if;
  perform log_audit('contribution.withdraw','contribution',c.id::text,'{}');
  return c;
end $$;

-- =====================================================================
--  Storage: transfer screenshots, private, one folder per member
-- =====================================================================
insert into storage.buckets (id, name, public) values ('proofs','proofs', false) on conflict do nothing;
drop policy if exists proofs_upload on storage.objects;
create policy proofs_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'proofs' and (storage.foldername(name))[1] = current_member_id()::text);
-- Storage returns the row it inserted, so an INSERT needs a matching SELECT policy.
drop policy if exists proofs_read on storage.objects;
create policy proofs_read on storage.objects for select to authenticated
  using (bucket_id = 'proofs' and ((storage.foldername(name))[1] = current_member_id()::text
         or (select has_role('treasurer','deputy','admin'))));

-- =====================================================================
--  Realtime: the inbox and the member's balance update without a refresh
-- =====================================================================
do $$ begin
  alter publication supabase_realtime add table contributions, redemptions, pledges, ledger, announcements;
exception when others then null; end $$;
