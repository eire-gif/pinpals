-- 0118 — Find PinPals: suggestions, invites, played-with, guest scorecards (Oct 2026)
--
-- Approved mock-ups (Find PinPals canvas, 10 Oct 2026), minus rewards:
--
--   1. member_invite_codes + my_invite_code() / invite_preview() /
--      connect_by_invite() — a member's own link and QR code. Opening it and
--      tapping Connect makes an ACCEPTED connection: sharing your code is the
--      consent. Codes live in their own table, readable only by their owner,
--      so nobody can lift another member's code from `profiles`.
--   2. member_suggestions() — "People you may know", best first, with a reason
--      the screen can print. Unlike suggested_pinpals() (0093, security
--      invoker) it is SECURITY DEFINER because it counts MUTUAL connections,
--      which the caller can't see row by row. It returns only counts and
--      reasons, never another member's connection list.
--      dismiss_member_suggestion() hides someone from it for good.
--   3. member_affinity() — the member card's "Why you'd get on": mutual
--      PinPals (count, and the first names of up to three — all people YOU
--      are connected to), same club, courses both played, both handicaps
--      (theirs only if they share it), rounds logged, and their next open
--      tee time.
--   4. played_with_me() — "You've played with": the people in your recent
--      live-scored rounds, members and guests.
--   5. round_guest_invites + round_guest_invite() / claim_round_guest() —
--      "Send Mark his scorecard". A round's player who isn't a member gets a
--      private link to that round's card; joining PinPals and opening it
--      puts the round on their profile and connects them with whoever sent
--      it. The public page reads the card with the service role.
--
-- Rollback:
--   drop function if exists public.claim_round_guest(text), public.round_guest_invite(bigint),
--     public.played_with_me(integer), public.member_affinity(uuid),
--     public.dismiss_member_suggestion(uuid), public.member_suggestions(integer),
--     public.connect_by_invite(text), public.invite_preview(text), public.my_invite_code(),
--     public.connect_members(uuid, uuid);
--   drop table if exists public.round_guest_invites, public.member_suggestion_dismissals,
--     public.member_invite_codes;

-- ---------------------------------------------------------------------------
-- 1. Invite codes
-- ---------------------------------------------------------------------------

create table if not exists public.member_invite_codes (
  member_id uuid primary key references public.profiles (id) on delete cascade,
  code text not null unique check (code ~ '^[a-z0-9]{8}$'),
  created_at timestamptz not null default now()
);

alter table public.member_invite_codes enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'member_invite_codes' and policyname = 'Members read their own invite code') then
    create policy "Members read their own invite code" on public.member_invite_codes
      for select to authenticated using (member_id = (select auth.uid()));
  end if;
end $$;

revoke all on public.member_invite_codes from anon;
revoke insert, update, delete, truncate, references, trigger on public.member_invite_codes from authenticated;

-- Make two members connected (accepted), whatever was there before. The one
-- place both invite routes write a connection. Internal: no grants.
create or replace function public.connect_members(p_a uuid, p_b uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_a is null or p_b is null or p_a = p_b then
    return;
  end if;
  if public.is_blocked(p_a, p_b) then
    raise exception 'You can''t connect with this member' using errcode = '42501';
  end if;
  update public.connections
     set status = 'accepted', updated_at = now()
   where least(requester_id, recipient_id) = least(p_a, p_b)
     and greatest(requester_id, recipient_id) = greatest(p_a, p_b);
  if not found then
    insert into public.connections (requester_id, recipient_id, status)
    values (p_a, p_b, 'accepted')
    on conflict do nothing;
  end if;
end;
$$;

revoke all on function public.connect_members(uuid, uuid) from public, anon, authenticated;

create or replace function public.my_invite_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_code text;
begin
  if v_me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select code into v_code from public.member_invite_codes where member_id = v_me;
  while v_code is null loop
    v_code := substr(md5(gen_random_uuid()::text), 1, 8);
    begin
      insert into public.member_invite_codes (member_id, code) values (v_me, v_code);
    exception when unique_violation then
      -- Either the code collided, or a parallel call just created ours.
      select code into v_code from public.member_invite_codes where member_id = v_me;
    end;
  end loop;
  return v_code;
end;
$$;

revoke all on function public.my_invite_code() from public, anon;
grant execute on function public.my_invite_code() to authenticated;

-- What the invite page shows before anyone signs in: a first name and a
-- club, nothing more.
create or replace function public.invite_preview(p_code text)
returns table (first_name text, last_initial text, home_club text, avatar_url text, avatar_color text)
language sql
stable
security definer
set search_path = public
as $$
  select p.first_name,
         left(coalesce(p.last_name, ''), 1),
         p.home_club,
         p.avatar_url,
         p.avatar_color
    from public.member_invite_codes c
    join public.profiles p on p.id = c.member_id
   where c.code = lower(btrim(p_code))
     and p.deleted_at is null;
$$;

revoke all on function public.invite_preview(text) from public;
grant execute on function public.invite_preview(text) to anon, authenticated;

create or replace function public.connect_by_invite(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_owner uuid;
begin
  if v_me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select c.member_id into v_owner
    from public.member_invite_codes c
    join public.profiles p on p.id = c.member_id
   where c.code = lower(btrim(p_code)) and p.deleted_at is null;
  if v_owner is null then
    raise exception 'That invite link isn''t valid' using errcode = 'P0002';
  end if;
  perform public.connect_members(v_owner, v_me);
  return v_owner;
end;
$$;

revoke all on function public.connect_by_invite(text) from public, anon;
grant execute on function public.connect_by_invite(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. People you may know
-- ---------------------------------------------------------------------------

create table if not exists public.member_suggestion_dismissals (
  member_id uuid not null references public.profiles (id) on delete cascade,
  dismissed_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (member_id, dismissed_id)
);

alter table public.member_suggestion_dismissals enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'member_suggestion_dismissals' and policyname = 'Members read their own dismissals') then
    create policy "Members read their own dismissals" on public.member_suggestion_dismissals
      for select to authenticated using (member_id = (select auth.uid()));
  end if;
end $$;

revoke all on public.member_suggestion_dismissals from anon;
revoke insert, update, delete, truncate, references, trigger on public.member_suggestion_dismissals from authenticated;

create or replace function public.dismiss_member_suggestion(p_member uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.member_suggestion_dismissals (member_id, dismissed_id)
  select (select auth.uid()), p_member
   where (select auth.uid()) is not null and p_member is not null and p_member <> (select auth.uid())
  on conflict do nothing;
$$;

revoke all on function public.dismiss_member_suggestion(uuid) from public, anon;
grant execute on function public.dismiss_member_suggestion(uuid) to authenticated;

--   played together (a live-scored round)   +1500
--   same home club                          +1000
--   each mutual PinPal                      +200
--   home club within 25 km                  up to +250, nearer higher
--   each course both have played            +50
create or replace function public.member_suggestions(p_limit integer default 20)
returns table (
  id uuid,
  first_name text,
  last_name text,
  avatar_url text,
  avatar_color text,
  home_club text,
  handicap numeric,
  mutual_count integer,
  same_club boolean,
  played_together boolean,
  shared_courses integer,
  distance_km numeric,
  reason text,
  score numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select p.id, p.home_club_id, c.latitude as lat, c.longitude as lng
      from public.profiles p
      left join public.clubs c on c.id = p.home_club_id
     where p.id = (select auth.uid())
  ),
  my_conns as (
    select case when x.requester_id = me.id then x.recipient_id else x.requester_id end as other
      from public.connections x, me
     where x.status = 'accepted' and (x.requester_id = me.id or x.recipient_id = me.id)
  ),
  my_courses as (
    select distinct club_id from public.member_courses
     where member_id = (select auth.uid()) and kind = 'played'
  ),
  my_rounds as (
    select round_id from public.live_round_players where member_id = (select auth.uid())
  ),
  candidates as (
    select
      p.id, p.first_name, p.last_name, p.avatar_url, p.avatar_color, p.home_club,
      case when p.handicap_visible then p.handicap end as handicap,
      p.created_at,
      (me.home_club_id is not null and p.home_club_id = me.home_club_id) as same_club,
      (
        select count(*)::int
          from public.connections y
          join my_conns m on m.other = case when y.requester_id = p.id then y.recipient_id else y.requester_id end
         where y.status = 'accepted' and (y.requester_id = p.id or y.recipient_id = p.id)
      ) as mutual_count,
      exists (
        select 1 from public.live_round_players lp
         where lp.member_id = p.id and lp.round_id in (select round_id from my_rounds)
      ) as played_together,
      (
        select count(distinct mc.club_id)::int from public.member_courses mc
         where mc.member_id = p.id and mc.kind = 'played' and mc.club_id in (select club_id from my_courses)
      ) as shared_courses,
      case
        when me.lat is not null and c.latitude is not null then
          round((6371 * 2 * asin(sqrt(
            power(sin(radians(c.latitude - me.lat) / 2), 2)
            + cos(radians(me.lat)) * cos(radians(c.latitude))
              * power(sin(radians(c.longitude - me.lng) / 2), 2)
          )))::numeric, 1)
      end as distance_km
    from public.profiles p
    cross join me
    left join public.clubs c on c.id = p.home_club_id
    where p.id <> me.id
      and p.deleted_at is null
      and not public.is_blocked(me.id, p.id)
      and not exists (
        select 1 from public.connections x
         where least(x.requester_id, x.recipient_id) = least(me.id, p.id)
           and greatest(x.requester_id, x.recipient_id) = greatest(me.id, p.id)
      )
      and not exists (
        select 1 from public.member_suggestion_dismissals d
         where d.member_id = me.id and d.dismissed_id = p.id
      )
  )
  select
    id, first_name, last_name, avatar_url, avatar_color, home_club, handicap,
    mutual_count, same_club, played_together, shared_courses, distance_km,
    case
      when played_together then 'You''ve played together'
      when same_club and mutual_count > 0 then 'Your club · ' || mutual_count || ' mutual'
      when mutual_count > 1 then mutual_count || ' mutual PinPals'
      when mutual_count = 1 then '1 mutual PinPal'
      when same_club then 'At your club'
      when shared_courses > 1 then shared_courses || ' courses in common'
      when shared_courses = 1 then 'A course in common'
      else round(distance_km)::int || ' km away'
    end as reason,
    (case when played_together then 1500 else 0 end)
    + (case when same_club then 1000 else 0 end)
    + 200 * mutual_count
    + (case when not same_club and distance_km <= 25 then round(250 * (1 - distance_km / 25), 1) else 0 end)
    + 50 * shared_courses as score
  from candidates
  where played_together or same_club or mutual_count > 0 or shared_courses > 0 or distance_km <= 25
  order by score desc, created_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 60);
$$;

revoke all on function public.member_suggestions(integer) from public, anon;
grant execute on function public.member_suggestions(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Why you'd get on
-- ---------------------------------------------------------------------------

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
    'my_handicap', (select handicap from public.profiles where id = v_me),
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

-- ---------------------------------------------------------------------------
-- 4. You've played with
-- ---------------------------------------------------------------------------

-- The guest scorecard links (section 5) — played_with_me() reports whether
-- a guest has been sent one, so the table comes first.
create table if not exists public.round_guest_invites (
  token text primary key check (token ~ '^[a-z0-9]{24}$'),
  player_id bigint not null unique references public.live_round_players (id) on delete cascade,
  round_id bigint not null references public.live_rounds (id) on delete cascade,
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  claimed_by uuid references public.profiles (id) on delete set null,
  claimed_at timestamptz
);

alter table public.round_guest_invites enable row level security;
revoke all on public.round_guest_invites from anon, authenticated;

create or replace function public.played_with_me(p_days integer default 120)
returns table (
  player_id bigint,
  round_id bigint,
  played_on date,
  course_name text,
  member_id uuid,
  display_name text,
  avatar_url text,
  avatar_color text,
  connection_status text,
  invited boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    select lp.round_id
      from public.live_round_players lp
      join public.live_rounds r on r.id = lp.round_id
     where lp.member_id = (select auth.uid())
       and r.played_on >= current_date - least(greatest(coalesce(p_days, 120), 1), 365)
  ),
  others as (
    select distinct on (coalesce(o.member_id::text, 'p' || o.id))
           o.id as player_id, o.round_id, r.played_on, r.course_name, o.member_id, o.display_name
      from public.live_round_players o
      join public.live_rounds r on r.id = o.round_id
     where o.round_id in (select round_id from mine)
       and (o.member_id is null or o.member_id <> (select auth.uid()))
     order by coalesce(o.member_id::text, 'p' || o.id), r.played_on desc, o.id desc
  )
  select o.player_id, o.round_id, o.played_on, o.course_name, o.member_id,
         coalesce(nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), o.display_name),
         p.avatar_url, p.avatar_color,
         (select x.status from public.connections x
           where o.member_id is not null
             and least(x.requester_id, x.recipient_id) = least(o.member_id, (select auth.uid()))
             and greatest(x.requester_id, x.recipient_id) = greatest(o.member_id, (select auth.uid()))),
         exists (select 1 from public.round_guest_invites g where g.player_id = o.player_id)
    from others o
    left join public.profiles p on p.id = o.member_id and p.deleted_at is null
   where o.member_id is null or (p.id is not null and not public.is_blocked(o.member_id, (select auth.uid())))
   order by o.played_on desc, o.player_id desc
   limit 30;
$$;

-- ---------------------------------------------------------------------------
-- 5. Guest scorecards
-- ---------------------------------------------------------------------------

-- Grants for played_with_me() (defined above, beside the table it reads).
revoke all on function public.played_with_me(integer) from public, anon;
grant execute on function public.played_with_me(integer) to authenticated;

create or replace function public.round_guest_invite(p_player_id bigint)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_player public.live_round_players;
  v_token text;
begin
  select * into v_player from public.live_round_players where id = p_player_id;
  if not found or v_me is null or not exists (
    select 1 from public.live_round_players where round_id = v_player.round_id and member_id = v_me
  ) then
    raise exception 'Only someone in that round can invite its guests' using errcode = '42501';
  end if;
  if v_player.member_id is not null then
    raise exception 'That player is already on PinPals' using errcode = 'P0001';
  end if;
  select token into v_token from public.round_guest_invites where player_id = p_player_id;
  if v_token is null then
    v_token := substr(md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text), 1, 24);
    insert into public.round_guest_invites (token, player_id, round_id, invited_by)
    values (v_token, p_player_id, v_player.round_id, v_me)
    on conflict (player_id) do nothing;
    select token into v_token from public.round_guest_invites where player_id = p_player_id;
  end if;
  return v_token;
end;
$$;

revoke all on function public.round_guest_invite(bigint) from public, anon;
grant execute on function public.round_guest_invite(bigint) to authenticated;

create or replace function public.claim_round_guest(p_token text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_invite public.round_guest_invites;
begin
  if v_me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into v_invite from public.round_guest_invites where token = lower(btrim(p_token)) for update;
  if not found then
    raise exception 'That scorecard link isn''t valid' using errcode = 'P0002';
  end if;
  if v_invite.claimed_by is not null then
    if v_invite.claimed_by = v_me then
      return v_invite.round_id;
    end if;
    raise exception 'This scorecard has already been claimed' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.live_round_players where round_id = v_invite.round_id and member_id = v_me) then
    raise exception 'You''re already in this round' using errcode = 'P0001';
  end if;

  update public.live_round_players set member_id = v_me
   where id = v_invite.player_id and member_id is null;
  update public.round_guest_invites set claimed_by = v_me, claimed_at = now()
   where token = v_invite.token;
  if v_invite.invited_by is not null and not public.is_blocked(v_invite.invited_by, v_me) then
    perform public.connect_members(v_invite.invited_by, v_me);
  end if;
  return v_invite.round_id;
end;
$$;

revoke all on function public.claim_round_guest(text) from public, anon;
grant execute on function public.claim_round_guest(text) to authenticated;
