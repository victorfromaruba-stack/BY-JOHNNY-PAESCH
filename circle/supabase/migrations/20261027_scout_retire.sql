-- Deal scout rows (post_deal source 'other', source_ref 'scout...' / 'other:travelzoo:...') get the same 7-day
-- retirement as RedWeek, Interval and VakayMood: the scout moves seen_at only when it meets a row again, and
-- retire_stale_deals() is called by the watcher on every pass. Same function as 20261022_source_outage.sql with
-- one more clause. Paste into the SQL editor once; safe to run twice.
create or replace function retire_stale_deals(p_days int default 7)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not current_is_bot() then raise exception 'Only the watcher takes a week down this way'; end if;
  if coalesce(p_days, 0) < 1 then raise exception 'Days must be at least one'; end if;
  update deals set status = 'gone', retired_at = now(), retired_reason = 'not seen for ' || p_days || ' days'
    where status = 'live'
      and (source in ('redweek', 'interval', 'vakaymood') or source_ref like 'other:travelzoo:%' or source_ref like 'other:holidaypirates:%' or source_ref like 'other:secretflying:%')
      and coalesce(seen_at, posted_at) + make_interval(days => p_days)
          + outage_paused(source::text, coalesce(seen_at, posted_at)) < now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function retire_stale_deals(int) from public, anon;
grant execute on function retire_stale_deals(int) to authenticated;
