-- Society noticeboard, alert settings, targeted messages and reminders (14 Oct 2026).
-- Design: claude/society-entries.md (section "Alerts"). Builds on 0142's outbox.
--
-- WHAT CHANGES
--
--   1. A noticeboard per society: the captain or secretary posts notices
--      (general, a change, a reminder, a result), can pin one, and can send
--      it as an alert too. Members read them.
--   2. Alert settings per member per society: new events, entries closing,
--      tee times, payment reminders, noticeboard posts, results. A missing
--      row means on. Alerts about the member's own place (confirmed, offered,
--      declined, an event changed or cancelled) and messages from the
--      officers are always on; the sender applies these settings.
--   3. Targeted messages: the officers send to everyone, an event's entrants,
--      its waiting list, those who owe an event fee, or the committee. They
--      go out as alerts (the Inbox and phone push) and are logged for the
--      officers. A message about money is never posted on the noticeboard.
--   4. Reminders, every 15 minutes, by pg_cron:
--        entries closing — the day before, to members not entered or queued
--        your tee time tomorrow — from 5pm the day before
--        payment due — in the week before, at most once a week, daytime only
--      Each lands once per member per event (dedupe keys).
--   5. The website sends what's in the outbox, every few minutes and right
--      after a member's change: pg_cron calls POST /api/societies/alerts/run
--      with the bearer token in vault secret 'society_alerts_cron_secret'
--      (SOCIETY_ALERTS_CRON_SECRET on Vercel) if one is set up, otherwise
--      the existing scheduled-jobs secret 'account_deletion_cron_secret'.
--
-- Rollback:
--   select cron.unschedule('pinpals-society-reminders'); select cron.unschedule('pinpals-society-alerts');
--   drop table if exists public.society_messages, public.society_notices, public.society_alert_prefs;
--   drop function … (section names below).


-- ============ 1. Alert settings ============

create table if not exists public.society_alert_prefs (
  group_id bigint not null references public.groups (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('new_event', 'entries_closing', 'tee_times', 'payment_reminders', 'noticeboard', 'results')),
  enabled boolean not null,
  primary key (group_id, member_id, kind)
);
alter table public.society_alert_prefs enable row level security;

drop policy if exists "own alert settings" on public.society_alert_prefs;
create policy "own alert settings" on public.society_alert_prefs
  for select to authenticated using (member_id = (select auth.uid()));
revoke all on public.society_alert_prefs from anon, authenticated;
grant select on public.society_alert_prefs to authenticated;

create or replace function public.set_society_alert_pref(p_group_id bigint, p_kind text, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
begin
  if not public.is_group_member(p_group_id, me) then
    raise exception 'That group isn''t available.';
  end if;
  if p_kind not in ('new_event', 'entries_closing', 'tee_times', 'payment_reminders', 'noticeboard', 'results') then
    raise exception 'That isn''t an alert you can switch.';
  end if;
  insert into public.society_alert_prefs (group_id, member_id, kind, enabled)
  values (p_group_id, me, p_kind, coalesce(p_enabled, true))
  on conflict (group_id, member_id, kind) do update set enabled = excluded.enabled;
end;
$$;
revoke all on function public.set_society_alert_pref(bigint, text, boolean) from public, anon, authenticated;
grant execute on function public.set_society_alert_pref(bigint, text, boolean) to authenticated;


-- ============ 2. The noticeboard ============

create table if not exists public.society_notices (
  id bigint generated always as identity primary key,
  group_id bigint not null references public.groups (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  kind text not null default 'general' check (kind in ('general', 'change', 'reminder', 'result')),
  title text not null check (char_length(btrim(title)) between 1 and 80),
  body text check (body is null or char_length(body) <= 2000),
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index if not exists society_notices_group_idx on public.society_notices (group_id, created_at desc);
-- One pinned notice per group.
create unique index if not exists society_notices_one_pinned on public.society_notices (group_id) where pinned;

alter table public.society_notices enable row level security;
drop policy if exists "group members read notices" on public.society_notices;
create policy "group members read notices" on public.society_notices
  for select to authenticated using (public.is_group_member(group_id, (select auth.uid())));
revoke all on public.society_notices from anon, authenticated;
grant select on public.society_notices to authenticated;

-- Who may post notices and send messages. 0144 widens this to the other
-- committee roles; today it's whoever runs the group (owner, captain, secretary).
create or replace function public.society_can_message(p_group_id bigint, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.outing_officer(p_group_id, p_user);
$$;
revoke all on function public.society_can_message(bigint, uuid) from public, anon, authenticated;
grant execute on function public.society_can_message(bigint, uuid) to authenticated;

-- p: { kind?, title, body?, pinned?, alert? }. With p_id, edits it (and
-- never alerts again). Returns the notice id.
create or replace function public.save_society_notice(p_group_id bigint, p_id bigint, p jsonb)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  v_kind text := coalesce(nullif(p ->> 'kind', ''), 'general');
  v_title text := btrim(coalesce(p ->> 'title', ''));
  v_body text := nullif(btrim(coalesce(p ->> 'body', '')), '');
  v_pinned boolean := coalesce((p ->> 'pinned')::boolean, false);
  v_alert boolean := coalesce((p ->> 'alert')::boolean, false);
  v_id bigint;
begin
  if not public.society_can_message(p_group_id, me) then
    raise exception 'Only the captain or secretary can post on the noticeboard.' using errcode = '42501';
  end if;
  if v_kind not in ('general', 'change', 'reminder', 'result') then raise exception 'Choose what kind of notice it is.'; end if;
  if char_length(v_title) = 0 then raise exception 'Give the notice a title.'; end if;
  if char_length(v_title) > 80 then raise exception 'The title is 80 characters at most.'; end if;
  if v_body is not null and char_length(v_body) > 2000 then raise exception 'The notice is 2,000 characters at most.'; end if;

  if v_pinned then
    update public.society_notices set pinned = false where group_id = p_group_id and pinned and id is distinct from p_id;
  end if;

  if p_id is null then
    if (select count(*) from public.society_notices where group_id = p_group_id and created_at > now() - interval '1 day') >= 20 then
      raise exception 'That''s a lot of notices for one day — 20 at most.';
    end if;
    insert into public.society_notices (group_id, author_id, kind, title, body, pinned)
    values (p_group_id, me, v_kind, v_title, v_body, v_pinned)
    returning id into v_id;
    if v_alert then
      perform public.queue_society_alert(p_group_id, null, m.member_id, 'notice',
               jsonb_build_object('notice_id', v_id, 'title', v_title, 'kind', v_kind), 'notice:' || v_id)
         from public.group_members m where m.group_id = p_group_id and m.member_id <> me;
    end if;
    return v_id;
  end if;

  update public.society_notices
     set kind = v_kind, title = v_title, body = v_body, pinned = v_pinned, edited_at = now()
   where id = p_id and group_id = p_group_id
   returning id into v_id;
  if v_id is null then raise exception 'That notice has gone.'; end if;
  return v_id;
end;
$$;
revoke all on function public.save_society_notice(bigint, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.save_society_notice(bigint, bigint, jsonb) to authenticated;

create or replace function public.delete_society_notice(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group bigint := (select group_id from public.society_notices where id = p_id);
begin
  if v_group is null or not public.society_can_message(v_group, (select auth.uid())) then
    raise exception 'Only the captain or secretary can take a notice down.' using errcode = '42501';
  end if;
  delete from public.society_notices where id = p_id;
end;
$$;
revoke all on function public.delete_society_notice(bigint) from public, anon, authenticated;
grant execute on function public.delete_society_notice(bigint) to authenticated;


-- ============ 3. Targeted messages ============

create table if not exists public.society_messages (
  id bigint generated always as identity primary key,
  group_id bigint not null references public.groups (id) on delete cascade,
  sender_id uuid references public.profiles (id) on delete set null,
  audience text not null,
  outing_id bigint references public.society_outings (id) on delete set null,
  title text not null check (char_length(btrim(title)) between 1 and 80),
  body text check (body is null or char_length(body) <= 1000),
  recipients integer not null,
  sent_at timestamptz not null default now()
);
create index if not exists society_messages_group_idx on public.society_messages (group_id, sent_at desc);
alter table public.society_messages enable row level security;
drop policy if exists "officers read the message log" on public.society_messages;
create policy "officers read the message log" on public.society_messages
  for select to authenticated using (public.society_can_message(group_id, (select auth.uid())));
revoke all on public.society_messages from anon, authenticated;
grant select on public.society_messages to authenticated;

-- The members an audience reaches. Internal; 0144 adds 'membership_unpaid'.
--   everyone      — the whole group
--   entrants      — everyone with a place on p_outing
--   waiting       — everyone asking or waiting for a place on p_outing
--   fees_unpaid   — on p_outing (or, without one, any event still to come)
--                   with a fee, not marked paid
--   committee     — whoever runs the group
create or replace function public.society_audience(p_group_id bigint, p_audience text, p_outing_id bigint)
returns setof uuid
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_audience = 'everyone' then
    return query select m.member_id from public.group_members m where m.group_id = p_group_id;
  elsif p_audience = 'entrants' then
    return query select e.member_id from public.society_outing_entries e
      join public.society_outings o on o.id = e.outing_id
     where o.id = p_outing_id and o.group_id = p_group_id;
  elsif p_audience = 'waiting' then
    return query select q.member_id from public.society_outing_queue q
      join public.society_outings o on o.id = q.outing_id
     where o.id = p_outing_id and o.group_id = p_group_id;
  elsif p_audience = 'fees_unpaid' then
    return query select distinct e.member_id from public.society_outing_entries e
      join public.society_outings o on o.id = e.outing_id
     where o.group_id = p_group_id and o.status = 'open' and coalesce(o.entry_fee_cents, 0) > 0
       and (case when p_outing_id is null then o.plays_on >= (now() at time zone 'Europe/Dublin')::date else o.id = p_outing_id end)
       and not exists (select 1 from public.society_outing_payments p where p.outing_id = o.id and p.member_id = e.member_id);
  elsif p_audience = 'committee' then
    return query select x from public.outing_officer_ids(p_group_id) x;
  else
    raise exception 'Choose who it''s for.';
  end if;
end;
$$;
revoke all on function public.society_audience(bigint, text, bigint) from public, anon, authenticated;

-- How many an audience would reach, for the Send button.
create or replace function public.society_audience_count(p_group_id bigint, p_audience text, p_outing_id bigint default null)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.society_can_message(p_group_id, (select auth.uid())) then
    raise exception 'Only the captain or secretary can send messages.' using errcode = '42501';
  end if;
  return (select count(distinct x)::integer from public.society_audience(p_group_id, p_audience, p_outing_id) x);
end;
$$;
revoke all on function public.society_audience_count(bigint, text, bigint) from public, anon, authenticated;
grant execute on function public.society_audience_count(bigint, text, bigint) to authenticated;

-- Send it. p_post_notice puts it on the noticeboard too, for 'everyone'
-- only — a message to those who owe money stays private. Returns how many
-- it went to (the sender is never counted or sent their own).
create or replace function public.send_society_message(p_group_id bigint, p_audience text, p_outing_id bigint, p_title text, p_body text, p_post_notice boolean default false)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  v_title text := btrim(coalesce(p_title, ''));
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_msg bigint;
  v_n integer;
begin
  if not public.society_can_message(p_group_id, me) then
    raise exception 'Only the captain or secretary can send messages.' using errcode = '42501';
  end if;
  if p_audience in ('entrants', 'waiting') and p_outing_id is null then raise exception 'Choose the event.'; end if;
  if p_outing_id is not null and not exists (select 1 from public.society_outings where id = p_outing_id and group_id = p_group_id) then
    raise exception 'That event isn''t in this group.';
  end if;
  if char_length(v_title) = 0 then raise exception 'Give the message a title.'; end if;
  if char_length(v_title) > 80 then raise exception 'The title is 80 characters at most.'; end if;
  if v_body is not null and char_length(v_body) > 1000 then raise exception 'The message is 1,000 characters at most.'; end if;
  if (select count(*) from public.society_messages where group_id = p_group_id and sent_at > now() - interval '1 day') >= 10 then
    raise exception 'That''s ten messages today already — try again tomorrow.';
  end if;
  if p_post_notice and p_audience <> 'everyone' then
    raise exception 'Only a message to everyone goes on the noticeboard.';
  end if;

  select count(distinct x)::integer into v_n from public.society_audience(p_group_id, p_audience, p_outing_id) x where x <> me;
  if v_n = 0 then raise exception 'Nobody to send it to.'; end if;

  insert into public.society_messages (group_id, sender_id, audience, outing_id, title, body, recipients)
  values (p_group_id, me, p_audience, p_outing_id, v_title, v_body, v_n)
  returning id into v_msg;

  perform public.queue_society_alert(p_group_id, p_outing_id, x, 'message',
           jsonb_build_object('message_id', v_msg, 'title', v_title, 'body', v_body, 'sender', me),
           'message:' || v_msg)
     from (select distinct x from public.society_audience(p_group_id, p_audience, p_outing_id) x where x <> me) a(x);

  if p_post_notice then
    insert into public.society_notices (group_id, author_id, kind, title, body)
    values (p_group_id, me, 'general', v_title, v_body);
  end if;
  return v_n;
end;
$$;
revoke all on function public.send_society_message(bigint, text, bigint, text, text, boolean) from public, anon, authenticated;
grant execute on function public.send_society_message(bigint, text, bigint, text, text, boolean) to authenticated;


-- ============ 4. Reminders ============

-- Queues the reminders now due. Each is once per member per event (per
-- week, for payments), so running it often is harmless.
create or replace function public.society_reminder_sweep()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_local timestamp := now() at time zone 'Europe/Dublin';
  v_today date := (now() at time zone 'Europe/Dublin')::date;
  v_before integer := (select count(*) from public.society_alerts);
begin
  -- Entries close within a day: members of the group not in and not asking.
  perform public.queue_society_alert(o.group_id, o.id, m.member_id, 'entries_closing',
           jsonb_build_object('title', o.title, 'plays_on', o.plays_on,
                              'closes_at', coalesce(o.entries_close_at, public.outing_entries_close_at(o.plays_on))),
           'entries_closing:' || o.id)
     from public.society_outings o
     join public.group_members m on m.group_id = o.group_id
    where o.status = 'open' and o.match_day_id is null and o.hidden_at is null
      and coalesce(o.entries_close_at, public.outing_entries_close_at(o.plays_on)) between v_now and v_now + interval '24 hours'
      -- Not for something set up in the last day: its "new event" alert is enough.
      and o.created_at < v_now - interval '1 day'
      and not exists (select 1 from public.society_outing_entries e where e.outing_id = o.id and e.member_id = m.member_id)
      and not exists (select 1 from public.society_outing_queue q where q.outing_id = o.id and q.member_id = m.member_id);

  -- Your tee time tomorrow, from 5pm the evening before.
  if extract(hour from v_local) between 17 and 22 then
    perform public.queue_society_alert(o.group_id, o.id, e.member_id, 'tee_time_tomorrow',
             jsonb_build_object('title', o.title, 'plays_on', o.plays_on, 'course', o.course_name,
                                'tee_time', e.tee_time, 'tee_group', e.tee_group, 'arrive_by', o.arrive_by),
             'tee_time_tomorrow:' || o.id)
       from public.society_outings o
       join public.society_outing_entries e on e.outing_id = o.id
      where o.status = 'open' and o.hidden_at is null and o.plays_on = v_today + 1
        and o.draw_published_at is not null and e.tee_group is not null;
  end if;

  -- Payment due: in the week before the event, daytime, at most once a week.
  if extract(hour from v_local) between 10 and 19 then
    perform public.queue_society_alert(o.group_id, o.id, e.member_id, 'payment_due',
             jsonb_build_object('title', o.title, 'plays_on', o.plays_on, 'fee_cents', o.entry_fee_cents),
             'payment_due:' || o.id || ':' || to_char(v_today, 'IYYY-IW'))
       from public.society_outings o
       join public.society_outing_entries e on e.outing_id = o.id
      where o.status = 'open' and o.hidden_at is null and coalesce(o.entry_fee_cents, 0) > 0
        and o.plays_on between v_today + 1 and v_today + 7
        and not exists (select 1 from public.society_outing_payments p where p.outing_id = o.id and p.member_id = e.member_id)
        and not exists (select 1 from public.society_outing_payment_claims c where c.outing_id = o.id and c.member_id = e.member_id);
  end if;

  return (select count(*) from public.society_alerts) - v_before;
end;
$$;
revoke all on function public.society_reminder_sweep() from public, anon, authenticated;


-- ============ 5. Schedules ============

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is not available here, so the society schedules were NOT created. Expected on a local replay or in CI.';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'pinpals-society-reminders') then
    perform cron.unschedule('pinpals-society-reminders');
  end if;
  perform cron.schedule('pinpals-society-reminders', '*/15 * * * *', 'select public.society_reminder_sweep()');

  if exists (select 1 from cron.job where jobname = 'pinpals-society-alerts') then
    perform cron.unschedule('pinpals-society-alerts');
  end if;
  -- Every 3 minutes: send whatever is in the outbox. The app also asks for
  -- this straight after a change, so most alerts go out within seconds.
  perform cron.schedule(
    'pinpals-society-alerts',
    '*/3 * * * *',
    $job$
      select net.http_post(
        url     := 'https://www.pinpals.ie/api/societies/alerts/run',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', 'Bearer ' || coalesce(
            (select decrypted_secret from vault.decrypted_secrets where name = 'society_alerts_cron_secret' limit 1),
            (select decrypted_secret from vault.decrypted_secrets where name = 'account_deletion_cron_secret' limit 1),
            'unset'
          )
        ),
        body    := '{}'::jsonb,
        timeout_milliseconds := 55000
      )
      where exists (select 1 from public.society_alerts where sent_at is null);
    $job$
  );
end
$$;

notify pgrst, 'reload schema';
