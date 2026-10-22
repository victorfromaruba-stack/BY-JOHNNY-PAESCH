-- 22 Oct 2026. The board was stale and Victor caught it with a screenshot: a Barceló week "owner asking
-- $9 a night", seen 16 Oct, sitting at No. 1 on Stays. His decisions the same afternoon (gstack ledger,
-- author victor, 14:16): a live row the watcher has not seen again for 7 days retires itself; the
-- watcher re-checks EVERY live row, not only the ones it posts; and "The watcher needs to update the
-- moment someone clicks Stays."
--
-- Paste into the SQL editor AFTER 20261022_stay_taps.sql (it alters that table). Safe to run twice.
--
--   1. the board tap     opening the Stays LIST is a tap on no particular stay: stay_taps.stay_id may be
--                        null, meaning "the whole board". At most one waiting.
--   2. board_checks      one row: when the watcher last re-checked the whole board, and how many rows it
--                        verified, repriced and retired — what the top of the Stays list prints.
--   3. retiring          three robot-only functions: a row that has gone from its source, a row not
--                        seen for N days, and a changed price. All of them are the same guarded shape
--                        as post_deal: current_is_bot() on the first line, nothing granted on a table.

-- ---------- 1. the board tap ----------
alter table stay_taps alter column stay_id drop not null;
-- One waiting board tap, enforced rather than hoped for: two phones opening Stays in the same second
-- cannot make two rows.
create unique index if not exists stay_taps_one_board_idx on stay_taps ((true)) where stay_id is null and taken_at is null;

create or replace function record_board_tap()
returns void language plpgsql security definer set search_path = public as $$
begin
  if current_member_id() is null then raise exception 'Not a member'; end if;
  if exists (select 1 from stay_taps where stay_id is null and taken_at is null) then return; end if;
  begin
    insert into stay_taps(stay_id) values (null);
  exception when unique_violation then null;      -- the other phone got there first
  end;
end $$;
revoke all on function record_board_tap() from public, anon;
grant execute on function record_board_tap() to authenticated;
-- take_stay_taps() already hands back whatever is waiting; a null `stay` is the board.

-- ---------- 2. when the board was last re-checked ----------
create table if not exists board_checks (
  id         int primary key default 1 check (id = 1),
  checked_at timestamptz not null,
  verified   int not null default 0,       -- live rows compared with what their source shows now
  repriced   int not null default 0,       -- of those, rows whose price had changed and now says so
  retired    int not null default 0        -- rows taken down by this check
);
alter table board_checks enable row level security;
revoke all on board_checks from anon, authenticated;
grant select on board_checks to authenticated;
drop policy if exists board_checks_read on board_checks;
create policy board_checks_read on board_checks for select to authenticated
  using (current_member_id() is not null);

create or replace function mark_board_checked(p_verified int, p_repriced int, p_retired int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not current_is_bot() then raise exception 'Only the watcher records this'; end if;
  insert into board_checks(id, checked_at, verified, repriced, retired)
    values (1, now(), greatest(0, p_verified), greatest(0, p_repriced), greatest(0, p_retired))
    on conflict (id) do update set checked_at = excluded.checked_at, verified = excluded.verified,
      repriced = excluded.repriced, retired = excluded.retired;
end $$;
revoke all on function mark_board_checked(int, int, int) from public, anon;
grant execute on function mark_board_checked(int, int, int) to authenticated;

-- ---------- 3. taking a row down, and changing its price ----------
-- Gone from its source: RedWeek shows the week as rented, or no longer lists it. The watcher says which
-- rows and why ("gone from RedWeek on 22 Oct"); only LIVE rows move, and a week the Circle has booked
-- is never touched.
create or replace function retire_deals_gone(p_refs text[], p_reason text)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not current_is_bot() then raise exception 'Only the watcher takes a week down this way'; end if;
  update deals set status = 'gone', retired_at = now(), retired_reason = left(nullif(trim(p_reason), ''), 200)
    where status = 'live' and source_ref = any(p_refs);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function retire_deals_gone(text[], text) from public, anon;
grant execute on function retire_deals_gone(text[], text) to authenticated;

-- Not seen for N days (Victor: 7). "Seen" is deals.seen_at, which the watcher moves each time it meets
-- the week again and which a Grab or a scan of Interval moves too; it falls back to posted_at for a row
-- that has never had one. Only the three sources something re-reads — RedWeek, Interval, VakayMood — a
-- rate Victor typed in by hand from the hotel is not a listing anyone could see again.
create or replace function retire_stale_deals(p_days int default 7)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not current_is_bot() then raise exception 'Only the watcher takes a week down this way'; end if;
  if coalesce(p_days, 0) < 1 then raise exception 'Days must be at least one'; end if;
  update deals set status = 'gone', retired_at = now(), retired_reason = 'not seen for ' || p_days || ' days'
    where status = 'live' and source in ('redweek', 'interval', 'vakaymood')
      and coalesce(seen_at, posted_at) < now() - make_interval(days => p_days);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function retire_stale_deals(int) from public, anon;
grant execute on function retire_stale_deals(int) to authenticated;

-- A price that moved. The watcher sends the new all-in points and the title and note that go with
-- them (the title of an owner's week carries the asking price); the nightly figure follows, and the
-- row counts as seen. A live row only.
create or replace function reprice_deal(p_ref text, p_points int, p_title text default null, p_note text default null)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not current_is_bot() then raise exception 'Only the watcher reprices a week'; end if;
  if coalesce(p_points, 0) <= 0 then raise exception 'What does it cost in points?'; end if;
  update deals set points_total = p_points, points_per_night = round(p_points::numeric / nights),
                   title = coalesce(nullif(trim(p_title), ''), title), note = coalesce(nullif(trim(p_note), ''), note),
                   seen_at = now()
    where status = 'live' and source_ref = p_ref;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function reprice_deal(text, int, text, text) from public, anon;
grant execute on function reprice_deal(text, int, text, text) to authenticated;
