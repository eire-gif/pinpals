-- Privacy hardening (13 Oct 2026). Design: claude/privacy-hardening.md.
--
-- WHY
--
--   1. A member's handicap could be read by any signed-in member straight
--      from the database even when they'd chosen not to share it. The apps
--      hid it, but the column was readable. Likewise the Golf Ireland (or
--      England Golf…) membership number, which nobody but its owner needs.
--   2. Supabase's security check flagged trigger functions callable over the
--      API (harmless, but they have no business being callable) and seven
--      functions without a fixed search path.
--
-- WHAT CHANGES
--
--   member_private holds the true values, readable and writable only by
--   their owner: handicap and membership number.
--
--   profiles.handicap becomes the SHARED copy: the database sets it to the
--   member's handicap when handicap_visible is on, and to null when it's
--   off. Every existing query that reads other members' handicaps carries
--   on unchanged and now simply gets null for a hidden one.
--   profiles.gui_membership_number is always null from now on.
--
--   Writes: the apps now write member_private. An older app that still
--   writes profiles.handicap or profiles.gui_membership_number keeps
--   working — the trigger moves the value across — except clearing a
--   handicap while it's hidden, which needs the new apps.
--
--   The views flagged as "security definer" (auction_bid_history,
--   member_age_bands, seller_rating_summaries) stay as they are on purpose:
--   each exposes only an aggregate (no bidder, an age band not a birthday,
--   an average rating) of a table members can't read directly.
--
-- Rollback:
--   update public.profiles p set handicap = m.handicap, gui_membership_number = m.gui_membership_number
--     from public.member_private m where m.member_id = p.id;
--   drop trigger if exists profiles_private_fields on public.profiles;
--   drop trigger if exists member_private_sync on public.member_private;
--   drop table if exists public.member_private;
--   drop trigger if exists profiles_private_row on public.profiles;
--   drop function if exists public.profiles_private_fields(), public.profiles_private_row(), public.member_private_sync();
--   …and restore 0118's member_affinity.


-- ============ The owner-only values ============

create table if not exists public.member_private (
  member_id uuid primary key references public.profiles (id) on delete cascade,
  handicap numeric(3, 1) check (handicap is null or handicap between -10 and 54),
  gui_membership_number text check (gui_membership_number is null or char_length(btrim(gui_membership_number)) between 1 and 40),
  updated_at timestamptz not null default now()
);

alter table public.member_private enable row level security;

drop policy if exists "own private details" on public.member_private;
create policy "own private details" on public.member_private
  for select to authenticated using (member_id = (select auth.uid()));
drop policy if exists "add own private details" on public.member_private;
create policy "add own private details" on public.member_private
  for insert to authenticated with check (member_id = (select auth.uid()));
drop policy if exists "change own private details" on public.member_private;
create policy "change own private details" on public.member_private
  for update to authenticated using (member_id = (select auth.uid())) with check (member_id = (select auth.uid()));

revoke all on public.member_private from anon, authenticated;
grant select, insert, update on public.member_private to authenticated;

-- Everyone's current values, before the shared copies are blanked.
insert into public.member_private (member_id, handicap, gui_membership_number)
select id, handicap, nullif(btrim(gui_membership_number), '')
  from public.profiles
on conflict (member_id) do nothing;


-- ============ Keeping profiles in step ============

-- Two settings stop the triggers chasing each other:
--   pinpals.private_sync  — this profiles update comes from member_private_sync
--   pinpals.from_profiles — this member_private write comes from a profiles trigger

-- profiles, before an update: move any value written the old way into
-- member_private, then set the shared handicap and blank the number.
create or replace function public.profiles_private_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_truth numeric;
begin
  if current_setting('pinpals.private_sync', true) is distinct from 'on' then
    perform set_config('pinpals.from_profiles', 'on', true);
    -- A direct write of the old columns (an older app, the admin tools).
    if new.handicap is distinct from old.handicap then
      insert into public.member_private (member_id, handicap) values (new.id, new.handicap)
      on conflict (member_id) do update set handicap = excluded.handicap, updated_at = now();
    end if;
    if new.gui_membership_number is not null and btrim(new.gui_membership_number) <> '' then
      insert into public.member_private (member_id, gui_membership_number) values (new.id, btrim(new.gui_membership_number))
      on conflict (member_id) do update set gui_membership_number = excluded.gui_membership_number, updated_at = now();
    end if;
    perform set_config('pinpals.from_profiles', 'off', true);
  end if;

  select handicap into v_truth from public.member_private where member_id = new.id;
  new.handicap := case when coalesce(new.handicap_visible, false) then v_truth end;
  new.gui_membership_number := null;
  return new;
end;
$$;
revoke all on function public.profiles_private_fields() from public, anon, authenticated;

drop trigger if exists profiles_private_fields on public.profiles;
create trigger profiles_private_fields
  before update on public.profiles
  for each row execute function public.profiles_private_fields();

-- profiles, after an insert (a new member): their row in member_private,
-- with anything they signed up with. That write then sets the shared copy.
create or replace function public.profiles_private_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.member_private (member_id, handicap, gui_membership_number)
  values (new.id, new.handicap, nullif(btrim(coalesce(new.gui_membership_number, '')), ''))
  on conflict (member_id) do nothing;
  return null;
end;
$$;
revoke all on function public.profiles_private_row() from public, anon, authenticated;

drop trigger if exists profiles_private_row on public.profiles;
create trigger profiles_private_row
  after insert on public.profiles
  for each row execute function public.profiles_private_row();

-- member_private, after a write from the apps: refresh the shared copy.
create or replace function public.member_private_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('pinpals.from_profiles', true) = 'on' then
    return null;
  end if;
  perform set_config('pinpals.private_sync', 'on', true);
  update public.profiles set handicap = null where id = new.member_id;
  perform set_config('pinpals.private_sync', 'off', true);
  return null;
end;
$$;
revoke all on function public.member_private_sync() from public, anon, authenticated;

drop trigger if exists member_private_sync on public.member_private;
create trigger member_private_sync
  after insert or update on public.member_private
  for each row execute function public.member_private_sync();

-- Blank the shared copies now: hidden handicaps, and every membership number.
select set_config('pinpals.private_sync', 'on', true);
update public.profiles set handicap = handicap;
select set_config('pinpals.private_sync', 'off', true);


-- ============ Your own handicap, where a function needs it ============

create or replace function public.member_affinity(p_other uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_result jsonb;
begin
  if v_me is null or p_other is null or v_me = p_other or public.is_blocked(v_me, p_other) then
    return null;
  end if;

  with my_conns as (
    select case when x.requester_id = v_me then x.recipient_id else x.requester_id end as other
      from public.connections x
     where x.status = 'accepted' and (x.requester_id = v_me or x.recipient_id = v_me)
  ),
  their_conns as (
    select case when x.requester_id = p_other then x.recipient_id else x.requester_id end as other
      from public.connections x
     where x.status = 'accepted' and (x.requester_id = p_other or x.recipient_id = p_other)
  ),
  mutual as (
    select p.id, p.first_name, p.avatar_url, p.avatar_color,
           left(coalesce(p.first_name, ''), 1) || left(coalesce(p.last_name, ''), 1) as initials
      from public.profiles p
     where p.id in (select other from my_conns intersect select other from their_conns)
       and p.deleted_at is null
  ),
  shared as (
    select distinct cl.name
      from public.member_courses a
      join public.member_courses b on b.club_id = a.club_id and b.member_id = p_other and b.kind = 'played'
      join public.clubs cl on cl.id = a.club_id
     where a.member_id = v_me and a.kind = 'played'
  )
  select jsonb_build_object(
    'mutual_count', (select count(*) from mutual),
    'mutual', coalesce((select jsonb_agg(jsonb_build_object('first_name', first_name, 'initials', initials,
                          'avatar_url', avatar_url, 'avatar_color', avatar_color))
                          from (select * from mutual order by first_name limit 3) m), '[]'::jsonb),
    'same_club', (select me.home_club_id is not null and me.home_club_id = them.home_club_id
                    from public.profiles me, public.profiles them where me.id = v_me and them.id = p_other),
    'club_name', (select home_club from public.profiles where id = p_other),
    'shared_courses', coalesce((select jsonb_agg(name) from (select name from shared order by name limit 3) s), '[]'::jsonb),
    'shared_course_count', (select count(*) from shared),
    'my_handicap', (select handicap from public.member_private where member_id = v_me),
    'their_handicap', (select case when handicap_visible then handicap end from public.profiles where id = p_other),
    'rounds_logged', (select count(*) from public.live_round_players lp
                        join public.live_rounds r on r.id = lp.round_id
                       where lp.member_id = p_other and r.status = 'finished'),
    'played_together', exists (select 1 from public.live_round_players a
                                 join public.live_round_players b on b.round_id = a.round_id and b.member_id = p_other
                                where a.member_id = v_me),
    'open_round', (select jsonb_build_object('id', t.id, 'play_date', t.play_date, 'time_from', t.time_from,
                                             'exact_tee_time', t.exact_tee_time, 'club_name', coalesce(cl.name, t.club_name),
                                             'spaces', t.spaces_available)
                     from public.tee_time_invites t
                     left join public.clubs cl on cl.id = t.club_id
                    where t.member_id = p_other and t.status = 'open' and t.spaces_available > 0
                      and t.play_date >= current_date
                    order by t.play_date, t.time_from nulls last
                    limit 1)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.member_affinity(uuid) from public, anon;
grant execute on function public.member_affinity(uuid) to authenticated;


-- ============ Handicaps that use the real value ============
-- The handicap indicator works from the index the member really plays off,
-- and a society's officers see their members' handicaps (0122: joining a
-- society shares it with the people who run it). Both now read
-- member_private, so hiding a handicap from everyone else changes neither.

create or replace function public.handicap_differentials_of(p_member uuid)
returns table (
  scorecard_id bigint,
  played_on date,
  course_name text,
  tee_name text,
  adjusted_gross integer,
  differential numeric,
  counts boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with recent as (
    select s.id, s.played_on, s.course_name, s.tee_name, s.course_rating, s.slope,
           coalesce(s.handicap_index, p.handicap) as idx,
           coalesce(s.par_total, (select sum(h.par) from public.scorecard_holes h where h.scorecard_id = s.id))::int as par
      from public.scorecards s
      left join public.member_private p on p.member_id = s.member_id
     where s.member_id = p_member
       and s.holes = 18
       and s.course_rating is not null
       and s.slope is not null
       and (select count(*) from public.scorecard_holes h where h.scorecard_id = s.id) = 18
       and (select count(*) from public.scorecard_holes h where h.scorecard_id = s.id and h.strokes is not null) >= 14
     order by s.played_on desc, s.id desc
     limit 20
  ),
  -- Course handicap for the card's tees (WHS), from the index played off.
  ch as (
    select r.*,
           case when r.idx is null then null
                else round(r.idx * r.slope / 113.0 + (r.course_rating - r.par))::int end as course_hcp
      from recent r
  ),
  holes as (
    select c.id,
           h.strokes,
           case
             when c.course_hcp is null then h.par + 5
             else h.par + 2
                  + floor(c.course_hcp / 18.0)::int
                  + case when coalesce(h.stroke_index, h.hole) <= ((c.course_hcp % 18) + 18) % 18 then 1 else 0 end
           end as cap
      from ch c
      join public.scorecard_holes h on h.scorecard_id = c.id
  ),
  scored as (
    select c.id, c.played_on, c.course_name, c.tee_name,
           sum(least(coalesce(h.strokes, h.cap), h.cap))::int as ags,
           c.course_rating, c.slope
      from ch c
      join holes h on h.id = c.id
     group by c.id, c.played_on, c.course_name, c.tee_name, c.course_rating, c.slope
  ),
  diffs as (
    select s.*,
           round((113.0 / s.slope) * (s.ags - s.course_rating), 1) as diff,
           count(*) over () as n,
           row_number() over (order by round((113.0 / s.slope) * (s.ags - s.course_rating), 1), s.played_on desc, s.id desc) as rank
      from scored s
  )
  select d.id, d.played_on, d.course_name, d.tee_name, d.ags, d.diff,
         d.n >= 3 and d.rank <= case
           when d.n <= 5 then 1
           when d.n <= 8 then 2
           when d.n <= 11 then 3
           when d.n <= 14 then 4
           when d.n <= 16 then 5
           when d.n <= 18 then 6
           when d.n = 19 then 7
           else 8
         end
    from diffs d
   order by d.played_on desc, d.id desc;
$$;
revoke all on function public.handicap_differentials_of(uuid) from public, anon, authenticated;

create or replace function public.society_handicaps(p_group_id bigint)
returns table (
  member_id uuid,
  own_index numeric,
  indicator numeric,
  rounds integer,
  society_index numeric,
  society_index_set_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (select kind from public.groups where id = p_group_id and hidden_at is null) is distinct from 'society' then
    raise exception 'Only a society keeps handicaps.';
  end if;
  if coalesce(public.group_role(p_group_id, (select auth.uid())), '') not in ('owner', 'admin') then
    raise exception 'Only the society''s captain and secretary can see its handicaps.';
  end if;

  return query
    select m.member_id, p.handicap, i.indicator, i.rounds, m.society_index, m.society_index_set_at
      from public.group_members m
      left join public.member_private p on p.member_id = m.member_id
      cross join lateral public.handicap_indicator_of(m.member_id) i
     where m.group_id = p_group_id;
end;
$$;
revoke all on function public.society_handicaps(bigint) from public, anon, authenticated;
grant execute on function public.society_handicaps(bigint) to authenticated;


-- ============ Trigger functions aren't for calling ============

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.sync_denormalised_club_names() from public, anon, authenticated;
revoke all on function public.validate_article_image() from public, anon, authenticated;


-- ============ A fixed search path for every function ============

alter function public.set_updated_at() set search_path = public;
alter function public.apply_order_payment_succeeded(bigint, bigint, text, text) set search_path = public;
alter function public.format_eur(numeric) set search_path = public;
alter function public.realtime_conversation_id(text) set search_path = public;
alter function public.realtime_typing_conversation_id(text) set search_path = public;
do $fix$
begin
  -- Made outside the migrations (course imports); fixed where they exist.
  if to_regprocedure('public.osm_slug(text)') is not null then
    execute 'alter function public.osm_slug(text) set search_path = public';
  end if;
  if to_regprocedure('public.osm_norm(text)') is not null then
    execute 'alter function public.osm_norm(text) set search_path = public';
  end if;
end
$fix$;
