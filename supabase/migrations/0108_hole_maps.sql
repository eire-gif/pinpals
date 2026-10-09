-- Hole maps: GPS yardages and shot positions (Oct 2026).
--
-- Two halves, deliberately independent:
--
--   COURSE GEOMETRY — where each hole's tees, green (front / centre / back)
--   and hazards are. The same for every member, written only by the provider
--   import (Edge Function import-golfapi, service role) or by staff.
--
--   Read ONE CLUB AT A TIME, through course_layout_get(), never as a table.
--   golfapi.io's terms (Oct 2026, "Protection of Data") require reasonable
--   measures against copying or scraping their data out of PinPals; an open
--   select policy would let any signed-in member download every hole of
--   every course in one REST call. The tables therefore have RLS on and no
--   policies at all. Empty for every course until it is populated; the screens
--   draw a "map coming soon" state for a hole with no points, and still give
--   live distances to anything the member taps on the satellite view.
--
--     course_layouts        one per course at a club (most clubs have one;
--                           Portmarnock, Carton House and the like have two).
--     course_layout_points  the points, per hole, by kind.
--
--   SHOTS — where a member hit each shot from in a live round. Private to the
--   round, exactly like its scores: read by whoever can see the round
--   (can_view_live_round, 0103), written only through the functions below by
--   whoever can score it (can_score_live_round, 0104). The distance of each
--   shot is NOT stored — it is worked out on the phone from consecutive
--   points (mobile/src/lib/hole-geo.ts), so a moved point never leaves a
--   stale yardage behind.
--
-- PRIVACY. A shot is a GPS fix of a member at a known time. It is kept only
-- with the round and goes with it; when an account is deleted its shots are
-- deleted (the player row survives, renamed, for the others' totals — 0103 —
-- but its positions do not).
--
-- Rollback:
--   drop function if exists public.course_layout_get(bigint);
--   drop function if exists public.live_round_shot_add(bigint, bigint, smallint, double precision, double precision, numeric);
--   drop function if exists public.live_round_shot_undo(bigint, bigint, smallint);
--   drop trigger if exists live_round_players_forget_shots on public.live_round_players;
--   drop function if exists public.live_round_player_forget_shots();
--   drop table if exists public.live_round_shots, public.course_layout_points, public.course_layouts cascade;

-- ---------------------------------------------------------------------------
-- Course geometry
-- ---------------------------------------------------------------------------

create table public.course_layouts (
  id bigint generated always as identity primary key,
  club_id bigint not null references public.clubs (id) on delete cascade,
  name text not null default 'Main course' check (char_length(btrim(name)) between 1 and 80),
  holes smallint not null default 18 check (holes in (9, 18)),
  -- 'provider' — imported (golfapi.io); 'admin' — placed by staff.
  source text not null check (source in ('provider', 'admin')),
  provider text check (provider is null or provider in ('golfapi')),
  provider_course_id text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((provider is null) = (provider_course_id is null))
);

create unique index course_layouts_one_name_idx on public.course_layouts (club_id, lower(btrim(name)));
-- Not partial: the importer upserts on these two columns, and ON CONFLICT
-- can't name a partial index through PostgREST. NULLs never collide, so
-- staff-placed layouts (no provider) are unaffected.
create unique index course_layouts_provider_idx on public.course_layouts (provider, provider_course_id);

create table public.course_layout_points (
  id bigint generated always as identity primary key,
  layout_id bigint not null references public.course_layouts (id) on delete cascade,
  hole smallint not null check (hole between 1 and 18),
  kind text not null check (kind in (
    'tee_front', 'tee_back',
    'green_front', 'green_centre', 'green_back',
    'green_bunker', 'fairway_bunker', 'water', 'trees',
    'marker_100', 'marker_150', 'marker_200',
    'dogleg', 'other'
  )),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  label text check (label is null or char_length(label) <= 60)
);

create index course_layout_points_hole_idx on public.course_layout_points (layout_id, hole);

comment on table public.course_layouts is 'Hole maps: a course at a club whose hole geometry is on file. Written only by the provider import (service role) or staff; read only one club at a time via course_layout_get().';
comment on table public.course_layout_points is 'Hole maps: tee, green front/centre/back and hazard positions per hole. Public course information.';

alter table public.course_layouts enable row level security;
alter table public.course_layout_points enable row level security;

-- No policies: nobody but the service role (and the function below) reads
-- or writes these tables. Grants go too, so a policy added by mistake later
-- is still not enough on its own.
revoke all on public.course_layouts, public.course_layout_points from anon, authenticated;

-- One club's layouts and points, for a signed-in member. Small (an 18-hole
-- course is ~100 points), so one call draws every hole of the hole map.
create or replace function public.course_layout_get(p_club_id bigint)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null or not exists (select 1 from public.profiles where id = v_me and deleted_at is null) then
    raise exception 'Sign in to see hole maps' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', l.id,
             'name', l.name,
             'holes', l.holes,
             'source', l.source,
             'verified', l.verified_at is not null,
             'points', coalesce((
               select jsonb_agg(jsonb_build_object('hole', p.hole, 'kind', p.kind, 'lat', p.lat, 'lng', p.lng, 'label', p.label)
                                order by p.hole, p.kind, p.id)
                 from public.course_layout_points p where p.layout_id = l.id
             ), '[]'::jsonb)
           ) order by l.name)
      from public.course_layouts l
     where l.club_id = p_club_id
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.course_layout_get(bigint) from public, anon, authenticated;
grant execute on function public.course_layout_get(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Shots in a live round
-- ---------------------------------------------------------------------------

create table public.live_round_shots (
  id bigint generated always as identity primary key,
  round_id bigint not null references public.live_rounds (id) on delete cascade,
  player_id bigint not null references public.live_round_players (id) on delete cascade,
  hole smallint not null check (hole between 1 and 18),
  shot_no smallint not null check (shot_no between 1 and 20),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  -- The phone's own estimate of the fix's error, in metres. Kept so the
  -- screen can say "±25 m" rather than present a poor fix as exact.
  accuracy_m numeric(6, 1) check (accuracy_m is null or accuracy_m between 0 and 5000),
  recorded_by uuid references public.profiles (id) on delete set null,
  recorded_at timestamptz not null default now(),
  unique (player_id, hole, shot_no)
);

create index live_round_shots_round_idx on public.live_round_shots (round_id, hole);

comment on table public.live_round_shots is 'Hole maps: where each shot in a live round was played from. Private to the round; written only via live_round_shot_add / live_round_shot_undo.';

alter table public.live_round_shots enable row level security;

create policy "Players read their live round's shots" on public.live_round_shots
  for select to authenticated using (public.can_view_live_round(round_id));

revoke insert, update, delete on public.live_round_shots from anon, authenticated;
revoke all on public.live_round_shots from anon;
revoke truncate, references, trigger on public.live_round_shots from authenticated;

-- The same "go re-fetch" ping as scores (0103), so a shot marked on one
-- phone appears on the others' maps.
create trigger live_round_shots_broadcast
  after insert or update or delete on public.live_round_shots
  for each row execute function public.live_round_broadcast();

-- A deleted member's positions go; their player row stays (0103).
create or replace function public.live_round_player_forget_shots()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.member_id is not null and new.member_id is null then
    delete from public.live_round_shots where player_id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.live_round_player_forget_shots() from public, anon, authenticated;

create trigger live_round_players_forget_shots
  after update of member_id on public.live_round_players
  for each row execute function public.live_round_player_forget_shots();

-- Mark the next shot for a player on a hole, at the phone's current fix.
create or replace function public.live_round_shot_add(
  p_round_id bigint,
  p_player_id bigint,
  p_hole smallint,
  p_lat double precision,
  p_lng double precision,
  p_accuracy_m numeric default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next smallint;
  v_id bigint;
begin
  if not public.can_score_live_round(p_round_id) then
    raise exception 'Not your round' using errcode = '42501';
  end if;
  if not exists (select 1 from public.live_rounds where id = p_round_id and status = 'live') then
    raise exception 'This round has finished' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.live_round_players where id = p_player_id and round_id = p_round_id) then
    raise exception 'That player is not in this round' using errcode = '22023';
  end if;
  if not exists (select 1 from public.live_round_holes where round_id = p_round_id and hole = p_hole) then
    raise exception 'No such hole in this round' using errcode = '22023';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'That position is not on the map' using errcode = '22023';
  end if;

  -- Serialise the numbering for this player and hole: two phones marking
  -- the same player's shot at once must not both take shot 3.
  perform 1 from public.live_round_players where id = p_player_id for update;

  select coalesce(max(shot_no), 0) + 1 into v_next
    from public.live_round_shots where player_id = p_player_id and hole = p_hole;
  if v_next > 20 then
    raise exception 'That is enough shots for one hole' using errcode = 'P0001';
  end if;

  insert into public.live_round_shots (round_id, player_id, hole, shot_no, lat, lng, accuracy_m, recorded_by)
  values (p_round_id, p_player_id, p_hole, v_next, p_lat, p_lng,
          case when p_accuracy_m is null then null else least(greatest(p_accuracy_m, 0), 5000) end,
          (select auth.uid()))
  returning id into v_id;

  return v_id;
end;
$$;

-- Take back a player's last shot on a hole. Only the last: there is no
-- renumbering, so shot 2 always comes after shot 1.
create or replace function public.live_round_shot_undo(
  p_round_id bigint,
  p_player_id bigint,
  p_hole smallint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_score_live_round(p_round_id) then
    raise exception 'Not your round' using errcode = '42501';
  end if;
  if not exists (select 1 from public.live_rounds where id = p_round_id and status = 'live') then
    raise exception 'This round has finished' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.live_round_players where id = p_player_id and round_id = p_round_id) then
    raise exception 'That player is not in this round' using errcode = '22023';
  end if;

  delete from public.live_round_shots
   where player_id = p_player_id and hole = p_hole
     and shot_no = (select max(shot_no) from public.live_round_shots where player_id = p_player_id and hole = p_hole);
end;
$$;

revoke all on function public.live_round_shot_add(bigint, bigint, smallint, double precision, double precision, numeric) from public, anon, authenticated;
grant execute on function public.live_round_shot_add(bigint, bigint, smallint, double precision, double precision, numeric) to authenticated;
revoke all on function public.live_round_shot_undo(bigint, bigint, smallint) from public, anon, authenticated;
grant execute on function public.live_round_shot_undo(bigint, bigint, smallint) to authenticated;
