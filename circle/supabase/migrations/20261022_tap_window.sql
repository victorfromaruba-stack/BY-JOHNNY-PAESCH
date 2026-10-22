-- 22 Oct 2026. Victor, on the Stays page: "Would be nice on the site Circle to add dates we are looking
-- for. Now it shows for the next week but I'd like to see a month or two in advance."
--
-- A member now says which dates they are looking for, and a tap carries them to the watcher, so what
-- the watcher goes and looks for (RedWeek's listings, an Interval Getaways search) is those dates and
-- not whatever its default happens to be.
--
-- Paste into the SQL editor AFTER 20261022_stay_taps.sql and 20261022_board_freshness.sql (it alters
-- the table they make and replaces their functions). Safe to run twice.
--
--   1. stay_taps.from_date / to_date   nullable. A tap from an older phone carries none; the watcher
--                                      then looks at its own default. Still a place and a time and now
--                                      two dates — never a member.
--   2. record_stay_tap / record_board_tap   take the two dates. Same shape as before: security definer,
--                                      a member only, never an error on a page load. A second member's
--                                      dates WIDEN the waiting tap's rather than being dropped, so two
--                                      people looking at different months are both looked for.
--   3. take_stay_taps                  hands the dates to the watcher (window_from, window_to).
--
-- A window is believed only when it is sane: both ends present, in order, not over, and no longer than
-- a year; a start in the past is moved to today. Anything else is stored as no window at all, because
-- a bad pair of dates must never turn into a search or an error.

alter table stay_taps add column if not exists from_date date;
alter table stay_taps add column if not exists to_date   date;

-- The one place the rule is written. Today is Aruba's day (UTC-4, no daylight time).
create or replace function clean_tap_window(p_from date, p_to date, out o_from date, out o_to date)
language plpgsql stable set search_path = public as $$
declare today date := (now() at time zone 'America/Aruba')::date;
begin
  if p_from is null or p_to is null or p_to < p_from or p_to < today then return; end if;
  o_from := greatest(p_from, today);
  o_to := least(p_to, o_from + 366);
end $$;
revoke all on function clean_tap_window(date, date) from public, anon, authenticated;

-- A member opened a place, looking for these dates. At most one waiting tap per place; a second one
-- widens it (least/greatest ignore a missing end, so a tap with no dates changes nothing).
drop function if exists record_stay_tap(uuid);
create or replace function record_stay_tap(p_stay uuid, p_from date default null, p_to date default null)
returns void language plpgsql security definer set search_path = public as $$
declare w record;
begin
  if current_member_id() is null then raise exception 'Not a member'; end if;
  if not exists (select 1 from stays where id = p_stay and active and kind = 'aruba') then return; end if;
  select * into w from clean_tap_window(p_from, p_to);
  update stay_taps set from_date = least(from_date, w.o_from), to_date = greatest(to_date, w.o_to)
    where stay_id = p_stay and taken_at is null;
  if found then return; end if;
  insert into stay_taps(stay_id, from_date, to_date) values (p_stay, w.o_from, w.o_to);
end $$;
revoke all on function record_stay_tap(uuid, date, date) from public, anon;
grant execute on function record_stay_tap(uuid, date, date) to authenticated;

-- The Stays LIST opened, looking for these dates. One waiting board tap (the unique index), widened
-- the same way.
drop function if exists record_board_tap();
create or replace function record_board_tap(p_from date default null, p_to date default null)
returns void language plpgsql security definer set search_path = public as $$
declare w record;
begin
  if current_member_id() is null then raise exception 'Not a member'; end if;
  select * into w from clean_tap_window(p_from, p_to);
  update stay_taps set from_date = least(from_date, w.o_from), to_date = greatest(to_date, w.o_to)
    where stay_id is null and taken_at is null;
  if found then return; end if;
  begin
    insert into stay_taps(stay_id, from_date, to_date) values (null, w.o_from, w.o_to);
  exception when unique_violation then      -- the other phone got there first: widen theirs
    update stay_taps set from_date = least(from_date, w.o_from), to_date = greatest(to_date, w.o_to)
      where stay_id is null and taken_at is null;
  end;
end $$;
revoke all on function record_board_tap(date, date) from public, anon;
grant execute on function record_board_tap(date, date) to authenticated;

-- The watcher collects what is waiting, dates included. Its columns were (stay, tapped); the return
-- type changes, so the function is dropped and made again. Named window_* so they cannot be mistaken
-- for the table's own columns inside the body.
drop function if exists take_stay_taps();
create or replace function take_stay_taps()
returns table (stay uuid, tapped timestamptz, window_from date, window_to date)
language plpgsql security definer set search_path = public as $$
begin
  if not current_is_bot() then raise exception 'Only the watcher collects these'; end if;
  delete from stay_taps where taken_at < now() - interval '7 days';
  return query
    with t as (update stay_taps set taken_at = now() where taken_at is null
               returning stay_taps.stay_id, stay_taps.tapped_at, stay_taps.from_date, stay_taps.to_date)
    select t.stay_id, t.tapped_at, t.from_date, t.to_date from t order by t.tapped_at;
end $$;
revoke all on function take_stay_taps() from public, anon;
grant execute on function take_stay_taps() to authenticated;
