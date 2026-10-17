-- 0161_live_activity.sql — the super admin's live view of the platform (Oct 2026).
--
-- The admin Overview gets a "Live now" panel: who is on the website and the
-- app right now and in which section, games being played at this moment,
-- what has happened today so far (games, new members, tee times, listings,
-- messages, views), app installs, and a running feed of the latest events.
--
-- Most of it is counted from tables that already exist (live_rounds,
-- profiles, tee_time_invites, listings, messages, posts, push_subscriptions).
-- Three things weren't recorded anywhere, so this adds them:
--
--   activity_sessions — one row per browser tab / app launch, refreshed by a
--                       ping about once a minute while it's open. "Online now"
--                       is a session seen in the last 2 minutes. Holds the
--                       member (if signed in), platform and current section.
--                       Kept 30 days, then deleted.
--   activity_views    — page / screen views counted per hour, platform and
--                       section. Counts only; nothing about who.
--   app_installs      — one row per installed copy of the app (a random id
--                       the app makes on first launch). The nearest thing to
--                       "downloads" the database can see; the store totals
--                       live in App Store Connect / Play Console.
--
-- WRITES go through POST /api/activity (src/app/api/activity/route.ts), which
-- works out the member from their cookie or bearer token and calls
-- record_activity() with the service role. Members and anon have no access
-- to these tables or functions at all — nobody can read someone else's
-- whereabouts, or mark someone else as online.
--
-- READS: admin_live_stats() — one round trip for the whole panel, service
-- role only, called after requireStaff() has checked the viewer is a super
-- admin (src/app/admin/live/route.ts).
--
-- Additive and idempotent. Rollback:
--   drop function if exists public.admin_live_stats(text);
--   drop function if exists public.record_activity(text, uuid, text, text, boolean, text, text);
--   drop table if exists public.app_installs, public.activity_views, public.activity_sessions;

create table if not exists public.activity_sessions (
  session_key text primary key check (session_key ~ '^[A-Za-z0-9-]{16,64}$'),
  member_id uuid references public.profiles (id) on delete cascade,
  platform text not null check (platform in ('web', 'ios', 'android')),
  section text not null check (char_length(section) between 1 and 32),
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists activity_sessions_last_seen_idx on public.activity_sessions (last_seen_at desc);
create index if not exists activity_sessions_started_idx on public.activity_sessions (started_at desc);
create index if not exists activity_sessions_member_idx on public.activity_sessions (member_id) where member_id is not null;

create table if not exists public.activity_views (
  hour timestamptz not null,
  platform text not null check (platform in ('web', 'ios', 'android')),
  section text not null check (char_length(section) between 1 and 32),
  views integer not null default 0 check (views >= 0),
  primary key (hour, platform, section)
);

create table if not exists public.app_installs (
  install_id text primary key check (install_id ~ '^[A-Za-z0-9-]{16,64}$'),
  platform text not null check (platform in ('ios', 'android')),
  member_id uuid references public.profiles (id) on delete set null,
  app_version text check (app_version is null or char_length(app_version) <= 40),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  opens integer not null default 1 check (opens >= 0)
);

create index if not exists app_installs_first_seen_idx on public.app_installs (first_seen_at desc);
create index if not exists app_installs_last_seen_idx on public.app_installs (last_seen_at desc);

-- Indexes the panel's "today" counts lean on that didn't exist yet.
create index if not exists live_rounds_status_created_idx on public.live_rounds (status, created_at desc);
create index if not exists live_round_scores_updated_idx on public.live_round_scores (updated_at desc);
create index if not exists messages_created_idx on public.messages (created_at desc);

alter table public.activity_sessions enable row level security;
alter table public.activity_views enable row level security;
alter table public.app_installs enable row level security;
revoke all on public.activity_sessions, public.activity_views, public.app_installs from anon, authenticated;

-- ---------------------------------------------------------------------------
-- record_activity: one ping. p_view = true when this ping is a new page or
-- screen (counts a view); false for the once-a-minute "still here".
-- ---------------------------------------------------------------------------
create or replace function public.record_activity(
  p_session text,
  p_member uuid,
  p_platform text,
  p_section text,
  p_view boolean,
  p_install text default null,
  p_app_version text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_session boolean;
begin
  if p_member is not null and not exists (select 1 from public.profiles where id = p_member) then
    p_member := null;
  end if;

  insert into public.activity_sessions as s (session_key, member_id, platform, section)
  values (p_session, p_member, p_platform, p_section)
  on conflict (session_key) do update
     set last_seen_at = now(),
         section = excluded.section,
         member_id = coalesce(excluded.member_id, s.member_id)
   where s.platform = excluded.platform
  returning (xmax = 0) into v_new_session;

  if p_view then
    insert into public.activity_views as v (hour, platform, section, views)
    values (date_trunc('hour', now()), p_platform, p_section, 1)
    on conflict (hour, platform, section) do update set views = v.views + 1;
  end if;

  if p_install is not null and p_platform in ('ios', 'android') then
    insert into public.app_installs as a (install_id, platform, member_id, app_version)
    values (p_install, p_platform, p_member, left(p_app_version, 40))
    on conflict (install_id) do update
       set last_seen_at = now(),
           member_id = coalesce(excluded.member_id, a.member_id),
           app_version = coalesce(excluded.app_version, a.app_version),
           opens = a.opens + case when coalesce(v_new_session, false) then 1 else 0 end;
  end if;

  -- Housekeeping, about one ping in two hundred.
  if random() < 0.005 then
    delete from public.activity_sessions where last_seen_at < now() - interval '30 days';
    delete from public.activity_views where hour < now() - interval '400 days';
  end if;
end;
$$;

revoke all on function public.record_activity(text, uuid, text, text, boolean, text, text) from public;
revoke execute on function public.record_activity(text, uuid, text, text, boolean, text, text) from anon, authenticated;
grant execute on function public.record_activity(text, uuid, text, text, boolean, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- admin_live_stats: the whole panel as one jsonb document. "Today" starts at
-- midnight in p_tz (Irish time by default); "yesterday" figures are for the
-- same span of yesterday (midnight to this time) so they compare fairly.
-- A game is "in play" when it's live and has been started or scored in the
-- last 30 minutes — a round nobody finished doesn't count for ever.
-- ---------------------------------------------------------------------------
create or replace function public.admin_live_stats(p_tz text default 'Europe/Dublin')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_day timestamptz := date_trunc('day', now() at time zone p_tz) at time zone p_tz;
  v_yday timestamptz := v_day - interval '1 day';
  v_ynow timestamptz := now() - interval '1 day';
  v_online timestamptz := now() - interval '2 minutes';
  v_play timestamptz := now() - interval '30 minutes';
  v_result jsonb;
begin
  with in_play as (
    select r.id, r.course_name, r.format, r.holes, r.created_at,
           (select max(sc.updated_at) from public.live_round_scores sc where sc.round_id = r.id) as last_score_at
      from public.live_rounds r
     where r.status = 'live' and r.created_at > v_now - interval '14 hours'
  ),
  playing as (
    select * from in_play where created_at > v_play or last_score_at > v_play
  ),
  online as (
    select * from public.activity_sessions where last_seen_at > v_online
  )
  select jsonb_build_object(
    'generated_at', v_now,
    'day_start', v_day,
    'now', jsonb_build_object(
      'online', (select count(*) from online),
      'members_online', (select count(distinct member_id) from online where member_id is not null),
      'guests_online', (select count(*) from online where member_id is null),
      'web', (select count(*) from online where platform = 'web'),
      'ios', (select count(*) from online where platform = 'ios'),
      'android', (select count(*) from online where platform = 'android'),
      'games_in_play', (select count(*) from playing),
      'players_on_course', (select count(*) from public.live_round_players p where p.round_id in (select id from playing)),
      'scores_last_10_min', (select count(*) from public.live_round_scores where updated_at > v_now - interval '10 minutes'),
      'by_section', coalesce((
        select jsonb_object_agg(section, n) from (
          select section, count(*) n from online group by section
        ) x), '{}'::jsonb)
    ),
    'games', coalesce((
      select jsonb_agg(g order by g.started_at desc) from (
        select pl.id, pl.course_name, pl.format, pl.holes, pl.created_at as started_at, pl.last_score_at,
               (select count(*) from public.live_round_players p where p.round_id = pl.id) as players,
               (select coalesce(max(sc.hole), 0) from public.live_round_scores sc where sc.round_id = pl.id) as thru
          from playing pl
         order by pl.created_at desc
         limit 12
      ) g), '[]'::jsonb),
    'today', jsonb_build_object(
      'games_started', (select count(*) from public.live_rounds where created_at >= v_day),
      'games_finished', (select count(*) from public.live_rounds where finished_at >= v_day),
      'scores_entered', (select count(*) from public.live_round_scores where updated_at >= v_day),
      'scorecards_saved', (select count(*) from public.scorecards where created_at >= v_day),
      'new_members', (select count(*) from public.profiles where created_at >= v_day),
      'tee_times_posted', (select count(*) from public.tee_time_invites where created_at >= v_day),
      'tee_time_requests', (select count(*) from public.tee_time_interests where created_at >= v_day),
      'listings_posted', (select count(*) from public.listings where created_at >= v_day),
      'messages_sent', (select count(*) from public.messages where created_at >= v_day),
      'posts', (select count(*) from public.posts where created_at >= v_day),
      'groups_created', (select count(*) from public.groups where created_at >= v_day),
      'visitors', (select count(distinct coalesce(member_id::text, session_key)) from public.activity_sessions where last_seen_at >= v_day),
      'members_active', (select count(distinct member_id) from public.activity_sessions where last_seen_at >= v_day and member_id is not null),
      'app_opens', (select count(*) from public.activity_sessions where started_at >= v_day and platform <> 'web'),
      'views', (select coalesce(sum(views), 0) from public.activity_views where hour >= v_day),
      'web_views', (select coalesce(sum(views), 0) from public.activity_views where hour >= v_day and platform = 'web'),
      'app_views', (select coalesce(sum(views), 0) from public.activity_views where hour >= v_day and platform <> 'web'),
      'new_installs', (select count(*) from public.app_installs where first_seen_at >= v_day)
    ),
    'yesterday', jsonb_build_object(
      'games_started', (select count(*) from public.live_rounds where created_at >= v_yday and created_at < v_ynow),
      'new_members', (select count(*) from public.profiles where created_at >= v_yday and created_at < v_ynow),
      'tee_times_posted', (select count(*) from public.tee_time_invites where created_at >= v_yday and created_at < v_ynow),
      'listings_posted', (select count(*) from public.listings where created_at >= v_yday and created_at < v_ynow),
      'messages_sent', (select count(*) from public.messages where created_at >= v_yday and created_at < v_ynow),
      'views', (select coalesce(sum(views), 0) from public.activity_views where hour >= v_yday and hour < date_trunc('hour', v_ynow)),
      'visitors', (select count(distinct coalesce(member_id::text, session_key)) from public.activity_sessions
                    where started_at < v_ynow and last_seen_at >= v_yday),
      'new_installs', (select count(*) from public.app_installs where first_seen_at >= v_yday and first_seen_at < v_ynow)
    ),
    'views_by_section', coalesce((
      select jsonb_object_agg(section, n) from (
        select section, sum(views) n from public.activity_views where hour >= v_day group by section
      ) x), '{}'::jsonb),
    'hourly', (
      select jsonb_agg(jsonb_build_object(
               'hour', h,
               'views', coalesce((select sum(views) from public.activity_views v where v.hour = h), 0),
               'games', (select count(*) from public.live_rounds r where r.created_at >= h and r.created_at < h + interval '1 hour'),
               'members', (select count(*) from public.profiles p where p.created_at >= h and p.created_at < h + interval '1 hour')
             ) order by h)
        from generate_series(v_day, date_trunc('hour', v_now), interval '1 hour') h
    ),
    'installs', jsonb_build_object(
      'total', (select count(*) from public.app_installs),
      'ios', (select count(*) from public.app_installs where platform = 'ios'),
      'android', (select count(*) from public.app_installs where platform = 'android'),
      'active_7d', (select count(*) from public.app_installs where last_seen_at > v_now - interval '7 days'),
      'push_ios', (select count(*) from public.push_subscriptions where platform = 'ios'),
      'push_android', (select count(*) from public.push_subscriptions where platform = 'android'),
      'push_web', (select count(*) from public.push_subscriptions where platform = 'web')
    ),
    'totals', jsonb_build_object(
      'members', (select count(*) from public.profiles where deleted_at is null),
      'games', (select count(*) from public.live_rounds),
      'live_listings', (select count(*) from public.listings where status = 'active')
    ),
    'feed', coalesce((
      select jsonb_agg(f order by f.at desc) from (
        (select 'game_started' as kind, r.created_at as at, r.course_name as label from public.live_rounds r
          order by r.created_at desc limit 8)
        union all
        (select 'game_finished', r.finished_at, r.course_name from public.live_rounds r
          where r.finished_at is not null order by r.finished_at desc limit 8)
        union all
        (select 'new_member', p.created_at, coalesce(nullif(btrim(concat_ws(' ', p.first_name, left(p.last_name, 1))), ''), 'A new golfer')
           from public.profiles p order by p.created_at desc limit 8)
        union all
        (select 'tee_time', t.created_at, t.club_name from public.tee_time_invites t
          order by t.created_at desc limit 8)
        union all
        (select 'listing', l.created_at, l.title from public.listings l
          order by l.created_at desc limit 8)
        union all
        (select 'group', g.created_at, g.name from public.groups g
          order by g.created_at desc limit 8)
        order by 2 desc
        limit 15
      ) f), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_live_stats(text) from public;
revoke execute on function public.admin_live_stats(text) from anon, authenticated;
grant execute on function public.admin_live_stats(text) to service_role;
