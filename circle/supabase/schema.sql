-- Brought level with the live database on 2026-09-07, checked object by object against project
-- cdkopyphjvfxjqhasrae: every table, view, column and function that exists live now exists here,
-- and the three stale bodies have been replaced with what is actually running.
--
-- What had drifted, and why it mattered:
--
--   create_crew        the file held the OLD, UNGATED two-argument version. Adding the approval
--                      gate meant adding a third argument, and in Postgres that creates a second
--                      function rather than replacing the first — so the ungated one was still
--                      live and callable by any member until it was dropped in production on
--                      2026-09-07. Running this file as it stood would have recreated it.
--   update_my_profile  older body, without about / accent / cover, so members would silently
--                      stop being able to save their profile.
--   request_redemption older body, without the standing perks, so the hold cap ignored rank.
--   missing entirely   badge_catalog, member_badges, tax_rates, standing_v, seven functions
--                      (months_held, rank_ladder, rank_perks, standing_of, buy_badge,
--                      grant_badge, pin_badges) and eleven columns.
--
-- `create or replace function` does not merge, and changing a function's arity does not replace
-- it — it overloads it. Both are how this file went wrong before. When you change the live
-- schema, write a migration against it and then bring this file forward in the same sitting.
--
-- One thing this file is NOT: the whole database. Project cdkopyphjvfxjqhasrae also hosts an
-- unrelated bookkeeping application (businesses, transactions, receipts, quickbooks_*, vendor_*)
-- whose tables, policies and helper functions — current_business_id() among them — are not
-- described here and must not be dropped by anything derived from this file.

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
do $$ begin create type ledger_kind as enum ('earn','bonus','streak','founding','burn','refund','adjust','expire','reverse','badge');
exception when duplicate_object then null; end $$;

-- buy_badge() writes kind 'badge'. The enum never had it, so on the live backend every purchase
-- aborted with "invalid input value for enum" shown raw to the member — while the preview,
-- which does not use the enum, sold badges happily. A database that already exists gets the
-- value here; a fresh build has it in the create above.
alter type ledger_kind add value if not exists 'badge';

-- ---------- settings (one row) ----------
create table if not exists settings (
  id                int primary key default 1 check (id = 1),
  club_name         text not null default 'Hunto',
  service_rate      numeric(5,4) not null default 0.15,
  points_per_dollar int not null default 100,
  awg_per_usd       numeric(6,3) not null default 1.79,
  -- Must stay identical to DEFAULT_SETTINGS.tiers in js/core/money.js. This default had drifted
  -- back to the ladder money.js calls "a rounding error" — $200 with the same open requests as
  -- $150, one extra month of window, and no slaHours key at all — so running this file against
  -- the live project would have silently undone the ladder and made the landing page promise
  -- every member the same 72-hour answer. The live row is correct; this line was not.
  tiers             jsonb not null default
    '[{"id":"t100","monthlyUsd":100,"bonusRate":0,"holds":1,"guestCerts":2,"windowMonths":9,"firstLookHours":0,"slaHours":72},
      {"id":"t150","monthlyUsd":150,"bonusRate":0.03,"holds":3,"guestCerts":4,"windowMonths":15,"firstLookHours":48,"slaHours":48},
      {"id":"t200","monthlyUsd":200,"bonusRate":0.06,"holds":5,"guestCerts":8,"windowMonths":24,"firstLookHours":168,"slaHours":24}]',
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
  updated_at        timestamptz not null default now(),
  -- Photos and clips in a crew are off until the club decides it wants them. The moments_post
  -- policy reads this, so the column has to exist by the time that policy is created — which is
  -- why it lives here in the table rather than in the alters at the foot of the file.
  moments_on        boolean not null default false
);
-- A column added to a table that already exists is not created by `create table if not exists`,
-- so an older database needs this too.
alter table settings add column if not exists moments_on boolean not null default false;
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
  -- A machine account, not a person: the watcher that posts deals from the VPS. It holds no
  -- seat against the cap, owes nothing, and is not chased at the close. Everything that counts
  -- Insiders has to say so out loud, because for the first year every row here was a human.
  bot            boolean not null default false,
  sponsor_id     uuid references members(id),
  card_code      text unique,
  -- People sign in with a username, never an email. Supabase authenticates against an email
  -- address, so one is derived from this and never shown: victor -> victor@members.hunto.aw.
  -- Nothing is ever sent there; there is no confirmation step and no reset mail.
  username       text,
  -- True while the password in use is one an admin generated. Every screen stays closed until
  -- it is replaced: a password somebody else chose is a password somebody else knows.
  must_change_password boolean not null default false,
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
create unique index if not exists members_username_lower_key on members (lower(username)) where username is not null;

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
  -- ref_id cannot hold a ledger id: ledger.id is a bigserial and ref_id is a uuid. An expiry
  -- line has to name the promotional line it cancels, or close_month expires it again every
  -- month forever, and the member's balance walks down with each close.
  ref_ledger_id bigint references ledger(id),
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
  -- how far a trip goes: 'region' (the Caribbean) or 'world'. Null for Aruba stays, which
  -- are always 'aruba'. Without it every trip reads as regional, so Japan lost its badge.
  reach           text check (reach in ('region','world')),
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
  -- The cash actually handed to the Banker, in dollars, written by confirm_top_up and never
  -- recomputed. top_up_usd is what is OWED and moves with every pledge; this is what was
  -- RECEIVED and does not. Without it a confirmed top-up was a bare boolean over a number that
  -- a later pledge could rewrite to zero, and $120 of a member's cash vanished from every
  -- treasury line with no refund path — or, run the other way, the flag stayed true after a
  -- pledge was withdrawn and the Reserve funded a gap nobody had paid.
  top_up_received_usd numeric(10,2),
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
  -- Victor picked it up: a person and a time, set by approve_redemption() once the member has
  -- accepted, or by pay_redemption() if he books it straight away. Until it is set the honest
  -- line to the member is "Victor picks it up next", not "Victor is confirming with the hotel".
  approved_at       timestamptz,
  approved_by       uuid references members(id),
  check (check_out > check_in)
);
alter table redemptions add column if not exists approved_at timestamptz;
alter table redemptions add column if not exists approved_by uuid references members(id);

do $$ begin create type look_found as enum ('showing','gone','unclear','different','booked');
exception when duplicate_object then null; end $$;
do $$ begin create type look_channel as enum ('site','phone');
exception when duplicate_object then null; end $$;

create table if not exists looks (
  id            uuid primary key default gen_random_uuid(),
  stay_id       uuid not null references stays(id) on delete cascade,
  redemption_id uuid references redemptions(id) on delete set null,
  check_in      date not null,
  check_out     date not null,
  found         look_found not null,
  channel       look_channel not null default 'site',
  url           text,
  label         text,
  price_usd     numeric(10,2),
  -- The room as the PAGE named it, not as our catalog names it. A listing is one unit; saying
  -- "the week was showing" when what was showing is a two-bedroom and the member asked for a
  -- studio is a true sentence about a false thing.
  room_label    text,
  note          text,
  looked_by     uuid not null references members(id),
  -- The watcher may record what it scraped, but a robot look can never open the gate and must
  -- never appear in a sentence with a person's name on it. Only a person can confirm a room.
  by_robot      boolean not null default false,
  looked_at     timestamptz not null default now(),
  -- Stored at insert, never recomputed: a look made under a 72-hour policy must not silently
  -- gain life when the policy changes. Same reasoning as stays.sources.seenOn.
  good_until    timestamptz not null,
  check (check_out > check_in),
  check (found not in ('unclear','different') or note is not null)
);
alter table looks drop constraint if exists looks_site_needs_a_link;
-- A 'booked' look records that the Desk took the room, not that it read a page, so it needs no
-- link. Requiring one forced a placeholder URL into the column, and a made-up link is exactly
-- what this table exists to keep out.
alter table looks add constraint looks_site_needs_a_link
  check (channel <> 'site' or found = 'booked' or url is not null);
create index if not exists looks_stay_idx on looks(stay_id, check_in, looked_at desc);
create index if not exists looks_red_idx  on looks(redemption_id, looked_at desc);

-- Append-only, like the ledger. A second look is a second row, so a change of story is visible
-- rather than overwritten.
create or replace function looks_are_append_only() returns trigger
language plpgsql as $$
begin raise exception 'A look is a record of what somebody saw. Add another one instead.'; end $$;
drop trigger if exists looks_no_edit on looks;
create trigger looks_no_edit before update or delete on looks
  for each row execute function looks_are_append_only();

alter table redemptions add column if not exists quote_look_id uuid references looks(id);
alter table redemptions add column if not exists last_look_id  uuid references looks(id);
alter table settings add column if not exists look_hours jsonb not null default '{"site":72,"phone":48}';
alter table settings add column if not exists min_quote_hours int not null default 12;
alter table settings add column if not exists looks_from timestamptz;
update settings set looks_from = now() where id = 1 and looks_from is null;

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
                check (source in ('interval','redweek','iberostar','airbnb','vrbo','hotel','member','vakaymood','other')),
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
-- Matching an account to a member row. This matched on EMAIL until it bit: logins became
-- usernames, admin_set_login started writing auth_user_id directly, members.email went null,
-- and so `lower(null) = lower('victor@members.hunto.aw')` was null. No row came back, no session
-- was ever established, and every signed-in member was told they were not on the Circle's list.
--
-- The link is auth_user_id. Look there first. The email branch stays only for a legacy row made
-- before usernames that has never been claimed.
create or replace function claim_membership()
returns members language plpgsql security definer set search_path = public as $$
declare m members;
begin
  -- Already linked, which is every account admin_set_login has ever made.
  select * into m from members where auth_user_id = auth.uid();
  if m.id is not null then
    if m.status = 'invited' then
      update members set status = 'active' where id = m.id returning * into m;
    end if;
    return m;
  end if;

  -- Not linked yet: an older row that carries an email and has never been claimed.
  update members set auth_user_id = auth.uid(),
         status = case when status = 'invited' then 'active' else status end
  where email is not null
    and lower(email) = lower((select email from auth.users where id = auth.uid()))
    and auth_user_id is null
  returning * into m;
  return m;
end $$;


-- What a username may be, so it can live in an email address and be typed on a phone.
create or replace function valid_username(p text) returns boolean
language sql immutable set search_path = public as $$
  select p ~ '^[a-z0-9][a-z0-9._-]{1,28}[a-z0-9]$'
$$;

/**
 * Give a member a way in. Admin only. Creates the account if it does not exist, or resets the
 * password if it does, and marks it so the first sign-in forces a change.
 *
 * The account is written straight into auth.users already confirmed, which is what takes the
 * inbox out of the story: no confirmation mail to click, no reset mail to wait for. Victor
 * generates a password, the app shows it once, and he passes it on himself.
 */
create or replace function admin_set_login(p_member uuid, p_username text, p_password text)
returns members language plpgsql security definer set search_path = public as $$
declare m members; u text; e text; v_uid uuid; existing uuid;
begin
  if not has_role('admin') then raise exception 'Only an admin can hand out a login'; end if;
  u := lower(trim(p_username));
  if not valid_username(u) then
    raise exception 'A username is 3 to 30 characters, letters and numbers, and may contain . _ or -';
  end if;
  if length(coalesce(p_password, '')) < 12 then raise exception 'That password is too short — twelve characters at least'; end if;
  if exists (select 1 from members where lower(username) = u and id <> p_member) then
    raise exception 'Someone else already uses the username %', u;
  end if;
  e := u || '@members.hunto.aw';

  select id into existing from auth.users where lower(email) = e;
  if existing is null then
    v_uid := gen_random_uuid();
    -- Those eight token columns must be '' and never NULL. GoTrue scans them into a Go string,
    -- and a NULL fails the scan on the way past — so the row looks perfect in psql and every
    -- sign-in dies with "Database error querying schema". The defaults do not cover an insert
    -- that names its columns, so they are named here.
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change_token_new, email_change,
                            email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', e,
            extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}'::jsonb,
            jsonb_build_object('sub', v_uid::text, 'email', e, 'email_verified', true, 'phone_verified', false),
            now(), now(), '', '', '', '', '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_uid, v_uid::text, 'email',
            jsonb_build_object('sub', v_uid::text, 'email', e, 'email_verified', true, 'phone_verified', false),
            now(), now(), now());
  else
    v_uid := existing;
    update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
                          email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now()
     where id = v_uid;
  end if;

  update members set username = u, auth_user_id = v_uid,
                     -- A person is made to replace a password somebody else chose. A robot has
                     -- nobody to replace it with, and it signs in over the API where no screen
                     -- could ask, so it is never flagged.
                     must_change_password = not bot,
                     status = case when status = 'invited' then 'active' else status end
   where id = p_member returning * into m;
  if m.id is null then raise exception 'No such member'; end if;
  perform log_audit('member.login_set','member',p_member::text, jsonb_build_object('username', u));
  return m;
end $$;

-- Called after the person changed their own password through Supabase, which needs a live
-- session and so proves it was them. This only clears the flag that forces the prompt.
create or replace function password_changed()
returns members language plpgsql security definer set search_path = public as $$
declare m members;
begin
  if current_member_id() is null then raise exception 'Not a member'; end if;
  update members set must_change_password = false where id = current_member_id() returning * into m;
  perform log_audit('member.password_changed','member', m.id::text, '{}'::jsonb);
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
-- What a room costs in points, all in: the room and the Circle's 15% together, because that is
-- what comes off a member's balance. Priced a night at a time, so nightly × nights is exactly
-- the quote and a member can check it by multiplying — applying the rate to the total instead
-- would be off by a point or two on some rates, and a member who checks the arithmetic by hand
-- and finds it wrong has every right to distrust the rest of the books.
-- quote_points changed its OUT list, and create or replace cannot replace a function whose
-- return columns differ — running this file against a mid-2026 database aborted here. Every
-- caller is plpgsql and resolves it at run time, so dropping first is safe.
drop function if exists quote_points(uuid, date, date, int);
create or replace function quote_points(p_stay uuid, p_in date, p_out date, p_seats int default 1,
  out points int, out base_points int, out service_points int,
  out min_nights int, out nights int, out seasons jsonb, out retail_usd numeric)
language plpgsql stable security definer set search_path = public as $$
declare st stays; s settings; d date; sea text; rate numeric; n_low int := 0; n_high int := 0; n_peak int := 0; anchor numeric;
begin
  select * into st from stays where id = p_stay;
  if st.id is null then raise exception 'No such stay'; end if;
  select * into s from settings where id = 1;
  if st.kind = 'trip' then
    base_points := st.points_per_seat * greatest(p_seats,1);
    points := round(st.points_per_seat * (1 + s.service_rate)) * greatest(p_seats,1);
    service_points := points - base_points;
    nights := st.nights; min_nights := st.nights;
    seasons := '{}'::jsonb;
    retail_usd := coalesce(st.retail_usd, 0) * greatest(p_seats, 1);
    return;
  end if;
  -- The public rate has to move with the calendar the same way ours does, or the comparison is
  -- theatre. retail_usd on the row is a DEAR-season figure, so held flat across a September
  -- week it compared a cheap week of ours against a Christmas week of theirs. Scaled by the same
  -- band ratio our own rates carry, exactly as quoteStay() does in money.js — request_redemption
  -- used to store the flat product, so every low-season booking overstated its saving for ever.
  anchor := coalesce(st.rate_high_usd, 0);
  base_points := 0; points := 0; retail_usd := 0; nights := p_out - p_in; d := p_in;
  while d < p_out loop
    sea := season_for(d);
    rate := case sea when 'peak' then st.rate_peak_usd when 'high' then st.rate_high_usd else st.rate_low_usd end;
    base_points := base_points + round(rate * s.points_per_dollar);
    points := points + round(rate * s.points_per_dollar * (1 + s.service_rate));
    retail_usd := retail_usd + coalesce(st.retail_usd, 0) * case when anchor > 0 then rate / anchor else 1 end;
    if sea = 'peak' then n_peak := n_peak + 1; elsif sea = 'high' then n_high := n_high + 1; else n_low := n_low + 1; end if;
    d := d + 1;
  end loop;
  retail_usd := round(retail_usd, 2);
  service_points := points - base_points;
  min_nights := case when n_peak > 0 then greatest(coalesce(st.min_nights,1), coalesce(st.peak_min_nights, st.min_nights, 1))
                     else coalesce(st.min_nights,1) end;
  seasons := jsonb_build_object('low', n_low, 'high', n_high, 'peak', n_peak);
end $$;

-- =====================================================================
--  Money. Only the Banker mints; only the Desk quotes.
-- =====================================================================

-- How many promotional points may still be minted for a month (40% of that month's share).
create or replace function promo_room(p_month text) returns int
language sql stable security definer set search_path = public as $$
  select greatest(0, floor(
      coalesce((select sum(c.received_usd) from contributions c
                 where c.for_month = p_month and c.status = 'confirmed'),0)
        * (select service_rate * points_per_dollar * promo_cap_rate from settings where id = 1)
      - coalesce((select sum(l.points) from ledger l
                  join contributions c2 on c2.id = l.ref_id and l.ref_type = 'contribution'
                  where l.kind in ('bonus','streak','founding') and c2.for_month = p_month
                    -- a reversed confirmation's promo has been handed back by its reverse line;
                    -- counting it here consumed the month's room for a bonus nobody holds
                    and c2.status <> 'reversed'),0)
    ))::int
$$;

-- The two-argument form predates the currency columns. Left in place it stays callable and,
-- worse, the lock-down loop below matches on name and re-GRANTS it. Same mechanism that kept an
-- ungated create_crew(text,text) live for weeks.
drop function if exists confirm_contribution(uuid, text);
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

  -- Nothing is taken here any more. Every dollar backs a point and goes to the Reserve; the
  -- Circle's 15% is charged when points are spent on a room (see quote_points). share_usd stays
  -- as a column, and stays at zero, so old rows and the treasury view keep meaning what they meant.
  share   := 0;
  backing := received;
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

  -- Promotional points are still the Circle's own money. The budget used to be a share of what
  -- came in the door; there is no such share now, so it is the same fraction of the same
  -- contributions — the margin those months will earn when the rooms are booked.
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
        and l.note = n_streak || ' consecutive contributions'
        -- a reversed confirmation leaves its line in the append-only ledger; it does not count
        and not exists (select 1 from contributions cx where cx.id = l.ref_id and cx.status = 'reversed')) then
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
     and not exists (select 1 from ledger l where l.member_id = c.member_id and l.kind = 'founding'
                     and not exists (select 1 from contributions cx where cx.id = l.ref_id and cx.status = 'reversed')) then
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
  insert into contributions (member_id, for_month, extra, recorded_by, expected_usd, currency, method, bank, reference, note,
                             proof_path, sent_on, submitted_at, status, reversed_of)
    values (c.member_id, c.for_month, c.extra, c.recorded_by, c.expected_usd, c.currency, c.method, c.bank, c.reference, c.note,
            c.proof_path, c.sent_on, c.submitted_at, 'pending', c.id)
    returning * into again;
  perform log_audit('contribution.reverse','contribution',c.id::text, jsonb_build_object('reopenedAs', again.id));
  return again;
end $$;

-- ---------- redemptions ----------
-- The old 8-argument signature is DROPPED, not left beside the new one: adding a parameter in
-- Postgres overloads rather than replaces, and an ungated older path stays callable forever.
drop function if exists request_redemption(uuid, date, date, int, int, text, int, boolean);
drop function if exists request_redemption(uuid, date, date, int, text);

create or replace function request_redemption(p_stay uuid, p_check_in date, p_check_out date,
  p_guests int default 2, p_seats int default 1, p_note text default '', p_flex int default 0,
  p_shared boolean default false, p_source_url text default null, p_source_label text default null)
returns redemptions language plpgsql security definer set search_path = public as $$
declare st stays; s settings; m members; tier jsonb; me uuid; q record; r redemptions;
        open_count int; window_months int; allow int; extra int;
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

  -- The hold cap is the tier's, plus whatever standing has earned. A member who has been here
  -- long enough to reach Anchor gets one more open request than the tier alone allows, and the
  -- message says which half of the number came from where — otherwise "you can hold 2" reads
  -- like a bug to someone whose tier says 1.
  select count(*) into open_count from redemptions
    where member_id = me and status in ('requested','quoted','held');
  select rp.extra_holds into extra
    from standing_of(me) so, rank_perks(so.rank_index) rp;
  allow := coalesce((tier->>'holds')::int, 1) + coalesce(extra, 0);
  if open_count >= allow then
    if coalesce(extra, 0) > 0 then
      raise exception 'That is % open requests — % for your level and % for your standing. Close one and ask again.',
        allow, coalesce((tier->>'holds')::int, 1), extra;
    else
      raise exception 'You can hold % open request(s) at a time', allow;
    end if;
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
                          indicative_points, seasons, retail_usd, points, status, shared,
                          source_url, source_label)
    values (me, p_stay, st.kind, coalesce(st.starts_on, p_check_in), coalesce(st.ends_on, p_check_out), q.nights,
            case when st.kind = 'trip' then p_seats else p_guests end,
            case when st.kind = 'trip' then p_seats else null end, p_flex, p_note,
            q.points, q.seasons, q.retail_usd,
            q.points, 'requested', p_shared,
            -- The listing they were looking at. clean_link() is the same guard the deals board
            -- uses: http/https only. A member-supplied URL lands on a screen the Desk clicks.
            clean_link(p_source_url), nullif(btrim(coalesce(p_source_label,'')), ''))
    returning * into r;
  perform log_audit('redemption.request','redemption',r.id::text,
    jsonb_build_object('stay', st.name, 'nights', q.nights, 'points', q.points, 'source', clean_link(p_source_url)));
  return r;
end $$;

-- Same overload trap as above: adding p_look would leave the ungated six-argument function live.
drop function if exists quote_redemption(uuid, int, jsonb, text, date, text);

-- Out of an all-in quote, what the HOTEL is owed — the figure that actually leaves the Reserve.
-- quoted_points includes the Circle's share, so paying the whole of it books the club's own
-- income as cash handed over: service_earned reads ~$0 for ever and the Reserve looks 15%
-- emptier than it is, on every booking. Prefer the quote's own stack, which carries the hotel
-- lines the Desk typed; otherwise take the share back out arithmetically. Twin of
-- hotelOwedUsd() in js/core/money.js.
create or replace function hotel_owed_usd(p_quoted_points int, p_stack jsonb)
returns numeric language plpgsql stable set search_path = public as $$
declare s settings; hotel numeric;
begin
  select * into s from settings where id = 1;
  if p_stack is not null and jsonb_typeof(p_stack) = 'object' then
    select coalesce(sum((value)::numeric), 0) into hotel
      from jsonb_each_text(p_stack) where key <> 'share';
    if hotel > 0 then return round(hotel, 2); end if;
  end if;
  return round(coalesce(p_quoted_points, 0)::numeric / (1 + s.service_rate) / s.points_per_dollar, 2);
end $$;
revoke all on function hotel_owed_usd(int, jsonb) from public, anon;
grant execute on function hotel_owed_usd(int, jsonb) to authenticated;

create or replace function quote_redemption(p_id uuid, p_points int, p_stack jsonb default null,
  p_terms text default '', p_deadline date default null, p_note text default '',
  p_look uuid default null)
returns redemptions language plpgsql security definer set search_path = public as $$
declare r redemptions; s settings; st stays; avail int; covered int; pledged int; l looks;
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

  -- The Circle's share has to be IN the quote. Every screen tells the member it is, and it is
  -- the club's only income — but the Desk's composer published the hotel's cash exactly and
  -- nobody noticed, because its pre-filled defaults were fractions of the all-in price and
  -- happened to add back up. So the arithmetic is checked rather than trusted: when a stack is
  -- given, the points must be the hotel lines plus the share on top. Mirrors the same guard in
  -- store.js quoteRedemption; a rule enforced in one backend is not enforced.
  if p_stack is not null and jsonb_typeof(p_stack) = 'object' then
    declare hotel numeric; want int;
    begin
      select coalesce(sum((value)::numeric), 0) into hotel
        from jsonb_each_text(p_stack) where key <> 'share';
      if hotel > 0 then
        want := round(hotel * (1 + s.service_rate) * s.points_per_dollar);
        -- A dollar of slack: the composer rounds the share to cents before adding it.
        if abs(p_points - want) > s.points_per_dollar then
          raise exception 'That quote leaves out the Circle''s share: % points of hotel should be quoted at %.',
            round(hotel * s.points_per_dollar), want;
        end if;
      end if;
    end;
  end if;

  -- THE GATE. A trip is the Circle's own inventory with seats already enforced, so there is no
  -- public page to look at; requests older than settings.looks_from predate the gate and are
  -- exempt, so shipping it does not brick the open queue.
  if st.kind <> 'trip' and r.requested_at >= coalesce(s.looks_from, 'infinity'::timestamptz) then
    if p_look is null then
      select * into l from look_for(r.stay_id, r.check_in, r.check_out);
    else
      select * into l from looks where id = p_look;
      if l.id is null then raise exception 'No such look'; end if;
      if l.stay_id <> r.stay_id then raise exception 'That look is for a different property'; end if;
      if l.by_robot then raise exception 'That is the watcher''s find, not a look. Open it yourself first.'; end if;
      if l.check_in > r.check_in or l.check_out < r.check_out then
        raise exception 'That look does not cover these nights';
      end if;
    end if;
    if l.id is null then
      raise exception 'Open the link and say what you saw before you price it. A quote with nothing behind it is the thing we are getting rid of.';
    end if;
    if l.found = 'gone' then
      raise exception 'The last look says that week was gone. Look again, or decline it.';
    end if;
    if l.found = 'unclear' then
      raise exception 'The last look says it was not clear. Ring them, or look again.';
    end if;
  end if;

  avail := greatest(available_points(r.member_id), 0);
  pledged := coalesce((select sum(points) from pledges where redemption_id = p_id), 0);
  covered := least(greatest(p_points - pledged, 0), avail);
  update redemptions set status='quoted', quoted_points=p_points, points=covered,
         top_up_usd = round(greatest(p_points - covered - pledged, 0)::numeric / s.points_per_dollar, 2),
         quote_stack=p_stack, hotel_terms=p_terms, hotel_deadline=p_deadline, decision=p_note,
         quoted_by=current_member_id(), quoted_at=now(),
         quote_look_id = l.id,
         -- A quote cannot outlive the look it was made against. But a stale look never dead-ends
         -- the Desk: it costs the member acceptance time instead, down to a floor. A hard recency
         -- refusal on a man with a job produces invented looks, and an invented look is worse
         -- than an honest old one.
         quote_expires_at = greatest(
           least(now() + make_interval(hours => s.quote_hours),
                 coalesce(l.good_until, now() + make_interval(hours => s.quote_hours))),
           now() + make_interval(hours => s.min_quote_hours))
  where id = p_id returning * into r;
  perform log_audit('redemption.quote','redemption',r.id::text,
    jsonb_build_object('points', p_points, 'topUpUsd', r.top_up_usd, 'look', l.id));
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
  -- Do not raise here. A raise aborts the transaction, which would undo the very update that
  -- records the expiry, so the row stayed 'quoted' forever while the member was told it had
  -- lapsed — and the Desk went on seeing an open quote. Write the truth and hand the row
  -- back; the client reads the status and says so.
  if r.quote_expires_at < now() then
    update redemptions set status='expired', decided_at=now(),
           decision='Quote expired before it was accepted' where id = p_id returning * into r;
    perform log_audit('redemption.expire','redemption',r.id::text, jsonb_build_object('at', now()));
    return r;
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

-- A database that already exists gets the column here; a fresh build has it in the table.
alter table redemptions add column if not exists top_up_received_usd numeric(10,2);

create or replace function confirm_top_up(p_id uuid)
returns redemptions language plpgsql security definer set search_path = public as $$
declare r redemptions;
begin
  if not has_role('treasurer','deputy','admin') then raise exception 'Only the Banker can confirm a top-up'; end if;
  select * into r from redemptions where id = p_id for update;
  if r.id is null then raise exception 'No such request'; end if;
  if r.status not in ('quoted','held') then raise exception 'A top-up is only owed on a live quote'; end if;
  if coalesce(r.top_up_usd, 0) <= 0 then raise exception 'No top-up is owed on this booking'; end if;
  -- Recorded as a fact, at the moment the Banker says he has it. A later pledge changes what
  -- is owed, never what was received — and confirming again can only ever raise it: a second
  -- tap while less is owed must not erase the record of cash already in hand.
  update redemptions set top_up_confirmed = true,
         top_up_received_usd = greatest(coalesce(top_up_received_usd, 0), r.top_up_usd)
    where id = p_id returning * into r;
  perform log_audit('redemption.topup','redemption',r.id::text,
    jsonb_build_object('topUpUsd', r.top_up_usd, 'receivedUsd', r.top_up_received_usd));
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
    where id = p_id;
  -- What was received is a fact; whether it still covers what is owed is not.
  update redemptions set top_up_confirmed = (top_up_received_usd >= top_up_usd)
    where id = p_id and top_up_received_usd is not null;
  select * into r from redemptions where id = p_id;
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
    where id = p_id;
  -- What was received is a fact; whether it still covers what is owed is not.
  update redemptions set top_up_confirmed = (top_up_received_usd >= top_up_usd)
    where id = p_id and top_up_received_usd is not null;
  select * into r from redemptions where id = p_id;
  perform log_audit('redemption.pledge.withdraw','redemption',p_id::text, jsonb_build_object('memberId', target));
  return r;
end $$;

create or replace function pay_redemption(p_id uuid, p_paid_usd numeric default null, p_confirmation text default '')
returns redemptions language plpgsql security definer set search_path = public as $$
declare r redemptions; s settings; st stays; l looks; pl pledges;
begin
  if not has_role('treasurer','deputy','planner','admin') then raise exception 'Only the Banker or the Desk can pay a hotel'; end if;
  select * into r from redemptions where id = p_id for update;
  if r.id is null then raise exception 'No such request'; end if;
  if r.status <> 'held' then raise exception 'The member has not accepted a quote yet'; end if;
  if coalesce(r.top_up_usd, 0) > coalesce(r.top_up_received_usd, 0) then
    raise exception 'The top-up of $% has not been received — the Banker has $%',
      to_char(r.top_up_usd,'FM999999.00'), to_char(coalesce(r.top_up_received_usd,0),'FM999999.00');
  end if;
  select * into s from settings where id = 1;
  select * into st from stays where id = r.stay_id;

  -- The gate on the quote protects what the member expects. THIS one protects the money: this is
  -- the irreversible act — points burn here, the pledgers' points burn here, and paid_usd leaves
  -- the club here. Days pass between a member accepting and the Desk booking, and a week can go
  -- in that time. It costs nothing in practice: at this moment the Desk is on the booking page.
  if st.kind <> 'trip' and r.requested_at >= coalesce(s.looks_from, 'infinity'::timestamptz) then
    select * into l from look_for(r.stay_id, r.check_in, r.check_out, r.held_at);
    if l.id is null then
      raise exception 'Look at it once more before you pay. Nobody has looked at these nights since % accepted.',
        coalesce((select split_part(name,' ',1) from members where id = r.member_id), 'the member');
    end if;
    if l.found in ('gone','unclear') then
      raise exception 'The last look says that week was %. Do not pay for it.', l.found;
    end if;
  end if;

  -- Days pass between accepting and paying, and in that time a Month Close can expire
  -- promotional points or a correction can post. accept_quote clamped to what was available
  -- THEN; this burns NOW, so ask again. The local store already refused this spend and the
  -- server did not — the ledger went below its commitments and the next close failed its
  -- variance check with no line saying why.
  if available_points(r.member_id) < 0 then raise exception 'Member no longer has enough points'; end if;
  for pl in select * from pledges where redemption_id = r.id loop
    if available_points(pl.member_id) < 0 then
      raise exception '% no longer has the points they chipped in',
        coalesce((select name from members where id = pl.member_id), 'A member');
    end if;
  end loop;

  update redemptions set status='confirmed', confirmed_at=now(), decided_by=current_member_id(), decided_at=now(),
         paid_usd = coalesce(p_paid_usd, hotel_owed_usd(r.quoted_points, r.quote_stack)),
         confirmation_ref = p_confirmation,
         approved_at = coalesce(approved_at, now()), approved_by = coalesce(approved_by, current_member_id())
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

  -- The booking is the last and best look: the one moment somebody did not just see the room,
  -- they took it. Recorded so the history does not end on a maybe.
  insert into looks (stay_id, redemption_id, check_in, check_out, found, channel, url, label,
                     note, looked_by, good_until)
  values (r.stay_id, r.id, r.check_in, r.check_out, 'booked', 'site',
          coalesce(clean_link(r.source_url), clean_link(st.site)), 'Booked',
          nullif(p_confirmation,''), current_member_id(), now() + interval '3650 days')
  returning id into l.id;
  update redemptions set last_look_id = l.id where id = r.id;

  perform log_audit('redemption.pay','redemption',r.id::text,
    jsonb_build_object('points', r.points, 'paidUsd', r.paid_usd, 'confirmationRef', p_confirmation));
  return r;
end $$;

-- Victor picks it up. Nothing about the money moves here — the status stays held — but from
-- this moment the member is told, truthfully, that he has it and is booking it. Mirrors
-- Store.approveRedemption(); a second tap is a no-op, not an error.
create or replace function approve_redemption(p_id uuid)
returns redemptions language plpgsql security definer set search_path = public as $$
declare r redemptions;
begin
  if not has_role('planner','admin') then raise exception 'Only the Desk can approve a booking'; end if;
  select * into r from redemptions where id = p_id for update;
  if r.id is null then raise exception 'No such request'; end if;
  if r.status <> 'held' then raise exception 'A request is approved once the member has accepted the price'; end if;
  if r.approved_at is not null then return r; end if;
  update redemptions set approved_at = now(), approved_by = current_member_id() where id = p_id returning * into r;
  perform log_audit('redemption.approve','redemption',r.id::text,'{}'::jsonb);
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

drop function if exists cancel_redemption(uuid, text);
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
     s as (select * from settings where id = 1),
     parts as (
       select round(coalesce((select sum(backing_usd) from confirmed),0),2) as backing,
              round((select pts from promo) / (select points_per_dollar from s), 2) as promo_usd,
              -- what the Banker actually received; a row confirmed before the column existed
              -- falls back to what was owed at the time
              round(coalesce((select sum(coalesce(top_up_received_usd, case when top_up_confirmed then top_up_usd else 0 end)) from settled),0),2) as top_ups,
              round(coalesce((select sum(coalesce(paid_usd,0)) from settled),0),2) as paid_out,
              round(coalesce((select sum(points) from ledger where kind='refund'),0)::numeric / (select points_per_dollar from s),2) as refunded,
              round(coalesce((select sum(points) from ledger where kind='adjust'),0)::numeric / (select points_per_dollar from s),2) as adjust,
              round(-coalesce((select sum(points) from ledger where kind='expire'),0)::numeric / (select points_per_dollar from s),2) as expired,
              round(coalesce((select sum(points) from ledger),0)::numeric / (select points_per_dollar from s),2) as liability)
select
  round(coalesce((select sum(received_usd) from confirmed),0),2) as collected_usd,
  round(coalesce((select sum(share_usd) from confirmed),0),2)    as share_usd,
  p.backing   as backing_usd,
  p.promo_usd as promo_usd,
  p.paid_out  as paid_out_usd,
  p.top_ups   as top_ups_usd,
  p.refunded  as refunded_usd,
  p.adjust    as adjust_usd,
  p.expired   as expired_usd,
  coalesce((select sum(points) from ledger),0)::int as outstanding_points,
  p.liability as liability_usd,
  -- The Circle's income: what the Reserve holds over and above what it owes. Every booking
  -- hands back more in points than it takes out in cash, and the difference settles here.
  -- True whatever any particular quote looked like, and it needs no history to be right.
  round(p.backing + p.promo_usd + p.top_ups - p.paid_out + p.refunded + p.adjust - p.expired
        - p.liability, 2) as service_earned_usd
from parts p;


create or replace function reserve_expected_usd() returns numeric
language sql stable security definer set search_path = public as $$
  select round(backing_usd + promo_usd + top_ups_usd - paid_out_usd + refunded_usd + adjust_usd - expired_usd, 2)
  from treasury
$$;

-- Who may put the second signature on the books. The close only ever checked that the co-signer
-- was not the person closing — not that they were an officer, a member, or a person at all, so
-- the second name on the club's accounts could have been the watcher or any id whatsoever.
create or replace function assert_cosigner(p_cosigner uuid) returns void
language plpgsql stable security definer set search_path = public as $$
declare c members;
begin
  if p_cosigner is null or p_cosigner = current_member_id() then
    raise exception 'A second officer must co-sign the close';
  end if;
  select * into c from members where id = p_cosigner;
  if c.id is null then raise exception 'That co-signer is not on the list'; end if;
  if c.bot then raise exception 'A robot cannot co-sign the books'; end if;
  if c.status not in ('active','paused') then raise exception '% has left the Circle', c.name; end if;
  if not (c.roles && array['treasurer','deputy','planner','comms','admin']::member_role[]) then
    raise exception '% is not an officer', c.name;
  end if;
end $$;

create or replace function close_month(p_month text, p_bank_balance_usd numeric, p_cosigner uuid, p_note text default '')
returns month_closes language plpgsql security definer set search_path = public as $$
declare s settings; expected_reserve numeric; variance numeric; c month_closes; t treasury%rowtype;
        pending_count int; l ledger; d promo_deferrals; room int;
begin
  if not has_role('treasurer','deputy','admin') then raise exception 'Only the Banker can close a month'; end if;
  if exists (select 1 from month_closes where month = p_month) then raise exception '% is already closed', p_month; end if;
  perform assert_cosigner(p_cosigner);
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
           and not exists (select 1 from ledger x where x.kind='expire' and x.ref_ledger_id = ledger.id) loop
    insert into ledger(member_id, kind, points, usd, ref_type, ref_ledger_id, note, by_id)
      values (l.member_id, 'expire', -l.points, -coalesce(l.usd,0), 'ledger', l.id, 'Expired · ' || l.note, current_member_id());
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
            (select count(*) from members mm where mm.status in ('active','paused') and not mm.bot
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
  -- A robot sends no money. A row against one would sit in the queue and wedge the close.
  if m.bot then raise exception '% is a robot, not a member who pays', m.name; end if;
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
-- A link the board can safely offer. The board renders source_url as a "Go and book it" button
-- in front of an officer, and links arrive from the paste parser, the email ingest and the
-- watcher — none of them ours to trust. Escaping stops a value breaking out of the attribute
-- but does nothing about the scheme, so `javascript:` would have been a working button.
-- Refused loudly rather than dropped quietly, so a mistake is visible.
create or replace function clean_link(p_url text) returns text
language plpgsql immutable set search_path = public as $$
declare u text := nullif(trim(coalesce(p_url, '')), '');
begin
  if u is null then return null; end if;
  if u !~* '^https?://[^\s<>"]+$' then
    raise exception 'A link has to start with http:// or https:// — got %', left(u, 40);
  end if;
  return u;
end $$;

-- The watcher on the VPS needs to post a deal and must be able to do nothing else. Giving it
-- the Voice role was the obvious way and the wrong one: stays_write and announcements_write are
-- both `all` to comms, so a password sitting in a plain file on a rented machine could re-price
-- the entire catalog or rewrite the club's announcements. It gets this instead, and no role.
-- Only post_deal calls it, and that is security definer, so nobody is granted execute.
create or replace function current_is_bot() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where auth_user_id = auth.uid() and bot and status = 'active')
$$;
revoke all on function current_is_bot() from public, anon, authenticated;

create or replace function post_deal(
  p_stay uuid, p_from date, p_to date, p_points int,
  p_room_type uuid default null, p_title text default null, p_nights int default null,
  p_retail_usd numeric default null, p_source text default 'other', p_source_url text default '',
  p_source_ref text default '', p_units int default 1, p_expires_at timestamptz default null,
  p_note text default '')
returns deals language plpgsql security definer set search_path = public as $$
declare d deals; st stays; n int;
begin
  -- Victor, Ian, or a robot that does nothing else.
  if not (has_role('planner','comms','admin') or current_is_bot()) then
    raise exception 'Only Victor or Ian can post a deal';
  end if;
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
            round(p_points::numeric / n), p_retail_usd, p_source, clean_link(p_source_url),
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
-- Row-level security cannot narrow to columns, so the column grant does it: the Banker keeps
-- the two account fields and the wallet, and everything that prices a point goes through
-- update_club_rules(), which requires an admin.
revoke update on settings from authenticated;
grant update (reserve_account, operating_account, wallet, updated_at) on settings to authenticated;

drop policy if exists settings_write on settings;
create policy settings_write on settings for update to authenticated
  using ((select has_role('admin','treasurer'))) with check ((select has_role('admin','treasurer')));

drop policy if exists members_read on members;
create policy members_read on members for select to authenticated using (current_member_id() is not null);
-- Row-level security cannot restrict columns, and members_read hands every Insider every
-- column of every row. Two of those have no business being club-wide: `notes` is what an
-- officer wrote about a member, readable by that same member, and auth_user_id is the link
-- to their login account. The app reads neither.
--
-- A security_invoker view is how the columns get dropped without losing the row policy: it
-- runs as the caller, so members_read still decides which rows come back. `claimed` replaces
-- auth_user_id with the one fact the sign-in screen actually needs.
--
-- Being honest about what this does not fix: showOnRollcall is still only respected by the
-- screens. A member who opts out is hidden in the app but their row is still readable. For a
-- forty-seat club of people who know each other that is a fair line, but it is a convention
-- rather than a guarantee.
drop view if exists members_v;
create view members_v with (security_invoker = on) as
  select id, email, name, username, must_change_password, bot, phone, roles, status, monthly_usd, hue, home, title, joined_at,
         founding, sponsor_id, card_code, household, preferences, standing_order,
         show_on_rollcall, paused_until, paused_months, dream_stay_id, goal, left_at,
         (auth_user_id is not null) as claimed
    from members;
-- security_invoker means the caller needs the underlying columns too, so this is a column
-- grant rather than a table one. auth_user_id stays granted because the view's `claimed`
-- expression reads it; the view does not return it, so nothing the app passes around carries
-- it. `notes` is granted to nobody.
revoke select on members from authenticated, anon;
grant select (id, auth_user_id, email, name, username, must_change_password, bot, phone, roles, status, monthly_usd, hue, home,
              title, joined_at, founding, sponsor_id, card_code, household, preferences,
              standing_order, show_on_rollcall, paused_until, paused_months, dream_stay_id,
              goal, left_at)
  on members to authenticated;
grant select on members_v to authenticated;
revoke all on members_v from anon;
-- Nobody edits a member row directly: roles, status and founding are not the member's to
-- change, and row-level security cannot restrict columns. Both paths below are functions.
drop policy if exists members_self on members;
drop policy if exists members_admin on members;
revoke insert, update, delete on members from authenticated;

create or replace function update_my_profile(p_patch jsonb)
returns members language plpgsql security definer set search_path = public as $$
declare m members; me uuid; want_accent text; want_cover text;
begin
  me := current_member_id();
  if me is null then raise exception 'Not a member'; end if;

  -- Only accents that exist in the palette, only covers the club ships. Anything else is
  -- refused rather than stored, so a bad value can never reach a page.
  want_accent := nullif(btrim(coalesce(p_patch->>'accent','')), '');
  if want_accent is not null and want_accent not in ('good','flight','flag','ink','sea','sand') then
    raise exception '% is not one of the Circle''s colours', want_accent;
  end if;
  want_cover := nullif(btrim(coalesce(p_patch->>'cover','')), '');
  if want_cover is not null and want_cover not in
     ('hero','band-how','band-pool','band-circle','band-open','band-rules',
      'season-summer','season-winter','season-peak','season-carnival','signin') then
    raise exception 'That is not one of the Circle''s covers';
  end if;

  update members set
    name             = coalesce(p_patch->>'name', name),
    phone            = coalesce(p_patch->>'phone', phone),
    preferences      = coalesce(p_patch->'preferences', preferences),
    household        = coalesce(p_patch->'household', household),
    show_on_rollcall = coalesce((p_patch->>'showOnRollcall')::boolean, show_on_rollcall),
    standing_order   = coalesce((p_patch->>'standingOrder')::boolean, standing_order),
    dream_stay_id    = coalesce((p_patch->>'dreamStayId')::uuid, dream_stay_id),
    goal             = case when p_patch ? 'goal' then p_patch->'goal' else goal end,
    monthly_usd      = coalesce((p_patch->>'monthlyUsd')::int, monthly_usd),
    -- 200 characters. Long enough to say something, short enough that nobody writes an essay.
    about            = case when p_patch ? 'about'  then left(nullif(btrim(p_patch->>'about'),''), 200) else about end,
    accent           = case when p_patch ? 'accent' then want_accent else accent end,
    cover            = case when p_patch ? 'cover'  then want_cover  else cover  end
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
  if p_status = 'paused' and p_paused_until !~ '^\d{4}-\d{2}$' then raise exception 'Say which month you will resume from'; end if;
  -- Every month from now up to the resume month is a paused month, so the streak steps over
  -- each one and none is counted as owed. This appended exactly ONE month per call, so a
  -- three-month pause still counted two as owed. An early return drops the months that never
  -- came. Twin of pauseMember()/resumeMember() in the store.
  update members set status = p_status,
    paused_until = case when p_status = 'paused' then p_paused_until else null end,
    paused_months = case
      when p_status = 'paused' then (
        select coalesce(array_agg(distinct x order by x), '{}')
          from unnest(coalesce(paused_months, '{}') || coalesce((
            select array_agg(to_char(d, 'YYYY-MM'))
              from generate_series(date_trunc('month', now()),
                                   (p_paused_until || '-01')::date - interval '1 month',
                                   interval '1 month') d), '{}')) x)
      when p_status = 'active' then (
        select coalesce(array_agg(x order by x), '{}')
          from unnest(coalesce(paused_months, '{}')) x where x <= to_char(now(), 'YYYY-MM'))
      else paused_months end,
    left_at = case when p_status = 'left' then now() else null end
  where id = me returning * into m;
  perform log_audit('member.status','member',me::text, jsonb_build_object('status', p_status));
  return m;
end $$;

-- The rules of the club are the Admin's, not the Banker's. The Banker legitimately edits the
-- Reserve and Operating account details, which live in the same row — so the split is done
-- with a column grant rather than by tightening settings_write, which would take the
-- accounts away from the person whose job they are.
create or replace function update_club_rules(p_patch jsonb)
returns settings language plpgsql security definer set search_path = public as $$
declare s settings;
begin
  if not has_role('admin') then raise exception 'Only an admin can change the rules of the club'; end if;
  update settings set
    club_name         = coalesce(p_patch->>'clubName', club_name),
    service_rate      = coalesce((p_patch->>'serviceRate')::numeric, service_rate),
    points_per_dollar = coalesce((p_patch->>'pointsPerDollar')::int, points_per_dollar),
    awg_per_usd       = coalesce((p_patch->>'awgPerUsd')::numeric, awg_per_usd),
    tiers             = coalesce(p_patch->'tiers', tiers),
    quote_hours       = coalesce((p_patch->>'quoteHours')::int, quote_hours),
    banker_sla_hours  = coalesce((p_patch->>'bankerSlaHours')::int, banker_sla_hours),
    exit_fee_usd      = coalesce((p_patch->>'exitFeeUsd')::numeric, exit_fee_usd),
    member_cap        = coalesce((p_patch->>'memberCap')::int, member_cap),
    updated_at        = now()
  where id = 1 returning * into s;
  perform log_audit('settings.rules','settings','settings', p_patch);
  return s;
end $$;

create or replace function admin_update_member(p_id uuid, p_patch jsonb)
returns members language plpgsql security definer set search_path = public as $$
declare m members;
begin
  if not has_role('admin') then raise exception 'Only an admin can change a membership'; end if;
  -- Two rows on one address means one sign-in matching two memberships. The unique index on
  -- lower(email) would catch it anyway, but not in words anyone would want to read.
  if p_patch ? 'email' and coalesce(trim(p_patch->>'email'), '') <> ''
     and exists (select 1 from members where id <> p_id and lower(email) = lower(trim(p_patch->>'email'))) then
    raise exception 'Someone else is already on that email';
  end if;
  update members set
    name        = coalesce(p_patch->>'name', name),
    email       = case when p_patch ? 'email' then nullif(trim(p_patch->>'email'), '') else email end,
    phone       = coalesce(p_patch->>'phone', phone),
    roles       = coalesce((select array_agg(x::member_role) from jsonb_array_elements_text(p_patch->'roles') x), roles),
    status      = coalesce((p_patch->>'status')::member_status, status),
    monthly_usd = coalesce((p_patch->>'monthlyUsd')::int, monthly_usd),
    founding    = coalesce((p_patch->>'founding')::boolean, founding),
    -- Ticking "this is a robot" on a person by mistake had no undo: nothing here wrote the
    -- column, so the row stayed uncounted and unchased with no way back short of SQL.
    bot         = coalesce((p_patch->>'bot')::boolean, bot),
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
  -- A machine account does not sit in one of the forty seats: it is not counted against the
  -- cap, and the cap does not stand in its way either. Only counting was fixed the first time,
  -- which meant that on the day the club filled up a second robot could no longer be added.
  if not coalesce((p_patch->>'bot')::boolean, false)
     and (select count(*) from members where status in ('active','paused') and not bot) >= s.member_cap then
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

  insert into members(email, name, phone, monthly_usd, roles, status, founding, home, title, card_code, bot)
    values (nullif(trim(p_patch->>'email'), ''), trim(p_patch->>'name'), nullif(trim(p_patch->>'phone'), ''),
            coalesce((p_patch->>'monthlyUsd')::int, 100), wanted, 'invited',
            coalesce((p_patch->>'founding')::boolean,
                     (select count(*) from members where not bot) < s.founding_seats),
            nullif(trim(p_patch->>'home'), ''), nullif(trim(p_patch->>'title'), ''),
            upper(substr(md5(random()::text), 1, 6)),
            coalesce((p_patch->>'bot')::boolean, false))
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
              and points is null and share_usd is null and received_usd is null
              -- Only record_direct_contribution may stamp a row as the Banker's, and a proof
              -- must be the member's own upload: without these a member could insert a row that
              -- renders in the Banker's queue as "entered by the Banker" with somebody else's
              -- screenshot attached, inviting a one-tap confirm for money nobody sent.
              and recorded_by is null
              and (proof_path is null or proof_path like current_member_id()::text || '/%')
              -- A robot has no money to send, and one pending row against it would wedge
              -- every future close, which waits for the queue to be empty.
              and not exists (select 1 from members m where m.id = member_id and m.bot));

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
    'accept_quote','add_watch','adjust_points','admin_add_member','admin_update_member','approve_redemption',
    'available_points','cancel_redemption','claim_membership','close_month','committed_points',
    'complete_redemption','confirm_contribution','confirm_top_up','consecutive_months','covered_points',
    'create_crew','current_member_id','deal_matches_watch','decline_redemption','easter_sunday','has_role',
    'ledger_balance','ledger_is_append_only','log_audit','mark_watches_seen','my_matches',
    'pay_redemption','pledge_to_redemption','post_deal','promo_room','quote_points',
    'quote_redemption','record_direct_contribution','reject_contribution','release_expired_quotes',
    'update_club_rules','admin_set_login','password_changed',
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

-- Helpers nobody outside the database should call. They were revoked only from authenticated,
-- which leaves the EXECUTE TO PUBLIC every function is born with — and assert_cosigner is
-- SECURITY DEFINER, reads members past RLS, and raises "% has left the Circle" / "% is not an
-- officer" with the name in it, so anyone holding the publishable key could turn a member id
-- into a name, a status and whether they hold office. Their only callers are definer functions.
revoke all on function valid_username(text), assert_cosigner(uuid), clean_link(text)
  from public, anon, authenticated;

-- Triggers, and helpers that take a member id. Nothing outside the database should be able
-- to call these, not even a signed-in member.
--
-- The balance helpers matter most. ledger_read only lets a member see their own ledger rows,
-- but ledger_balance(uuid) is SECURITY DEFINER, so it reads straight past that policy and
-- answers for anybody. Every member id is readable (the roll call needs them), so leaving
-- these callable handed every Insider a way to look up anyone's exact balance — precisely
-- what the policy exists to prevent. They stay callable from inside the SECURITY DEFINER
-- functions that legitimately need them, because those execute as the owner.
do $$
declare fn text;
begin
  for fn in
    select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in (
       'log_audit','ledger_is_append_only','set_updated_at',
       'ledger_balance','committed_points','available_points','covered_points','consecutive_months',
       'promo_room','quote_points','reserve_expected_usd','season_for','easter_sunday',
       'deal_matches_watch','valid_username','current_is_bot','assert_cosigner','clean_link')
     -- NOT has_role or current_member_id: eighteen and sixteen row-level security policies
     -- call them, and a policy expression is evaluated as the querying user, so revoking
     -- those would make every policy in the database fail and lock everyone out.
     -- NOT release_expired_quotes: the client calls it directly at sign-in.
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

-- =====================================================================
--  Crews, their chat, and the pictures people bring home
-- =====================================================================
-- A crew is who you actually travel with — the four who split a villa, the family group, the
-- ones who always go in October. It is named by the people in it, it has its own thread, and
-- its pictures stay inside it unless somebody posts them to the whole Circle. Deliberately NOT
-- the same thing as chipping in: a pledge is money on one booking, a crew outlives any week.
--
-- All of it is built and live. Whether members can post pictures is settings.moments_on, which
-- is off until Victor turns it on in Settings.

create table if not exists crews (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 2 and 40),
  about       text,
  cover_path  text,
  created_by  uuid not null references members(id),
  created_at  timestamptz not null default now(),
  archived_at timestamptz
);

create table if not exists crew_members (
  crew_id   uuid not null references crews(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  role      text not null default 'member' check (role in ('lead','member')),
  joined_at timestamptz not null default now(),
  primary key (crew_id, member_id)
);
create index if not exists crew_members_by_member on crew_members(member_id);

create table if not exists crew_messages (
  id         bigserial primary key,
  crew_id    uuid not null references crews(id) on delete cascade,
  member_id  uuid not null references members(id),
  body       text,
  moment_id  uuid,
  created_at timestamptz not null default now(),
  edited_at  timestamptz,
  deleted_at timestamptz,
  check (coalesce(btrim(body),'') <> '' or moment_id is not null)
);
create index if not exists crew_messages_thread on crew_messages(crew_id, id desc);

-- The file itself lives in storage, byte for byte as the phone made it; this row is only the
-- label on it. width/height/duration are read off the file in the browser for layout — nothing
-- is re-encoded, ever, because re-encoding IS the quality loss.
create table if not exists moments (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references members(id) on delete cascade,
  crew_id       uuid references crews(id) on delete set null,   -- null = the whole Circle
  stay_id       uuid references stays(id) on delete set null,
  redemption_id uuid references redemptions(id) on delete set null,
  path          text not null unique,
  kind          text not null check (kind in ('photo','video')),
  mime          text,
  bytes         bigint,
  width         int,
  height        int,
  duration_s    numeric(8,2),
  caption       text,
  taken_at      timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists moments_recent on moments(created_at desc);
create index if not exists moments_by_crew on moments(crew_id, created_at desc);

create table if not exists moment_reactions (
  moment_id uuid not null references moments(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  emoji     text not null check (length(emoji) between 1 and 8),
  at        timestamptz not null default now(),
  primary key (moment_id, member_id, emoji)
);

alter table crews            enable row level security;
alter table crew_members     enable row level security;
alter table crew_messages    enable row level security;
alter table moments          enable row level security;
alter table moment_reactions enable row level security;

create or replace function in_crew(p_crew uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from crew_members cm
                  where cm.crew_id = p_crew and cm.member_id = current_member_id())
$$;
create or replace function leads_crew(p_crew uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from crew_members cm
                  where cm.crew_id = p_crew and cm.member_id = current_member_id() and cm.role = 'lead')
$$;

-- Who exists is not a secret among forty friends; what is said inside one is.
drop policy if exists crews_read on crews;
create policy crews_read on crews for select to authenticated using (current_member_id() is not null);
-- No direct INSERT. create_crew() is the only door, because it is the only place the rule "a
-- circle needs an approved room" is checked — a raw insert bypassed every one of those checks
-- and, with redemption_id unchecked, could point a crew at somebody else's shared booking and
-- silently remove it from their list. Same shape as the create_crew(text,text) hole, reached
-- through the table instead of the function. UPDATE stays: renameCrew relies on crews_edit.
drop policy if exists crews_make on crews;
revoke insert, delete on crews from authenticated;
drop policy if exists crews_edit on crews;
create policy crews_edit on crews for update to authenticated
  using ((select leads_crew(id)) or (select has_role('admin')))
  with check ((select leads_crew(id)) or (select has_role('admin')));

drop policy if exists crew_members_read on crew_members;
create policy crew_members_read on crew_members for select to authenticated using (current_member_id() is not null);
drop policy if exists crew_members_write on crew_members;
create policy crew_members_write on crew_members for all to authenticated
  using ((select leads_crew(crew_id)) or member_id = current_member_id() or (select has_role('admin')))
  with check ((select leads_crew(crew_id)) or (select has_role('admin')));

drop policy if exists crew_messages_read on crew_messages;
create policy crew_messages_read on crew_messages for select to authenticated using ((select in_crew(crew_id)));
drop policy if exists crew_messages_send on crew_messages;
create policy crew_messages_send on crew_messages for insert to authenticated
  with check (member_id = current_member_id() and (select in_crew(crew_id))
              and deleted_at is null and edited_at is null);
-- Your own words are yours to change or take back. Nobody else's are.
drop policy if exists crew_messages_own on crew_messages;
create policy crew_messages_own on crew_messages for update to authenticated
  using (member_id = current_member_id()) with check (member_id = current_member_id());

drop policy if exists moments_read on moments;
create policy moments_read on moments for select to authenticated
  using (crew_id is null and current_member_id() is not null or (select in_crew(crew_id)));
drop policy if exists moments_post on moments;
create policy moments_post on moments for insert to authenticated
  with check (member_id = current_member_id()
              and (crew_id is null or (select in_crew(crew_id)))
              and (select moments_on from settings where id = 1));
-- Edit and delete only. This was one `for all` policy, and permissive policies are OR'd, so it
-- granted INSERT on its own terms and moments_post's conditions never had to hold — which made
-- both the on/off switch and, worse, the crew check bypassable. "Own" means own, not new.
drop policy if exists moments_own on moments;
drop policy if exists moments_edit on moments;
create policy moments_edit on moments for update to authenticated
  using (member_id = current_member_id() or (select has_role('admin')))
  with check (member_id = current_member_id() or (select has_role('admin')));
drop policy if exists moments_delete on moments;
create policy moments_delete on moments for delete to authenticated
  using (member_id = current_member_id() or (select has_role('admin')));

drop policy if exists reactions_read on moment_reactions;
create policy reactions_read on moment_reactions for select to authenticated
  using (exists (select 1 from moments mo where mo.id = moment_id
                   and (mo.crew_id is null or (select in_crew(mo.crew_id)))));
drop policy if exists reactions_own on moment_reactions;
create policy reactions_own on moment_reactions for all to authenticated
  using (member_id = current_member_id()) with check (member_id = current_member_id());

-- Naming a crew and being in it are one act, not two.
--
-- crew_members_write lets a lead add people, and leads_crew() asks whether you already hold a
-- lead row. A crew that was just created has no rows at all, so the person who made it could
-- not put themselves in it. Verified live with admin taken away: "name a crew: OK / join it as
-- lead: REFUSED", which made crews unusable by everyone except Victor, who slipped through on
-- has_role('admin').
--
-- Definer, so the two inserts happen together or not at all. It deliberately does NOT loosen
-- crew_members_write: letting anyone insert their own row into any crew would let them read
-- that crew's messages, because in_crew() is what gates them. Checked, with admin removed: a
-- stranger still cannot walk into someone else's crew, cannot make themselves its lead, and
-- reads none of its messages before or after trying.
-- A circle is born from a room the Desk has approved. That is the whole point of one: it exists
-- so the people sharing a booking can talk about it, so there is nothing to talk about until
-- there is a booking.
--
-- The gate was added by giving this function a third argument, and in Postgres that does NOT
-- replace the two-argument version — it creates a second function beside it. The old ungated
-- one stayed live, SECURITY DEFINER, executable by every authenticated member, and it inserted
-- a crew with no check at all. The app never called it (the client always sends p_redemption),
-- but the publishable key is public by design, so a member could call the 2-arg form from the
-- browser console and get a circle with no approved room behind it. Dropped in production
-- 2026-09-07; the drop below is what keeps a fresh build from recreating the hole.
drop function if exists create_crew(text, text);

create or replace function create_crew(p_name text, p_about text, p_redemption uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid; c uuid; r redemptions; nm text;
begin
  me := current_member_id();
  if me is null then raise exception 'Not a member'; end if;

  nm := btrim(coalesce(p_name, ''));
  if length(nm) < 2  then raise exception 'A circle needs a name'; end if;
  if length(nm) > 40 then raise exception 'That name is too long — 40 characters at most'; end if;

  if p_redemption is null then
    raise exception 'Start a circle from a room the Desk has approved — that is what the circle is for';
  end if;

  select * into r from redemptions where id = p_redemption;
  if not found then raise exception 'No such booking'; end if;
  if r.member_id <> me then raise exception 'That booking is not yours'; end if;
  if r.status = 'quoted' then
    raise exception 'Accept the quote first — once the points are committed the room is yours and the circle can start.';
  end if;
  if r.status not in ('held','confirmed','completed') then
    raise exception 'That room is not approved yet — it is %. Once the Desk quotes it and you accept, you can start the circle around it.', r.status;
  end if;

  insert into crews (name, about, created_by, redemption_id)
  values (nm, nullif(btrim(coalesce(p_about, '')), ''), me, p_redemption)
  returning id into c;

  insert into crew_members (crew_id, member_id, role) values (c, me, 'lead');
  perform log_audit('crew.create', 'crew', c::text,
    jsonb_build_object('name', nm, 'redemption', p_redemption));
  return c;
end $$;

revoke all on function create_crew(text, text, uuid) from public, anon;
grant execute on function create_crew(text, text, uuid) to authenticated;

revoke all on function in_crew(uuid), leads_crew(uuid) from public, anon;
grant execute on function in_crew(uuid), leads_crew(uuid) to authenticated;
grant select, insert, update, delete on crews, crew_members, crew_messages, moments, moment_reactions to authenticated;
-- Order matters: the revoke at the crews policies runs BEFORE this grant and was undone by it.
-- A crew is made by create_crew() and nothing else (see crews_make, above).
revoke insert, delete on crews from authenticated;
grant usage, select on sequence crew_messages_id_seq to authenticated;
revoke all on crews, crew_members, crew_messages, moments, moment_reactions from anon;

-- Storage. Two buckets: avatars are public and small; moments are private, served by signed
-- URL, and take the file exactly as the phone made it. On the current plan the ceiling is
-- 50 MB a file and 1 GB for the whole club — which one long 4K clip can use on its own.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880,
        array['image/jpeg','image/png','image/webp','image/avif','image/heic','image/heif'])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('moments', 'moments', false, 52428800, null)
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Paths are <member_id>/<file>, so the first folder decides who may write.
drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects for select to public using (bucket_id = 'avatars');
drop policy if exists avatars_own on storage.objects;
create policy avatars_own on storage.objects for all to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = current_member_id()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = current_member_id()::text);
drop policy if exists moments_file_read on storage.objects;
create policy moments_file_read on storage.objects for select to authenticated
  using (bucket_id = 'moments' and exists (
    select 1 from moments mo where mo.path = storage.objects.name
      and (mo.crew_id is null or in_crew(mo.crew_id))));
drop policy if exists moments_file_write on storage.objects;
create policy moments_file_write on storage.objects for insert to authenticated
  with check (bucket_id = 'moments' and (storage.foldername(name))[1] = current_member_id()::text);
drop policy if exists moments_file_own on storage.objects;
create policy moments_file_own on storage.objects for delete to authenticated
  using (bucket_id = 'moments' and (storage.foldername(name))[1] = current_member_id()::text);

-- Stay photographs. One per stay, uploaded by the Desk, public to read (a stay card is not a
-- secret). Written only under stays/<stay uuid>/ by planner, comms or admin — the folder test is
-- in BOTH halves so a Desk member can neither read-through nor delete outside that folder.
-- A photograph goes in here only when the Desk holds the rights to it: their own, or the
-- resort's media kit. Never a picture copied off a website — see the provenance check on stays.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('stay-photos', 'stay-photos', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists stay_photos_read on storage.objects;
create policy stay_photos_read on storage.objects for select to public using (bucket_id = 'stay-photos');
drop policy if exists stay_photos_desk on storage.objects;
create policy stay_photos_desk on storage.objects for all to authenticated
  using (bucket_id = 'stay-photos' and (storage.foldername(name))[1] = 'stays'
         and (select has_role('planner','comms','admin')))
  with check (bucket_id = 'stay-photos' and (storage.foldername(name))[1] = 'stays'
              and (select has_role('planner','comms','admin')));

-- =====================================================================
--  Standing, badges and provenance
--
--  Everything below was built as a migration against the live project and is reproduced here so
--  that a rebuild from this file lands on the same schema. The order matters: the columns and
--  tables come first, then the functions that read them, then the view — a view resolves its
--  references at creation time, so standing_v cannot be declared before standing_of exists.
-- =====================================================================

-- ---------- columns added after the first build ----------
-- A member's own page: a line about themselves, an accent from the palette, a cover.
alter table members add column if not exists avatar_path text;
alter table members add column if not exists bio         text;
alter table members add column if not exists badge_pins  text[] not null default '{}';
alter table members add column if not exists about       text;
alter table members add column if not exists accent      text;
alter table members add column if not exists cover       text;

-- Where a price was actually seen, and the property's own booking page. Both exist so that no
-- number on the board is unattributable: sources holds what Interval and RedWeek were asking
-- and when anyone last looked, site is the page the Desk books from.
alter table stays add column if not exists sources jsonb;
alter table stays add column if not exists site    text;

-- One photograph per stay, only ever one the Desk holds the rights to: their own, or the
-- resort's media kit. Never a picture copied off a website — the property's photographs are
-- the property's copyright, and "reachable" is not "licensed". The note is the provenance and
-- it is not optional: a photo without one is refused here and in the app. Members see the note
-- under the picture.
alter table stays add column if not exists photo_path text;
alter table stays add column if not exists photo_note text;
alter table stays add column if not exists photo_by   uuid references members(id);
alter table stays add column if not exists photo_at   timestamptz;
alter table stays drop constraint if exists stays_photo_needs_provenance;
alter table stays add constraint stays_photo_needs_provenance
  check (photo_path is null or nullif(trim(photo_note), '') is not null);

-- VakayMood is a source in its own right: the Desk's "Put it on the board" posts from it. The
-- inline check on the table is for a fresh build; this is for a database that already exists.
alter table deals drop constraint if exists deals_source_check;
alter table deals add constraint deals_source_check
  check (source in ('interval','redweek','iberostar','airbnb','vrbo','hotel','member','vakaymood','other'));

-- What the member was looking at when they asked, so the Desk can open the same page.
alter table redemptions add column if not exists source_url   text;
alter table redemptions add column if not exists source_label text;

-- The approved room a circle was started from. Not nullable in spirit — create_crew refuses a
-- null — but nullable in the column so the crews that predate the rule survive a rebuild.
alter table crews add column if not exists redemption_id uuid references redemptions(id);

-- ---------- badges ----------
-- Three kinds. 'founder' is held by name and never granted twice, 'earned' is a query against
-- what the club already records, and 'bought' costs points. The check keeps price and kind
-- honest: exactly the bought ones carry a price.
create table if not exists badge_catalog (
  key          text primary key,
  name         text not null,
  blurb        text not null,
  kind         text not null check (kind in ('earned','bought','founder')),
  price_points int check (price_points is null or price_points > 0),
  mark         text,
  sort         int not null default 100,
  active       boolean not null default true,
  check ((kind = 'bought') = (price_points is not null))
);

create table if not exists member_badges (
  member_id   uuid not null references members(id) on delete cascade,
  badge_key   text not null references badge_catalog(key) on delete cascade,
  paid_points int,
  granted_by  uuid references members(id),
  at          timestamptz not null default now(),
  primary key (member_id, badge_key)
);

-- Aruba's three turnover taxes, kept as rows rather than constants so a rate change is an
-- insert with a date on it and every old quote still reprices correctly.
create table if not exists tax_rates (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  rate           numeric(6,4) not null,
  effective_from date not null,
  effective_to   date,
  created_at     timestamptz not null default now()
);

alter table badge_catalog enable row level security;
alter table member_badges enable row level security;
alter table tax_rates     enable row level security;

drop policy if exists badge_catalog_read on badge_catalog;
create policy badge_catalog_read on badge_catalog for select to authenticated using (true);
drop policy if exists badge_catalog_admin on badge_catalog;
create policy badge_catalog_admin on badge_catalog for all to authenticated
  using (has_role('admin')) with check (has_role('admin'));
-- Read-only to the browser: a badge is only ever written by buy_badge or grant_badge, both
-- definer, so nobody awards themselves the Founder's crown with an insert.
drop policy if exists member_badges_read on member_badges;
create policy member_badges_read on member_badges for select to authenticated
  using (current_member_id() is not null);
drop policy if exists tax_rates_select_all on tax_rates;
create policy tax_rates_select_all on tax_rates for select to authenticated using (true);

grant select on badge_catalog, member_badges, tax_rates to authenticated;
revoke all on badge_catalog, member_badges, tax_rates from anon;

insert into badge_catalog (key, name, blurb, kind, price_points, mark, sort) values
  ('founder_victor','The Founder','Started the Circle and books every room in it.','founder',null,'crown',1),
  ('founder_ian','The Voice','Wrote the first note and every one since.','founder',null,'quill',2),
  ('founder_vishnu','The Banker','Holds the money and has never once been out by a cent.','founder',null,'vault',3),
  ('founding','Founding Insider','One of the first twenty seats.','earned',null,'star',10),
  ('autopilot','On Autopilot','A standing order, running six months or more.','earned',null,'repeat',11),
  ('twelve','Twelve Straight','Twelve consecutive contributions.','earned',null,'twelve',12),
  ('twentyfour','Twenty-four Straight','Twenty-four consecutive contributions.','earned',null,'tf',13),
  ('earlybird','Before the Fifth','Six contributions sent before they were due.','earned',null,'sunrise',14),
  ('morethanasked','More Than Asked','Three contributions beyond the monthly amount.','earned',null,'plus',15),
  ('chippedin','Chipped In','Points put into three different Insiders'' bookings.','earned',null,'hands',16),
  ('together','Booked It Together','A booking of yours that two or more people chipped into.','earned',null,'ring',17),
  ('sponsor','Sponsor','You put a name forward and they are still here.','earned',null,'door',18),
  ('foundit','Found It First','A deal you posted that the Circle went on to book.','earned',null,'eye',19),
  ('fiveplaces','Five Places','Stays completed at five different places.','earned',null,'pin',20),
  ('longhaul','Long Haul','You left the island with the Circle.','earned',null,'plane',21),
  ('secondsignature','Second Signature','Six months co-signed shut.','earned',null,'pen',22),
  ('nightowl','Night Owl','For the one who books at two in the morning.','bought',1000,'moon',30),
  ('firstin','First In','You want it known that you were early.','bought',1500,'flag',31),
  ('saltwater','Saltwater','In the sea before breakfast, every trip.','bought',1500,'wave',32),
  ('kitchen','Cooks','The one who does the cooking in the villa.','bought',2000,'pot',33),
  ('driver','Drives','Always ends up with the keys.','bought',2000,'wheel',34),
  ('photo','Takes the Photos','Every album is yours.','bought',2000,'camera',35),
  ('late','Never On Time','Owned, at least.','bought',2500,'clock',36),
  ('planner','Makes the Plan','Someone has to, and it is you.','bought',3000,'map',37)
on conflict (key) do nothing;

insert into tax_rates (name, rate, effective_from) values
  ('BBO','0.0250','2023-01-01'), ('BAVP','0.0150','2023-01-01'), ('BAZV','0.0300','2023-01-01')
on conflict do nothing;

-- ---------- standing: how long you have been here, and what you have done ----------
-- Months since joining, whether or not any of them were paid.
create or replace function months_held(p_member uuid)
returns int language sql stable security definer set search_path = public as $$
  select greatest(0, (extract(year from age(now(), m.joined_at)) * 12
                    + extract(month from age(now(), m.joined_at)))::int)
    from members m where m.id = p_member
$$;

-- The ladder is data, not a chain of if-statements, so the app and the database read the same
-- five rungs from one place.
create or replace function rank_ladder()
returns jsonb language sql immutable set search_path = public as $$
  select '[
    {"i":0,"name":"Seated",   "months":0,  "blurb":"Forty seats, and one of them has your name on it."},
    {"i":1,"name":"Steady",   "months":3,  "blurb":"Three months in, nothing outstanding."},
    {"i":2,"name":"Anchor",   "months":9,  "blurb":"Nine months. The Circle can count on your line in the book."},
    {"i":3,"name":"Old Guard","months":18, "blurb":"A year and a half. You were here before most of them."},
    {"i":4,"name":"Pillar",   "months":36, "blurb":"Three years. Forty people hold this up, and you are one."}
  ]'::jsonb
$$;

-- What a rung is actually worth. Kept beside the ladder so a perk can never be claimed in the
-- app that the database does not also enforce — request_redemption reads this for the hold cap.
create or replace function rank_perks(p_rank int)
returns table(extra_holds int, extra_first_look_hours int, extra_guest_certs int)
language sql immutable set search_path = public as $$
  select case when p_rank >= 2 then 1 else 0 end,
         case when p_rank >= 3 then 12 else 0 end,
         case when p_rank >= 4 then 1 else 0 end;
$$;

-- A member's standing, computed rather than stored: months here, months paid, months owing,
-- the rung that follows from them, and the badges the record already earns.
create or replace function standing_of(p_member uuid)
returns table(member_id uuid, months_held int, months_paid int, owing int,
              rank_index int, rank_name text, badges jsonb)
language plpgsql stable security definer set search_path = public as $$
declare m members; s settings; held int; paid int; due int; r jsonb; b text[] := '{}';
begin
  select * into m from members where id = p_member;
  if m.id is null then return; end if;
  select * into s from settings where id = 1;
  held := months_held(p_member);
  select count(*)::int into paid from contributions c
    where c.member_id = p_member and c.status = 'confirmed' and not c.extra;
  -- Months since joining that are neither paid nor formally paused.
  due := greatest(0, held - paid - coalesce(array_length(m.paused_months, 1), 0));

  -- The rank: the highest rung whose months you have reached. From Steady up it also wants
  -- nothing owing, so nobody climbs while dormant. Falling behind drops you back; catching
  -- up puts you straight back. It is a state, not a history.
  select jsonb_agg(x order by (x->>'months')::int) into r
    from jsonb_array_elements(rank_ladder()) x
   where (x->>'months')::int <= held and ((x->>'i')::int = 0 or due = 0);
  rank_index := coalesce((r -> (jsonb_array_length(r) - 1) ->> 'i')::int, 0);
  rank_name  := coalesce(r -> (jsonb_array_length(r) - 1) ->> 'name', 'Seated');

  -- Badges. Things done, not time served. Each one is a query against what the club already
  -- records — nothing here needs a new table or anybody's say-so.
  if m.founding then b := array_append(b, 'founding'); end if;
  if m.standing_order and consecutive_months(p_member, to_char(now(),'YYYY-MM')) >= 6
    then b := array_append(b, 'autopilot'); end if;
  if exists (select 1 from ledger l where l.member_id = p_member and l.kind='streak'
               and l.note = '12 consecutive contributions') then b := array_append(b, 'twelve'); end if;
  if exists (select 1 from ledger l where l.member_id = p_member and l.kind='streak'
               and l.note = '24 consecutive contributions') then b := array_append(b, 'twentyfour'); end if;
  if (select count(*) from contributions c2 where c2.member_id = p_member and c2.status='confirmed'
        and c2.sent_on is not null and extract(day from c2.sent_on) <= s.due_day) >= 6
    then b := array_append(b, 'earlybird'); end if;
  if (select count(*) from contributions c3 where c3.member_id = p_member and c3.status='confirmed' and c3.extra) >= 3
    then b := array_append(b, 'morethanasked'); end if;
  if (select count(distinct r2.member_id) from pledges p join redemptions r2 on r2.id = p.redemption_id
        where p.member_id = p_member and r2.member_id <> p_member and r2.confirmed_at is not null) >= 3
    then b := array_append(b, 'chippedin'); end if;
  if exists (select 1 from redemptions r3 where r3.member_id = p_member and r3.shared
               and r3.confirmed_at is not null
               and (select count(*) from pledges p2 where p2.redemption_id = r3.id and p2.member_id <> p_member) >= 2)
    then b := array_append(b, 'together'); end if;
  if exists (select 1 from invitations i join members mm on mm.id = i.accepted_member_id
               where i.sponsor_id = p_member and mm.status = 'active') then b := array_append(b, 'sponsor'); end if;
  if exists (select 1 from deals d where d.posted_by = p_member and d.status = 'booked')
    then b := array_append(b, 'foundit'); end if;
  if (select count(distinct r4.stay_id) from redemptions r4
        where r4.member_id = p_member and r4.status = 'completed') >= 5 then b := array_append(b, 'fiveplaces'); end if;
  if exists (select 1 from redemptions r5 join stays st on st.id = r5.stay_id
               where r5.member_id = p_member and r5.status='completed' and st.kind = 'trip')
    then b := array_append(b, 'longhaul'); end if;
  if (select count(*) from month_closes mc where mc.cosigned_by = p_member) >= 6
    then b := array_append(b, 'secondsignature'); end if;

  months_held := held; months_paid := paid; owing := due;
  member_id := p_member; badges := to_jsonb(b);
  return next;
end $$;

-- Buying a badge spends available points, not the balance: points already promised to a
-- booking are not yours to spend twice.
create or replace function buy_badge(p_key text)
returns member_badges language plpgsql security definer set search_path = public as $$
declare
  me uuid := current_member_id();
  b badge_catalog;
  have int;
  out_row member_badges;
begin
  if me is null then raise exception 'You are not on the Circle''s list'; end if;
  select * into b from badge_catalog where key = p_key and active;
  if b.key is null then raise exception 'No such badge'; end if;
  if b.kind <> 'bought' then
    raise exception '% is not for sale — it is %', b.name,
      case b.kind when 'founder' then 'held by name' else 'earned' end;
  end if;
  if exists (select 1 from member_badges mb where mb.member_id = me and mb.badge_key = p_key) then
    raise exception 'You already have %', b.name;
  end if;

  have := available_points(me);
  if have < b.price_points then
    raise exception 'That is % points and you have % available', b.price_points, have;
  end if;

  insert into ledger (member_id, kind, points, usd, ref_type, note, by_id)
    values (me, 'badge', -b.price_points,
            -- negative, like every other burn: points leave and so does their dollar value
            -round(b.price_points::numeric / (select points_per_dollar from settings where id = 1), 2),
            'badge', b.name, me);
  insert into member_badges (member_id, badge_key, paid_points)
    values (me, p_key, b.price_points) returning * into out_row;
  return out_row;
end $$;

-- The founder marks and anything else not for sale. Admin only, and it refuses to hand out a
-- badge that is supposed to be bought.
create or replace function grant_badge(p_member uuid, p_key text)
returns member_badges language plpgsql security definer set search_path = public as $$
declare b badge_catalog; out_row member_badges;
begin
  if not has_role('admin') then raise exception 'Only an admin may grant a badge'; end if;
  select * into b from badge_catalog where key = p_key and active;
  if b.key is null then raise exception 'No such badge'; end if;
  if b.kind = 'bought' then raise exception '% is bought with points, not granted', b.name; end if;
  insert into member_badges (member_id, badge_key, granted_by)
    values (p_member, p_key, current_member_id())
    on conflict (member_id, badge_key) do nothing returning * into out_row;
  return out_row;
end $$;

-- Three at most, and only ones you actually hold.
create or replace function pin_badges(p_keys text[])
returns members language plpgsql security definer set search_path = public as $$
declare me uuid := current_member_id(); k text; m members;
begin
  if me is null then raise exception 'You are not on the Circle''s list'; end if;
  if coalesce(array_length(p_keys, 1), 0) > 3 then raise exception 'Three at most'; end if;
  foreach k in array coalesce(p_keys, '{}'::text[]) loop
    if not exists (select 1 from member_badges mb where mb.member_id = me and mb.badge_key = k) then
      raise exception 'You do not have that badge';
    end if;
  end loop;
  update members set badge_pins = coalesce(p_keys, '{}') where id = me returning * into m;
  return m;
end $$;

-- Standing for everyone at once, for the roll-call. Robots are not on the ladder.
-- What one Insider may see of another: a rank and a list of badges. NOT months paid and NOT
-- months owing — this view runs as its owner and ignores RLS, and it is pulled into every
-- screen, so those two columns handed any of the forty exactly who was behind and by how much
-- from a single line in the console. In a club of friends that is the most sensitive fact in
-- the database, and the club's rule is that nobody is ever shown a late list. A member's own
-- full standing, and the officers' view of everyone's, still comes through standing_of().
-- Dropped and recreated rather than replaced: create or replace refuses to REMOVE columns, and
-- against a database that still has the two we are taking away it would abort here.
drop view if exists standing_v;
create view standing_v as
  select m.id as member_id, st.months_held, st.rank_index, st.rank_name, st.badges
    from members m
    cross join lateral standing_of(m.id) st
   where not m.bot;

grant select on standing_v to authenticated;
revoke all on standing_v from anon;

revoke all on function months_held(uuid), rank_ladder(), rank_perks(int), standing_of(uuid),
  buy_badge(text), grant_badge(uuid, text), pin_badges(text[]) from public, anon;
grant execute on function months_held(uuid), rank_ladder(), rank_perks(int), standing_of(uuid),
  buy_badge(text), grant_badge(uuid, text), pin_badges(text[]) to authenticated;

-- quote_points is called by quote_redemption as the definer, never from the browser: money.js
-- does the same arithmetic client-side. It kept the default PUBLIC execute grant because it was
-- created after the lock-down above, so anon could price any stay until this was applied.
revoke all on function quote_points(uuid, date, date, int) from public, anon;
grant execute on function quote_points(uuid, date, date, int) to authenticated;

-- =====================================================================
--  Looks: the only availability fact this app is allowed to hold
--
--  Nothing here checks a hotel. There is no availability API, and every chain refuses a scripted
--  request — Marriott and Hilton 403 the page, Hyatt, IHG and Radisson 403 robots.txt itself.
--  Working around bot management is off the table as policy and would mean taking copyrighted
--  content besides. So the app never says a room is available: it says a named person opened a
--  named page at a named time and wrote down what they saw. That is a claim it can stand behind,
--  because it holds the row.
--
--  Declared after the functions that read it — a plpgsql body is not resolved until it runs, so
--  a fresh build is fine, and the alters below need this table to exist first.
-- =====================================================================

-- Writing a look. Desk only, or the watcher — which is forced to by_robot regardless of what it
-- claims, so a scrape can never be dressed up as a person having looked.
create or replace function record_look(p_stay uuid, p_check_in date, p_check_out date,
  p_found look_found, p_channel look_channel default 'site', p_url text default null,
  p_label text default null, p_price numeric default null, p_room_label text default null,
  p_note text default null, p_redemption uuid default null)
returns looks language plpgsql security definer set search_path = public as $$
declare me uuid; s settings; robot boolean; hours int; l looks; clean text;
begin
  me := current_member_id();
  if me is null then raise exception 'Not a member'; end if;
  robot := coalesce(current_is_bot(), false);
  if not (robot or has_role('planner','comms','admin')) then
    raise exception 'Only the Desk records what it saw';
  end if;
  if p_check_out <= p_check_in then raise exception 'Check-out must be after check-in'; end if;
  clean := clean_link(p_url);
  if p_channel = 'site' and clean is null then
    raise exception 'A look at a page needs the link to that page';
  end if;
  if p_found in ('unclear','different') and nullif(btrim(coalesce(p_note,'')),'') is null then
    raise exception 'Say what you saw — that is the whole point of writing it down';
  end if;
  select * into s from settings where id = 1;
  hours := coalesce((s.look_hours ->> p_channel::text)::int, 48);
  insert into looks (stay_id, redemption_id, check_in, check_out, found, channel, url, label,
                     price_usd, room_label, note, looked_by, by_robot, good_until)
  values (p_stay, p_redemption, p_check_in, p_check_out, p_found, p_channel, clean,
          nullif(btrim(coalesce(p_label,'')),''), p_price,
          nullif(btrim(coalesce(p_room_label,'')),''), nullif(btrim(coalesce(p_note,'')),''),
          me, robot, now() + make_interval(hours => hours))
  returning * into l;
  if p_redemption is not null then
    update redemptions set last_look_id = l.id where id = p_redemption;
  end if;
  perform log_audit('look.record','look',l.id::text,
    jsonb_build_object('stay', p_stay, 'found', p_found, 'robot', robot, 'url', clean));
  return l;
end $$;

-- The newest HUMAN look whose nights contain these ones. Seeing the 10th-17th tells you nothing
-- about the 20th, so containment is the test, not overlap.
create or replace function look_for(p_stay uuid, p_in date, p_out date, p_since timestamptz default null)
returns looks language sql stable security definer set search_path = public as $$
  select l.* from looks l
   where l.stay_id = p_stay and not l.by_robot
     and l.check_in <= p_in and l.check_out >= p_out
     and (p_since is null or l.looked_at >= p_since)
   order by l.looked_at desc limit 1
$$;

alter table looks enable row level security;
-- The member whose request prompted it, anyone who chipped into that request, and the Desk.
drop policy if exists looks_read on looks;
create policy looks_read on looks for select to authenticated using (
  has_role('planner','comms','admin')
  or exists (select 1 from redemptions r where r.id = looks.redemption_id
               and (r.member_id = current_member_id()
                    or exists (select 1 from pledges p where p.redemption_id = r.id
                                 and p.member_id = current_member_id())))
);
-- Nobody writes directly. Writes go through record_look, which is definer and role-checked.
revoke all on looks from anon, authenticated;
grant select on looks to authenticated;

revoke all on function record_look(uuid, date, date, look_found, look_channel, text, text, numeric, text, text, uuid) from public, anon;
grant execute on function record_look(uuid, date, date, look_found, look_channel, text, text, numeric, text, text, uuid) to authenticated;
revoke all on function look_for(uuid, date, date, timestamptz) from public, anon;
grant execute on function look_for(uuid, date, date, timestamptz) to authenticated;
revoke all on function quote_redemption(uuid, int, jsonb, text, date, text, uuid) from public, anon;
grant execute on function quote_redemption(uuid, int, jsonb, text, date, text, uuid) to authenticated;
revoke all on function request_redemption(uuid, date, date, int, int, text, int, boolean, text, text) from public, anon;
grant execute on function request_redemption(uuid, date, date, int, int, text, int, boolean, text, text) to authenticated;
