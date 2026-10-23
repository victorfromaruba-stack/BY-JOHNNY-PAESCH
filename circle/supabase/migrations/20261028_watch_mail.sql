-- Watch e-mail (Victor, 23 Oct 2026: "give the Circle members an option for our system to look at the dates they
-- are looking for and e-mail them the deals daily, twice").
--   watches.email_me   the toggle, on by default when a watch is made
--   watches.paused     a watch the member has put down without deleting it
--   watch_mail_log     what has been mailed to whom, so nobody hears about the same week twice
-- The scout (watcher/watch-mail.mjs) reads targets through a bot-only function; member addresses are never exposed otherwise.
-- Safe to run twice. Paste into the SQL editor or POST to the Management API.

alter table watches add column if not exists email_me boolean not null default true;
alter table watches add column if not exists paused   boolean not null default false;

create table if not exists watch_mail_log (
  member_id uuid not null references members(id) on delete cascade,
  deal_key  text not null,
  sent_at   timestamptz not null default now(),
  primary key (member_id, deal_key)
);
alter table watch_mail_log enable row level security;
revoke all on watch_mail_log from anon, authenticated;

-- add_watch gains p_email. A new parameter is an overload, not a replacement, so the old signature goes first.
drop function if exists add_watch(uuid, date, date, int, uuid, text, int, int, int, text);
create or replace function add_watch(
  p_stay uuid, p_from date, p_to date, p_nights int,
  p_room_type uuid default null, p_kind text default 'aruba',
  p_flex int default 3, p_guests int default 2, p_max_points int default null, p_note text default '',
  p_email boolean default true)
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
  insert into watches(member_id, stay_id, room_type_id, kind, from_date, to_date, nights, flex_days, guests, max_points, note, email_me)
    values (me, p_stay, p_room_type, p_kind, p_from, p_to, p_nights, greatest(0, p_flex), greatest(1, p_guests),
            nullif(p_max_points, 0), nullif(trim(p_note), ''), coalesce(p_email, true))
    returning * into w;
  perform log_audit('watch.add','watch', w.id::text, jsonb_build_object('stayId', p_stay, 'from', p_from, 'to', p_to, 'email', w.email_me));
  return w;
end $$;
revoke all on function add_watch(uuid, date, date, int, uuid, text, int, int, int, text, boolean) from public, anon;
grant execute on function add_watch(uuid, date, date, int, uuid, text, int, int, int, text, boolean) to authenticated;

-- The member's own switches: e-mail on/off, paused or not. Null leaves a switch as it is.
create or replace function set_watch(p_id uuid, p_email boolean default null, p_paused boolean default null)
returns watches language plpgsql security definer set search_path = public as $$
declare w watches;
begin
  select * into w from watches where id = p_id;
  if w.id is null or not w.active then raise exception 'No such watch'; end if;
  if w.member_id <> current_member_id() then raise exception 'That is not your watch'; end if;
  update watches set email_me = coalesce(p_email, email_me), paused = coalesce(p_paused, paused) where id = p_id returning * into w;
  perform log_audit('watch.set','watch', p_id::text, jsonb_build_object('email', w.email_me, 'paused', w.paused));
  return w;
end $$;
revoke all on function set_watch(uuid, boolean, boolean) from public, anon;
grant execute on function set_watch(uuid, boolean, boolean) to authenticated;

-- The scout: who to mail about what. Only a live watch that wants mail, is not paused, belongs to an active member
-- with an address on file. First name only, never the rest of the member row.
create or replace function watch_mail_targets()
returns table (watch_id uuid, member_id uuid, first_name text, email text, stay_id uuid, kind text,
               from_date date, to_date date, nights int, flex_days int, guests int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not current_is_bot() then raise exception 'Only the watcher reads this'; end if;
  return query
    select w.id, w.member_id, split_part(trim(m.name), ' ', 1), m.email, w.stay_id, w.kind,
           w.from_date, w.to_date, w.nights, w.flex_days, w.guests
      from watches w join members m on m.id = w.member_id
     where w.active and w.email_me and not w.paused and m.status = 'active' and not coalesce(m.bot, false)
       and m.email is not null and w.to_date >= current_date;
end $$;
revoke all on function watch_mail_targets() from public, anon;
grant execute on function watch_mail_targets() to authenticated;

create or replace function watch_mail_sent()
returns table (member_id uuid, deal_key text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not current_is_bot() then raise exception 'Only the watcher reads this'; end if;
  return query select l.member_id, l.deal_key from watch_mail_log l where l.sent_at > now() - interval '60 days';
end $$;
revoke all on function watch_mail_sent() from public, anon;
grant execute on function watch_mail_sent() to authenticated;

create or replace function log_watch_mail(p_member uuid, p_keys text[])
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not current_is_bot() then raise exception 'Only the watcher records this'; end if;
  insert into watch_mail_log(member_id, deal_key) select p_member, unnest(p_keys) on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function log_watch_mail(uuid, text[]) from public, anon;
grant execute on function log_watch_mail(uuid, text[]) to authenticated;
