-- 22 Oct 2026. RedWeek stopped answering this server's address (every request times out). Victor's
-- decision was to wait, not to route around it. The 7-day rule (20261022_board_freshness.sql) would
-- then empty the board by itself: a week nobody could see for seven days is a week RedWeek was
-- unreachable for, and that says nothing about the week.
--
-- So a source being out PAUSES the clock of its rows. The watcher writes down when a source stopped
-- answering and when it answered again; retire_stale_deals() adds the time a row's source was out,
-- since the row was last seen, to its seven days. Nothing is written to deals.seen_at: the row still
-- says honestly when it was last seen, and the Stays page prints "RedWeek not reachable since 14:20;
-- weeks shown as last seen".
--
-- Paste into the SQL editor AFTER 20261022_board_freshness.sql. Safe to run twice.

create table if not exists source_outages (
  id     bigserial primary key,
  source text not null check (source in ('redweek', 'interval', 'vakaymood')),
  since  timestamptz not null,           -- the last moment the source was known to answer
  until  timestamptz,                    -- null while it is still out
  why    text
);
-- One open outage per source, enforced: the watcher reports every pass and must not make a row each time.
create unique index if not exists source_outages_one_open_idx on source_outages(source) where until is null;
alter table source_outages enable row level security;
revoke all on source_outages from anon, authenticated;
revoke all on sequence source_outages_id_seq from anon, authenticated;
grant select on source_outages to authenticated;
drop policy if exists source_outages_read on source_outages;
create policy source_outages_read on source_outages for select to authenticated
  using (current_member_id() is not null);

-- The watcher: a source stopped answering. `p_since` is the last time it did (the watcher knows that
-- from its own reads); never in the future. Already out: nothing changes, the first time stands.
create or replace function mark_source_unreachable(p_source text, p_since timestamptz default null, p_why text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not current_is_bot() then raise exception 'Only the watcher records this'; end if;
  insert into source_outages(source, since, why)
    values (p_source, least(coalesce(p_since, now()), now()), left(nullif(trim(p_why), ''), 200))
    on conflict (source) where until is null do nothing;
end $$;
revoke all on function mark_source_unreachable(text, timestamptz, text) from public, anon;
grant execute on function mark_source_unreachable(text, timestamptz, text) to authenticated;

-- The watcher: it answered. Closes the open outage, if there is one.
create or replace function mark_source_reachable(p_source text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not current_is_bot() then raise exception 'Only the watcher records this'; end if;
  update source_outages set until = now() where source = p_source and until is null;
end $$;
revoke all on function mark_source_reachable(text) from public, anon;
grant execute on function mark_source_reachable(text) to authenticated;

-- How long `p_source` was out between `p_from` and now: what the clock of a row last seen at `p_from`
-- does not count. An outage that ended before the row was last seen counts for nothing.
create or replace function outage_paused(p_source text, p_from timestamptz)
returns interval language sql stable security definer set search_path = public as $$
  select coalesce(sum(greatest(interval '0', least(coalesce(o.until, now()), now()) - greatest(o.since, p_from))), interval '0')
  from source_outages o where o.source = p_source
$$;
revoke all on function outage_paused(text, timestamptz) from public, anon, authenticated;

-- retire_stale_deals(), the same function as in 20261022_board_freshness.sql with the pause added.
create or replace function retire_stale_deals(p_days int default 7)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not current_is_bot() then raise exception 'Only the watcher takes a week down this way'; end if;
  if coalesce(p_days, 0) < 1 then raise exception 'Days must be at least one'; end if;
  update deals set status = 'gone', retired_at = now(), retired_reason = 'not seen for ' || p_days || ' days'
    where status = 'live' and source in ('redweek', 'interval', 'vakaymood')
      and coalesce(seen_at, posted_at) + make_interval(days => p_days)
          + outage_paused(source::text, coalesce(seen_at, posted_at)) < now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function retire_stale_deals(int) from public, anon;
grant execute on function retire_stale_deals(int) to authenticated;
