-- 22 Oct 2026. RedWeek is read by Victor's VPS now (the primary pulls the pages: watcher README, "RedWeek from the VPS").
-- The Stays line should say so, and say when the page was actually read: "RedWeek checked at 05:51 (via VPS)".
-- Nothing else changes: redweek_checks keeps one row per place, the watcher keeps being the only writer.
--
-- Paste into the SQL editor AFTER 20261022_stay_taps.sql (it alters that table). Safe to run twice.
-- The watcher and the app both work without it: until it is applied the line reads "RedWeek checked at 06:00"
-- (the time the watcher recorded it) and says nothing about the VPS.

alter table redweek_checks add column if not exists via text;       -- 'vps' when the VPS fetched the page; null for a direct read

-- A new argument list is a new function: drop the old one so a call with only p_stay cannot be ambiguous.
drop function if exists mark_redweek_checked(uuid);
create or replace function mark_redweek_checked(p_stay uuid, p_at timestamptz default null, p_via text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not current_is_bot() then raise exception 'Only the watcher records this'; end if;
  -- p_at is when the page was really read (never later than now); an older reading never replaces a newer one.
  insert into redweek_checks(stay_id, checked_at, via)
    values (p_stay, least(coalesce(p_at, now()), now()), nullif(p_via, ''))
    on conflict (stay_id) do update set checked_at = excluded.checked_at, via = excluded.via
      where excluded.checked_at >= redweek_checks.checked_at;
end $$;
revoke all on function mark_redweek_checked(uuid, timestamptz, text) from public, anon;
grant execute on function mark_redweek_checked(uuid, timestamptz, text) to authenticated;
