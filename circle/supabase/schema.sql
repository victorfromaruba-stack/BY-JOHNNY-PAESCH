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
  goal           jsonb,                             -- {stayId, nights, season} — what they are saving for
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
  -- null for an extra: money on top of the monthly, or cash handed to the Banker
  for_month      text check (for_month ~ '^\d{4}-\d{2}$'),
  extra          boolean not null default false,
  recorded_by    uuid references members(id),      -- set when the Banker entered it himself
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
  on contributions(member_id, for_month) where status in ('pending','confirmed') and for_month is not null;
alter table contributions drop constraint if exists contributions_extra_has_no_month;
alter table contributions add constraint contributions_extra_has_no_month
  check ((extra and for_month is null) or (not extra and for_month is not null));

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
  -- true for the four places the Circle actually uses; they sort first and carry a badge
  house           boolean not null default false,
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

-- ---------- room types: what you can actually be given at a property ----------
create table if not exists room_types (
  id            uuid primary key default gen_random_uuid(),
  stay_id       uuid not null references stays(id) on delete cascade,
  name          text not null,                       -- as the property markets it
  sqft          int,                                 -- null when genuinely unpublished
  sqm           int,
  sleeps        int not null default 2,
  beds          text,
  bedrooms      int not null default 0,              -- 0 = studio or hotel room
  bathrooms     numeric(3,1) not null default 1,
  kitchen       text not null default 'none' check (kitchen in ('none','kitchenette','full')),
  view          text,
  extras        text[] not null default '{}',
  -- what this type costs relative to the property's cheapest, as a multiplier of the
  -- season rate. 1.0 is the base type; 1.4 is forty per cent more.
  rate_factor   numeric(4,2) not null default 1.00 check (rate_factor > 0),
  source        text not null default 'official' check (source in ('official','aggregator','inferred')),
  source_url    text,
  sort_order    int not null default 0,
  active        boolean not null default true
);
create index if not exists room_types_stay_idx on room_types(stay_id, sort_order);

-- ---------- the watch list: standing wants ----------
-- "A one-bedroom at the Ocean Club, some week in March, not more than 220,000 points."
-- Nothing is reserved by a watch. It exists so that when the thing appears, the people
-- who asked for it hear about it in the same minute the Desk does.
create table if not exists watches (
  id           uuid primary key default gen_random_uuid(),
  member_id    uuid not null references members(id) on delete cascade,
  stay_id      uuid references stays(id) on delete cascade,   -- null = anywhere of that kind
  room_type_id uuid references room_types(id) on delete set null,
  kind         text not null default 'aruba' check (kind in ('aruba','trip','any')),
  from_date    date not null,
  to_date      date not null,
  nights       int not null default 3 check (nights > 0),
  flex_days    int not null default 3 check (flex_days >= 0),
  guests       int not null default 2 check (guests > 0),
  max_points   int check (max_points > 0),
  note         text,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz,
  ended_at     timestamptz,
  check (to_date >= from_date)
);
create index if not exists watches_member_idx on watches(member_id) where active;
create index if not exists watches_stay_idx on watches(stay_id) where active;

-- ---------- deals: something real that became available ----------
create table if not exists deals (
  id            uuid primary key default gen_random_uuid(),
  stay_id       uuid not null references stays(id) on delete cascade,
  room_type_id  uuid references room_types(id) on delete set null,
  kind          text not null default 'aruba' check (kind in ('aruba','trip')),
  title         text,
  from_date     date not null,
  to_date       date not null,
  nights        int not null check (nights > 0),
  points_total  int not null check (points_total > 0),
  points_per_night int,
  retail_usd    numeric(10,2),
  -- where it came from. `source_url` is the link the Desk clicks to go and book it.
  source        text not null default 'other'
                check (source in ('interval','redweek','iberostar','airbnb','vrbo','hotel','member','other')),
  source_url    text,
  source_ref    text,
  units         int not null default 1 check (units > 0),
  note          text,
  status        text not null default 'live' check (status in ('live','gone','expired','booked')),
  posted_by     uuid references members(id),
  posted_at     timestamptz not null default now(),
  expires_at    timestamptz,
  retired_at    timestamptz,
  retired_reason text,
  check (to_date >= from_date)
);
create index if not exists deals_live_idx on deals(status, posted_at desc);
create index if not exists deals_stay_idx on deals(stay_id, from_date);

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
  -- An extra buys points at the plain rate: no tier bonus, no streak, and it covers no month.
  is_full := (not c.extra) and (received + 0.005 >= m.monthly_usd);

  update contributions set status='confirmed', reviewed_by=current_member_id(), reviewed_at=now(), reason=p_note,
         received_usd=received, currency=p_currency, received_native=p_native,
         share_usd=share, backing_usd=backing, base_points=base_pts, full_amount=is_full
  where id = p_id returning * into c;

  insert into ledger(member_id, kind, points, usd, ref_type, ref_id, note, by_id)
    values (c.member_id, 'earn', base_pts, backing, 'contribution', c.id,
            case when c.extra then coalesce(nullif(trim(c.note), ''), 'Extra contribution')
                 else to_char(to_date(c.for_month || '-01','YYYY-MM-DD'),'FMMonth YYYY') || ' contribution'
                        || case when is_full then '' else ' · part of it' end end,
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

  if (not c.extra) and m.founding and s.founding_bonus > 0
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
  outstanding := coalesce(r.quoted_points, r.indicative_points, 0) - covered_points(p_id);
  if outstanding <= 0 then raise exception 'This booking is already covered'; end if;
  -- cap at what the booking still needs before checking the balance, so offering more
  -- than is wanted puts in what is wanted rather than being refused
  amount := least(p_points, outstanding);
  avail := available_points(me);
  if amount > avail then raise exception 'You have % points available', avail; end if;
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
--  Money the Banker takes by hand, goals, the watch list and deals
-- =====================================================================

-- Cash across a table, a transfer the Banker spotted himself, or someone catching up a
-- month they missed. Recorded and confirmed in one step so the ledger, the Reserve and
-- the month all stay true. With p_for_month set it IS that month's contribution and
-- earns everything a normal one does; without, it is an extra at the plain rate.
create or replace function record_direct_contribution(
  p_member uuid, p_amount numeric, p_for_month text default null,
  p_method text default 'cash', p_currency text default 'USD', p_note text default '')
returns contributions language plpgsql security definer set search_path = public as $$
declare c contributions; m members; is_extra boolean; usd numeric;
begin
  if not has_role('treasurer','deputy','admin') then raise exception 'Only the Banker can record money that arrived'; end if;
  select * into m from members where id = p_member;
  if m.id is null then raise exception 'No such member'; end if;
  usd := round(p_amount, 2);
  if usd <= 0 then raise exception 'Enter the amount that actually arrived'; end if;
  is_extra := p_for_month is null;
  if is_extra and coalesce(trim(p_note), '') = '' then
    raise exception 'Say what this money was for — members read it on their ledger';
  end if;
  if not is_extra and exists (select 1 from contributions x
      where x.member_id = p_member and x.for_month = p_for_month and x.status in ('pending','confirmed')) then
    raise exception '% already has a sent or confirmed contribution — confirm that one instead', p_for_month;
  end if;
  insert into contributions(member_id, for_month, extra, expected_usd, currency, method, note, sent_on,
                            status, recorded_by, reference)
    values (p_member, p_for_month, is_extra, usd, p_currency, p_method, trim(p_note), current_date,
            'pending', current_member_id(),
            case when is_extra then null
                 else 'HUNTO-' || upper(substring(regexp_replace(m.name, '[^A-Za-z ]', '', 'g') from 1 for 1))
                      || upper(coalesce(substring(split_part(m.name, ' ', 2) from 1 for 1), ''))
                      || '-' || p_for_month end)
    returning * into c;
  perform log_audit('contribution.record','contribution', c.id::text,
                    jsonb_build_object('memberId', p_member, 'amountUsd', usd, 'forMonth', p_for_month, 'method', p_method));
  return confirm_contribution(c.id, usd, p_currency, null, trim(p_note));
end $$;

-- What a member is saving for. Nothing is reserved by it.
create or replace function set_my_goal(p_goal jsonb)
returns members language plpgsql security definer set search_path = public as $$
declare me uuid; m members;
begin
  me := current_member_id();
  if me is null then raise exception 'Not a member'; end if;
  if p_goal is not null and not exists (select 1 from stays where id = (p_goal->>'stayId')::uuid and active) then
    raise exception 'That place is no longer on the list';
  end if;
  update members set goal = p_goal where id = me returning * into m;
  return m;
end $$;

-- ---------- the watch list ----------
create or replace function add_watch(
  p_stay uuid, p_from date, p_to date, p_nights int,
  p_room_type uuid default null, p_kind text default 'aruba',
  p_flex int default 3, p_guests int default 2, p_max_points int default null, p_note text default '')
returns watches language plpgsql security definer set search_path = public as $$
declare me uuid; w watches;
begin
  me := current_member_id();
  if me is null then raise exception 'Not a member'; end if;
  if p_from is null or p_to is null then raise exception 'Say roughly when you would go'; end if;
  if p_to < p_from then raise exception 'Those dates are the wrong way round'; end if;
  if coalesce(p_nights, 0) <= 0 then raise exception 'How many nights?'; end if;
  if p_stay is not null and not exists (select 1 from stays where id = p_stay and active) then
    raise exception 'That place is no longer on the list';
  end if;
  if exists (select 1 from watches x where x.member_id = me and x.active
      and x.stay_id is not distinct from p_stay and x.room_type_id is not distinct from p_room_type
      and x.from_date = p_from and x.to_date = p_to) then
    raise exception 'You are already watching for exactly that';
  end if;
  insert into watches(member_id, stay_id, room_type_id, kind, from_date, to_date, nights, flex_days, guests, max_points, note)
    values (me, p_stay, p_room_type, p_kind, p_from, p_to, p_nights, greatest(0, p_flex), greatest(1, p_guests),
            nullif(p_max_points, 0), nullif(trim(p_note), ''))
    returning * into w;
  perform log_audit('watch.add','watch', w.id::text, jsonb_build_object('stayId', p_stay, 'from', p_from, 'to', p_to));
  return w;
end $$;

create or replace function remove_watch(p_id uuid)
returns watches language plpgsql security definer set search_path = public as $$
declare w watches;
begin
  select * into w from watches where id = p_id;
  if w.id is null then raise exception 'No such watch'; end if;
  if w.member_id <> current_member_id() and not has_role('planner','admin') then
    raise exception 'That is not your watch';
  end if;
  update watches set active = false, ended_at = now() where id = p_id returning * into w;
  perform log_audit('watch.remove','watch', p_id::text, '{}'::jsonb);
  return w;
end $$;

create or replace function mark_watches_seen()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update watches set last_seen_at = now() where member_id = current_member_id() and active;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- deals ----------
create or replace function post_deal(
  p_stay uuid, p_from date, p_to date, p_points int,
  p_room_type uuid default null, p_title text default null, p_nights int default null,
  p_retail_usd numeric default null, p_source text default 'other', p_source_url text default '',
  p_source_ref text default '', p_units int default 1, p_expires_at timestamptz default null,
  p_note text default '')
returns deals language plpgsql security definer set search_path = public as $$
declare d deals; st stays; n int;
begin
  if not has_role('planner','comms','admin') then raise exception 'Only Victor or Ian can post a deal'; end if;
  select * into st from stays where id = p_stay;
  if st.id is null then raise exception 'Pick a place from the catalog'; end if;
  if p_from is null or p_to is null then raise exception 'A deal needs the dates it is for'; end if;
  if p_to < p_from then raise exception 'Those dates are the wrong way round'; end if;
  n := greatest(1, coalesce(p_nights, (p_to - p_from)));
  if coalesce(p_points, 0) <= 0 then raise exception 'What does it cost in points?'; end if;
  insert into deals(stay_id, room_type_id, kind, title, from_date, to_date, nights, points_total,
                    points_per_night, retail_usd, source, source_url, source_ref, units, note, posted_by, expires_at)
    values (p_stay, p_room_type, case when st.kind = 'trip' then 'trip' else 'aruba' end,
            coalesce(nullif(trim(p_title), ''), st.name), p_from, p_to, n, p_points,
            round(p_points::numeric / n), p_retail_usd, p_source, nullif(trim(p_source_url), ''),
            nullif(trim(p_source_ref), ''), greatest(1, p_units), nullif(trim(p_note), ''),
            current_member_id(), p_expires_at)
    returning * into d;
  perform log_audit('deal.post','deal', d.id::text,
                    jsonb_build_object('stayId', p_stay, 'points', p_points, 'source', p_source));
  return d;
end $$;

create or replace function retire_deal(p_id uuid, p_reason text default '')
returns deals language plpgsql security definer set search_path = public as $$
declare d deals;
begin
  if not has_role('planner','comms','admin') then raise exception 'Only Victor or Ian can take a deal down'; end if;
  update deals set status = 'gone', retired_at = now(), retired_reason = nullif(trim(p_reason), '')
    where id = p_id returning * into d;
  if d.id is null then raise exception 'No such deal'; end if;
  perform log_audit('deal.retire','deal', p_id::text, jsonb_build_object('reason', p_reason));
  return d;
end $$;

-- Does a deal answer a watch? Generous on dates — a watch is a rough want, not a booking —
-- and strict on the two things the member actually ruled out: a different property, and
-- more points than they said they would spend.
create or replace function deal_matches_watch(d deals, w watches)
returns boolean language sql stable set search_path = public as $$
  select d.status = 'live'
     and (w.stay_id is null or w.stay_id = d.stay_id)
     and (w.room_type_id is null or d.room_type_id is null or w.room_type_id = d.room_type_id)
     and (w.stay_id is not null or w.kind = 'any' or w.kind = d.kind)
     and (w.max_points is null or d.points_total <= w.max_points)
     and greatest(0, least(d.to_date, w.to_date + w.flex_days)
                   - greatest(d.from_date, w.from_date - w.flex_days))
         >= least(w.nights, d.nights)
$$;

-- Live deals that answer something this member asked for.
create or replace function my_matches()
returns table (deal_id uuid, watch_id uuid, unseen boolean)
language sql stable security definer set search_path = public as $$
  select distinct on (d.id) d.id, w.id,
         (w.last_seen_at is null or d.posted_at > w.last_seen_at)
    from deals d
    join watches w on w.member_id = current_member_id() and w.active
   where d.status = 'live'
     and (d.expires_at is null or d.expires_at > now())
     and deal_matches_watch(d, w)
   order by d.id, d.posted_at desc
$$;

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
alter table room_types        enable row level security;
alter table watches           enable row level security;
alter table deals             enable row level security;

-- Signed-out visitors get nothing, and the browser never writes money tables directly.
revoke all on all tables in schema public from anon;
revoke insert, update, delete on ledger, redemptions, pledges, month_closes, promo_deferrals, audit from authenticated;
-- Watches and deals are created through the functions above, never written directly:
-- a member could otherwise set someone else's member_id, or post a deal without the role.
revoke insert, update, delete on watches, deals, room_types from authenticated;
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
    goal             = case when p_patch ? 'goal' then p_patch->'goal' else goal end,
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

-- Adding someone should not mean opening the table editor. This takes the roles too, so
-- Ian goes in as comms and Vishnu as treasurer without anyone writing SQL by hand.
--
-- The member row is all that is needed: the person then goes to the sign-in screen, taps
-- "Set it up" with the same email, and claim_membership() links their new account to this
-- row. Nothing is emailed from here — Ian sends them the link himself.
create or replace function admin_add_member(p_patch jsonb)
returns members language plpgsql security definer set search_path = public as $$
declare m members; s settings; wanted member_role[]; r text;
begin
  if not has_role('admin') then raise exception 'Only an admin can add a member'; end if;
  select * into s from settings where id = 1;
  if (select count(*) from members where status in ('active','paused')) >= s.member_cap then
    raise exception 'The Circle is capped at % Insiders', s.member_cap;
  end if;
  if coalesce(trim(p_patch->>'name'), '') = '' then raise exception 'They need a name'; end if;
  if p_patch ? 'email' and coalesce(trim(p_patch->>'email'), '') <> ''
     and exists (select 1 from members where lower(email) = lower(trim(p_patch->>'email'))) then
    raise exception 'Someone is already on the list with that email';
  end if;

  -- Roles come in as a JSON array of strings. Anything not in the enum is refused rather
  -- than silently dropped, so a typo cannot quietly create a member with no powers.
  wanted := '{}';
  if jsonb_typeof(p_patch->'roles') = 'array' then
    for r in select jsonb_array_elements_text(p_patch->'roles') loop
      if r not in ('member','treasurer','deputy','planner','comms','admin') then
        raise exception '% is not a role', r;
      end if;
      wanted := wanted || r::member_role;
    end loop;
  end if;
  if array_length(wanted, 1) is null then wanted := '{member}'; end if;

  insert into members(email, name, phone, monthly_usd, roles, status, founding, home, title, card_code)
    values (nullif(trim(p_patch->>'email'), ''), trim(p_patch->>'name'), nullif(trim(p_patch->>'phone'), ''),
            coalesce((p_patch->>'monthlyUsd')::int, 100), wanted, 'invited',
            coalesce((p_patch->>'founding')::boolean, (select count(*) from members) < s.founding_seats),
            nullif(trim(p_patch->>'home'), ''), nullif(trim(p_patch->>'title'), ''),
            upper(substr(md5(random()::text), 1, 6)))
    returning * into m;
  perform log_audit('member.add','member',m.id::text,
                    jsonb_build_object('name', m.name, 'roles', to_jsonb(m.roles)));
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
-- Deals are the reason this channel earns its keep: something posted at eleven at night has
-- to reach everyone's phone without them refreshing. Added separately so that a database
-- where the line above already ran still picks these up.
do $$ begin
  alter publication supabase_realtime add table deals;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table watches;
exception when others then null; end $$;

-- =====================================================================
--  Row-level security for room types, the watch list and deals
-- =====================================================================

-- Room types are part of the catalog: everyone signed in can read the live ones,
-- planners see retired ones too. Writes go through the Desk's upsert, not the table.
drop policy if exists room_types_read on room_types;
create policy room_types_read on room_types for select to authenticated
  using (active or (select has_role('planner','comms','admin')));

-- Your watches are yours. Victor and Ian see them all, because knowing what the Circle is
-- waiting for is the whole point — it tells them what to go and find.
drop policy if exists watches_read on watches;
create policy watches_read on watches for select to authenticated
  using (member_id = current_member_id() or (select has_role('planner','comms','admin')));

-- A deal is club-wide news. Everyone signed in sees every live one.
drop policy if exists deals_read on deals;
create policy deals_read on deals for select to authenticated
  using (current_member_id() is not null);

-- The Desk edits room types the same way it edits a stay: through a guarded function.
create or replace function upsert_room_type(p_patch jsonb)
returns room_types language plpgsql security definer set search_path = public as $$
declare r room_types; rid uuid;
begin
  if not has_role('planner','admin') then raise exception 'Only a planner can edit the rooms'; end if;
  rid := nullif(p_patch->>'id','')::uuid;
  if rid is null then
    insert into room_types(stay_id, name, sqft, sqm, sleeps, beds, bedrooms, bathrooms, kitchen, view,
                           extras, rate_factor, source, source_url, sort_order, active)
      values ((p_patch->>'stayId')::uuid, p_patch->>'name',
              nullif(p_patch->>'sqft','')::int, nullif(p_patch->>'sqm','')::int,
              coalesce((p_patch->>'sleeps')::int, 2), p_patch->>'beds',
              coalesce((p_patch->>'bedrooms')::int, 0), coalesce((p_patch->>'bathrooms')::numeric, 1),
              coalesce(p_patch->>'kitchen','none'), p_patch->>'view',
              coalesce((select array_agg(value::text) from jsonb_array_elements_text(p_patch->'extras')), '{}'),
              coalesce((p_patch->>'rateFactor')::numeric, 1.0), coalesce(p_patch->>'source','official'),
              p_patch->>'sourceUrl', coalesce((p_patch->>'sortOrder')::int, 0),
              coalesce((p_patch->>'active')::boolean, true))
      returning * into r;
  else
    update room_types set
      name = coalesce(p_patch->>'name', name),
      sqft = case when p_patch ? 'sqft' then nullif(p_patch->>'sqft','')::int else sqft end,
      sqm  = case when p_patch ? 'sqm'  then nullif(p_patch->>'sqm','')::int  else sqm end,
      sleeps = coalesce((p_patch->>'sleeps')::int, sleeps),
      beds = coalesce(p_patch->>'beds', beds),
      bedrooms = coalesce((p_patch->>'bedrooms')::int, bedrooms),
      bathrooms = coalesce((p_patch->>'bathrooms')::numeric, bathrooms),
      kitchen = coalesce(p_patch->>'kitchen', kitchen),
      view = coalesce(p_patch->>'view', view),
      extras = coalesce((select array_agg(value::text) from jsonb_array_elements_text(p_patch->'extras')), extras),
      rate_factor = coalesce((p_patch->>'rateFactor')::numeric, rate_factor),
      source = coalesce(p_patch->>'source', source),
      source_url = coalesce(p_patch->>'sourceUrl', source_url),
      sort_order = coalesce((p_patch->>'sortOrder')::int, sort_order),
      active = coalesce((p_patch->>'active')::boolean, active)
    where id = rid returning * into r;
    if r.id is null then raise exception 'No such room type'; end if;
  end if;
  perform log_audit('room_type.upsert','room_type', r.id::text, jsonb_build_object('name', r.name));
  return r;
end $$;
-- =====================================================================
--  Execute privileges: close the door anon was left holding
-- =====================================================================
-- Postgres grants EXECUTE on a new function to PUBLIC by default. Revoking table access
-- from `anon` therefore did nothing for the functions — and because these are SECURITY
-- DEFINER, a caller holding only the publishable key could read the Reserve total, read
-- any member's balance, and (through log_audit) write rows into the audit table.
--
-- These are named one by one on purpose: this project also hosts another application, and
-- a blanket `revoke ... on all functions in schema public` would break it.

do $$
declare
  fn text;
  circle_functions text[] := array[
    'accept_quote','add_watch','adjust_points','admin_add_member','admin_update_member',
    'available_points','cancel_redemption','claim_membership','close_month','committed_points',
    'complete_redemption','confirm_contribution','confirm_top_up','consecutive_months','covered_points',
    'current_member_id','deal_matches_watch','decline_redemption','easter_sunday','has_role',
    'ledger_balance','ledger_is_append_only','log_audit','mark_watches_seen','my_matches',
    'pay_redemption','pledge_to_redemption','post_deal','promo_room','quote_points',
    'quote_redemption','record_direct_contribution','reject_contribution','release_expired_quotes',
    'remove_watch','request_redemption','reserve_expected_usd','retire_deal','reverse_contribution',
    'season_for','set_my_goal','set_my_status','update_my_profile','upsert_room_type',
    'withdraw_contribution','withdraw_pledge','set_updated_at'
  ];
begin
  for fn in
    select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any(circle_functions)
  loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

-- Two of these are triggers and internal helpers; nothing outside the database should be
-- able to call them at all, not even a signed-in member.
do $$
declare fn text;
begin
  for fn in
    select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('log_audit','ledger_is_append_only','set_updated_at')
  loop
    execute format('revoke all on function %s from authenticated', fn);
  end loop;
end $$;

-- search_path was left mutable on four functions. On a SECURITY DEFINER function that is a
-- way in: a caller who can create objects in a schema earlier on the path can shadow a
-- built-in the function relies on.
alter function public.easter_sunday(int) set search_path = public;
alter function public.season_for(date) set search_path = public;
alter function public.ledger_is_append_only() set search_path = public;
do $$ begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname='public' and p.proname='set_updated_at') then
    execute 'alter function public.set_updated_at() set search_path = public';
  end if;
end $$;

-- The treasury view ran as its owner, so it ignored row-level security. Nothing in it is
-- per-member, but a view that bypasses RLS is a habit worth not having.
alter view public.treasury set (security_invoker = true);

-- Foreign keys the Circle actually joins on, which had no index behind them.
create index if not exists contributions_recorded_by_idx on contributions(recorded_by);
create index if not exists redemptions_stay_idx          on redemptions(stay_id);
create index if not exists redemptions_member_idx        on redemptions(member_id);
create index if not exists deals_room_type_idx           on deals(room_type_id);
create index if not exists deals_posted_by_idx           on deals(posted_by);
create index if not exists watches_room_type_idx         on watches(room_type_id);
create index if not exists ledger_ref_idx                on ledger(ref_type, ref_id);
create index if not exists pledges_member_idx            on pledges(member_id);
create index if not exists audit_actor_idx               on audit(actor_id);
