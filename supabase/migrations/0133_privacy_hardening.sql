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
