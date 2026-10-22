-- 22 Oct 2026. "I want the watch to watch it the moment a member clicks on stays."
--
-- Three things, in one paste into the SQL editor. Safe to run twice.
--
--   1. stay_taps         a member opened a stay. A stay and a time, NO member: the watcher needs
--                        to know which place is being looked at, never who is looking.
--   2. redweek_checks    when the watcher last read RedWeek's public page for a stay, so the stay
--                        can say "Checked 4 min ago" and mean it.
--   3. the 403           the watcher moves deals.seen_at when it meets a week again, and was
--                        refused (42501) because no grant let it. Column seen_at, robot only.
--
-- Nobody gets a table grant they could write through. Taps go in through record_stay_tap();
-- the watcher takes them out through take_stay_taps(); the check time goes in through
-- mark_redweek_checked(). All three are security definer with the role check on their first line,
-- the same shape as post_deal.

-- ---------- 1. taps ----------
create table if not exists stay_taps (
  id        bigserial primary key,
  stay_id   uuid not null references stays(id) on delete cascade,
  tapped_at timestamptz not null default now(),
  taken_at  timestamptz
);
create index if not exists stay_taps_pending_idx on stay_taps(stay_id) where taken_at is null;
alter table stay_taps enable row level security;
revoke all on stay_taps from anon, authenticated;       -- no policy, no grant: functions only
revoke all on sequence stay_taps_id_seq from anon, authenticated;

-- A member opened a place. At most one waiting tap per place, so ten people looking at the Surf
-- Club in the same minute is one row, and nobody can fill the table by tapping. A place that is
-- not an active Aruba stay is ignored rather than refused: this is called on a page load, and a
-- page load must never show anybody an error.
create or replace function record_stay_tap(p_stay uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if current_member_id() is null then raise exception 'Not a member'; end if;
  if not exists (select 1 from stays where id = p_stay and active and kind = 'aruba') then return; end if;
  if exists (select 1 from stay_taps where stay_id = p_stay and taken_at is null) then return; end if;
  insert into stay_taps(stay_id) values (p_stay);
end $$;
revoke all on function record_stay_tap(uuid) from public, anon;
grant execute on function record_stay_tap(uuid) to authenticated;

-- The watcher collects what is waiting. Marked taken in the same statement, so a tap is handled
-- once. Old taken rows are swept on the way through so the table stays a handful of rows.
create or replace function take_stay_taps()
returns table (stay uuid, tapped timestamptz) language plpgsql security definer set search_path = public as $$
begin
  if not current_is_bot() then raise exception 'Only the watcher collects these'; end if;
  delete from stay_taps where taken_at < now() - interval '7 days';
  return query
    with t as (update stay_taps set taken_at = now() where taken_at is null returning stay_id, tapped_at)
    select t.stay_id, t.tapped_at from t order by t.tapped_at;
end $$;
revoke all on function take_stay_taps() from public, anon;
grant execute on function take_stay_taps() to authenticated;

-- ---------- 2. when RedWeek was last read ----------
create table if not exists redweek_checks (
  stay_id    uuid primary key references stays(id) on delete cascade,
  checked_at timestamptz not null
);
alter table redweek_checks enable row level security;
revoke all on redweek_checks from anon, authenticated;
grant select on redweek_checks to authenticated;
drop policy if exists redweek_checks_read on redweek_checks;
create policy redweek_checks_read on redweek_checks for select to authenticated
  using (current_member_id() is not null);

create or replace function mark_redweek_checked(p_stay uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not current_is_bot() then raise exception 'Only the watcher records this'; end if;
  insert into redweek_checks(stay_id, checked_at) values (p_stay, now())
    on conflict (stay_id) do update set checked_at = excluded.checked_at;
end $$;
revoke all on function mark_redweek_checked(uuid) from public, anon;
grant execute on function mark_redweek_checked(uuid) to authenticated;

-- ---------- 3. the 403 on deals.seen_at ----------
-- Postgres said: Grant the required privileges to the current role with:
--   GRANT UPDATE ON public.deals TO authenticated
-- That is the whole table, for every member. This is one column, and the policy lets a robot
-- through and nobody else — so a member's PATCH is filtered to zero rows and the watcher's is not.
-- (current_is_bot() cannot be named here: its execute is revoked from authenticated on purpose,
-- and a policy runs as the caller. The same test is written out.)
grant update (seen_at) on deals to authenticated;
drop policy if exists deals_robot_seen on deals;
create policy deals_robot_seen on deals for update to authenticated
  using      (exists (select 1 from members m where m.auth_user_id = auth.uid() and m.bot and m.status = 'active'))
  with check (exists (select 1 from members m where m.auth_user_id = auth.uid() and m.bot and m.status = 'active'));
