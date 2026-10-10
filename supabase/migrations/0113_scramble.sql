-- 0113 — Scramble (Oct 2026)
--
-- A scramble team plays one ball: every player hits, the best shot is
-- chosen, everyone plays from there. So a team is scored like one player.
--
-- Decisions (Eire, 10 Oct 2026):
--   * 2-person and 4-person teams.
--   * Several teams on one live leaderboard (a society day), or one team on
--     its own.
--   * Official WHS allowances, net and gross both shown:
--       4-person: 25% / 20% / 15% / 10% of course handicaps, lowest first
--       2-person: 35% of the lower + 15% of the higher
--     summed, then rounded. The app works the team handicap out and sends
--     it; it is stored on the round (team_handicap).
--   * An optional minimum number of drives per player, with whose drive was
--     used recorded hole by hole.
--
-- Shape:
--   * A scramble team is a live_round with format 'stroke' and scramble_size
--     set (2 or 4). It is net stroke play for one "player" — the team — so
--     the existing format value fits, and the format check needs no change.
--     The team's score lives on its first player (position 1), as a one-ball
--     pair's does in foursomes (0104).
--   * Several teams: a live_match_days row with kind 'scramble', one round
--     per team, numbered by team_number. Everyone in the day sees every team
--     (can_view_match_day, 0104) — that's the leaderboard.
--   * live_round_drives: one row per team per hole, the position of the
--     player whose drive was used.
--
-- Writes stay in SECURITY DEFINER functions; no write grants on the tables.
-- EXECUTE revoked from public and anon by name (the 0076 rule).
--
-- Rollback:
--   drop function if exists public.live_scramble_day_create(jsonb, jsonb, jsonb);
--   drop function if exists public.live_round_set_drive(bigint, smallint, smallint);
--   drop table if exists public.live_round_drives;
--   alter table public.live_match_days drop column if exists kind;
--   alter table public.live_rounds drop constraint if exists live_rounds_scramble_is_stroke,
--     drop column if exists scramble_size, drop column if exists team_name,
--     drop column if exists team_number, drop column if exists team_handicap,
--     drop column if exists drive_minimum;
--   then re-run live_round_create from 0103.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.live_rounds
  add column if not exists scramble_size smallint check (scramble_size is null or scramble_size in (2, 4)),
  add column if not exists team_name text check (team_name is null or char_length(btrim(team_name)) between 1 and 30),
  add column if not exists team_number smallint check (team_number is null or team_number between 1 and 60),
  add column if not exists team_handicap smallint check (team_handicap is null or team_handicap between -20 and 80),
  add column if not exists drive_minimum smallint check (drive_minimum is null or drive_minimum between 1 and 9);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'live_rounds_scramble_is_stroke') then
    alter table public.live_rounds
      add constraint live_rounds_scramble_is_stroke
      check (scramble_size is null or (format = 'stroke' and team_handicap is not null));
  end if;
end $$;

comment on column public.live_rounds.scramble_size is 'Scramble team size (2 or 4). Set: this round is one scramble team, scored as one ball on its first player; format is stroke.';
comment on column public.live_rounds.team_handicap is 'Scramble: the team''s playing handicap (WHS allowances, summed then rounded), worked out by the app.';
comment on column public.live_rounds.drive_minimum is 'Scramble: drives each player must contribute, if the organiser set a minimum.';

alter table public.live_match_days
  add column if not exists kind text not null default 'match' check (kind in ('match', 'scramble'));

comment on column public.live_match_days.kind is 'match: matches between two sides (0104). scramble: one round per scramble team, one leaderboard.';

-- ---------------------------------------------------------------------------
-- Drives
-- ---------------------------------------------------------------------------

create table if not exists public.live_round_drives (
  round_id bigint not null references public.live_rounds (id) on delete cascade,
  hole smallint not null check (hole between 1 and 18),
  position smallint not null check (position between 1 and 8),
  entered_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (round_id, hole)
);

comment on table public.live_round_drives is 'Scramble: whose drive the team used on each hole (live_round_players.position). Written only via live_round_set_drive().';

alter table public.live_round_drives enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'live_round_drives' and policyname = 'Players read their live round''s drives') then
    create policy "Players read their live round's drives" on public.live_round_drives
      for select to authenticated using (public.can_view_live_round(round_id));
  end if;
end $$;

revoke insert, update, delete, truncate, references, trigger on public.live_round_drives from authenticated;
revoke all on public.live_round_drives from anon;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'live_round_drives_broadcast') then
    create trigger live_round_drives_broadcast
      after insert or update or delete on public.live_round_drives
      for each row execute function public.live_round_broadcast();
  end if;
end $$;

-- p_position null clears the hole.
create or replace function public.live_round_set_drive(p_round_id bigint, p_hole smallint, p_position smallint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_score_live_round(p_round_id) then
    raise exception 'Not your round' using errcode = '42501';
  end if;
  if not exists (select 1 from public.live_rounds where id = p_round_id and status = 'live' and scramble_size is not null) then
    raise exception 'Drives are only kept for a scramble in play' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.live_round_holes where round_id = p_round_id and hole = p_hole) then
    raise exception 'No such hole in this round' using errcode = '22023';
  end if;

  if p_position is null then
    delete from public.live_round_drives where round_id = p_round_id and hole = p_hole;
    return;
  end if;
  if not exists (select 1 from public.live_round_players where round_id = p_round_id and position = p_position) then
    raise exception 'That player is not in this team' using errcode = '22023';
  end if;

  insert into public.live_round_drives (round_id, hole, position, entered_by)
  values (p_round_id, p_hole, p_position, (select auth.uid()))
  on conflict (round_id, hole) do update
    set position = excluded.position, entered_by = excluded.entered_by, updated_at = now();
end;
$$;

revoke all on function public.live_round_set_drive(bigint, smallint, smallint) from public;
revoke execute on function public.live_round_set_drive(bigint, smallint, smallint) from anon;
grant execute on function public.live_round_set_drive(bigint, smallint, smallint) to authenticated;

-- ---------------------------------------------------------------------------
-- Starting one scramble team: live_round_create, extended
-- ---------------------------------------------------------------------------
--
-- As 0103, plus p_round.format 'scramble' with:
--   scramble_size 2|4, team_name?, team_handicap, drive_minimum?
-- Stored as format 'stroke' with the scramble columns; every player side 1.
create or replace function public.live_round_create(p_round jsonb, p_players jsonb, p_card jsonb)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_round_id bigint;
  v_holes smallint := coalesce((p_round ->> 'holes')::smallint, 18);
  v_format text := p_round ->> 'format';
  v_scramble smallint;
  v_player jsonb;
  v_member uuid;
  v_pos smallint := 0;
begin
  if v_me is null or not exists (select 1 from public.profiles where id = v_me and deleted_at is null) then
    raise exception 'Sign in to start a round' using errcode = '42501';
  end if;

  if (select count(*) from public.live_rounds where created_by = v_me and status = 'live') >= 5 then
    raise exception 'You already have 5 rounds in play. Finish one first.' using errcode = 'P0001';
  end if;

  if v_format = 'scramble' then
    v_scramble := nullif(p_round ->> 'scramble_size', '')::smallint;
    if v_scramble is null or v_scramble not in (2, 4) then
      raise exception 'A scramble team is 2 or 4 players' using errcode = '22023';
    end if;
    if jsonb_typeof(p_players) <> 'array' or jsonb_array_length(p_players) <> v_scramble then
      raise exception 'A % person scramble needs % players', v_scramble, v_scramble using errcode = '22023';
    end if;
    if nullif(p_round ->> 'team_handicap', '') is null then
      raise exception 'A scramble needs its team handicap' using errcode = '22023';
    end if;
  elsif v_format not in ('stableford', 'stroke', 'matchplay') then
    raise exception 'Unknown format' using errcode = '22023';
  end if;

  if jsonb_typeof(p_players) <> 'array' or jsonb_array_length(p_players) not between 1 and 8 then
    raise exception 'A round needs between 1 and 8 players' using errcode = '22023';
  end if;
  if v_format = 'matchplay' and jsonb_array_length(p_players) <> 2 then
    raise exception 'Singles matchplay is two players' using errcode = '22023';
  end if;
  if jsonb_typeof(p_card) <> 'array' or jsonb_array_length(p_card) <> v_holes
     or (select count(distinct (h ->> 'hole')::int) from jsonb_array_elements(p_card) h
          where (h ->> 'hole')::int between 1 and v_holes) <> v_holes then
    raise exception 'The card must have one entry for each hole' using errcode = '22023';
  end if;

  for v_player in select * from jsonb_array_elements(p_players) loop
    v_member := nullif(v_player ->> 'member_id', '')::uuid;
    if v_member is not null and v_member <> v_me then
      if not exists (select 1 from public.profiles where id = v_member and deleted_at is null)
         or public.is_blocked(v_me, v_member)
         or not exists (
           select 1 from public.connections c
            where c.status = 'accepted'
              and least(c.requester_id, c.recipient_id) = least(v_me, v_member)
              and greatest(c.requester_id, c.recipient_id) = greatest(v_me, v_member)
         ) then
        raise exception 'You can add yourself, your PinPals, or guests by name' using errcode = '42501';
      end if;
    end if;
  end loop;

  insert into public.live_rounds (created_by, club_id, course_name, tee_name, format, holes,
                                  course_rating, slope, par_total, allowance,
                                  scramble_size, team_name, team_handicap, drive_minimum)
  values (
    v_me,
    nullif(p_round ->> 'club_id', '')::bigint,
    btrim(p_round ->> 'course_name'),
    nullif(btrim(coalesce(p_round ->> 'tee_name', '')), ''),
    case when v_format = 'scramble' then 'stroke' else v_format end,
    v_holes,
    nullif(p_round ->> 'course_rating', '')::numeric,
    nullif(p_round ->> 'slope', '')::smallint,
    nullif(p_round ->> 'par_total', '')::smallint,
    (p_round ->> 'allowance')::numeric,
    v_scramble,
    case when v_scramble is null then null else nullif(btrim(coalesce(p_round ->> 'team_name', '')), '') end,
    case when v_scramble is null then null else (p_round ->> 'team_handicap')::smallint end,
    case when v_scramble is null then null else nullif(p_round ->> 'drive_minimum', '')::smallint end
  )
  returning id into v_round_id;

  for v_player in select * from jsonb_array_elements(p_players) loop
    v_pos := v_pos + 1;
    insert into public.live_round_players (round_id, member_id, display_name, handicap_index,
                                           course_handicap, playing_handicap, handicap_estimated,
                                           position, side)
    values (
      v_round_id,
      nullif(v_player ->> 'member_id', '')::uuid,
      btrim(v_player ->> 'name'),
      (v_player ->> 'handicap_index')::numeric,
      (v_player ->> 'course_handicap')::smallint,
      (v_player ->> 'playing_handicap')::smallint,
      coalesce((v_player ->> 'handicap_estimated')::boolean, false),
      v_pos,
      case
        when v_format = 'matchplay' then v_pos
        when v_scramble is not null then 1
        else nullif(v_player ->> 'side', '')::smallint
      end
    );
  end loop;

  insert into public.live_round_holes (round_id, hole, par, stroke_index)
  select v_round_id, (h ->> 'hole')::smallint, (h ->> 'par')::smallint, nullif(h ->> 'stroke_index', '')::smallint
    from jsonb_array_elements(p_card) h;

  return v_round_id;
end;
$$;

revoke all on function public.live_round_create(jsonb, jsonb, jsonb) from public;
revoke execute on function public.live_round_create(jsonb, jsonb, jsonb) from anon;
grant execute on function public.live_round_create(jsonb, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Starting a scramble day: several teams, one leaderboard
-- ---------------------------------------------------------------------------
--
-- p_day:   {title, course_name, club_id?, tee_name?, holes, course_rating?,
--           slope?, par_total?, scramble_size: 2|4, drive_minimum?}
-- p_teams: [{name?, tee_time?, team_handicap, players: [{member_id?, name,
--           handicap_index, course_handicap, playing_handicap,
--           handicap_estimated}]}]   in team order
-- p_card:  [{hole, par, stroke_index?}] one per hole, copied to every team
create or replace function public.live_scramble_day_create(p_day jsonb, p_teams jsonb, p_card jsonb)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_holes smallint := coalesce((p_day ->> 'holes')::smallint, 18);
  v_size smallint := nullif(p_day ->> 'scramble_size', '')::smallint;
  v_drives smallint := nullif(p_day ->> 'drive_minimum', '')::smallint;
  v_day_id bigint;
  v_round_id bigint;
  v_team jsonb;
  v_player jsonb;
  v_member uuid;
  v_n smallint := 0;
  v_pos smallint;
  v_seen uuid[] := '{}';
begin
  if v_me is null or not exists (select 1 from public.profiles where id = v_me and deleted_at is null) then
    raise exception 'Sign in to start a scramble' using errcode = '42501';
  end if;
  if (select count(*) from public.live_match_days where created_by = v_me and created_at > now() - interval '1 day') >= 10 then
    raise exception 'That''s a lot of days for one day. Try again tomorrow.' using errcode = 'P0001';
  end if;
  if v_size is null or v_size not in (2, 4) then
    raise exception 'A scramble team is 2 or 4 players' using errcode = '22023';
  end if;
  if jsonb_typeof(p_teams) <> 'array' or jsonb_array_length(p_teams) not between 1 and 60 then
    raise exception 'A scramble has between 1 and 60 teams' using errcode = '22023';
  end if;
  if jsonb_typeof(p_card) <> 'array' or jsonb_array_length(p_card) <> v_holes
     or (select count(distinct (h ->> 'hole')::int) from jsonb_array_elements(p_card) h
          where (h ->> 'hole')::int between 1 and v_holes) <> v_holes then
    raise exception 'The card must have one entry for each hole' using errcode = '22023';
  end if;

  -- Every team first, before anything is written.
  for v_team in select * from jsonb_array_elements(p_teams) loop
    if jsonb_typeof(v_team -> 'players') <> 'array' or jsonb_array_length(v_team -> 'players') <> v_size then
      raise exception 'Every team needs % players', v_size using errcode = '22023';
    end if;
    if nullif(v_team ->> 'team_handicap', '') is null then
      raise exception 'Every team needs its team handicap' using errcode = '22023';
    end if;
    for v_player in select * from jsonb_array_elements(v_team -> 'players') loop
      v_member := nullif(v_player ->> 'member_id', '')::uuid;
      if v_member is null then
        continue;
      end if;
      if v_member = any (v_seen) then
        raise exception 'Someone is in two teams. Each player plays in one team.' using errcode = '22023';
      end if;
      v_seen := v_seen || v_member;
      if v_member <> v_me and (
           not exists (select 1 from public.profiles where id = v_member and deleted_at is null)
           or public.is_blocked(v_me, v_member)
           or not exists (
             select 1 from public.connections c
              where c.status = 'accepted'
                and least(c.requester_id, c.recipient_id) = least(v_me, v_member)
                and greatest(c.requester_id, c.recipient_id) = greatest(v_me, v_member)
           )) then
        raise exception 'You can add yourself, your PinPals, or guests by name' using errcode = '42501';
      end if;
    end loop;
  end loop;

  insert into public.live_match_days (created_by, title, club_id, course_name, tee_name, holes,
                                      course_rating, slope, par_total, kind)
  values (
    v_me,
    btrim(p_day ->> 'title'),
    nullif(p_day ->> 'club_id', '')::bigint,
    btrim(p_day ->> 'course_name'),
    nullif(btrim(coalesce(p_day ->> 'tee_name', '')), ''),
    v_holes,
    nullif(p_day ->> 'course_rating', '')::numeric,
    nullif(p_day ->> 'slope', '')::smallint,
    nullif(p_day ->> 'par_total', '')::smallint,
    'scramble'
  )
  returning id into v_day_id;

  for v_team in select * from jsonb_array_elements(p_teams) loop
    v_n := v_n + 1;
    insert into public.live_rounds (created_by, club_id, course_name, tee_name, format, holes, course_rating,
                                    slope, par_total, allowance, match_day_id, tee_time,
                                    scramble_size, team_name, team_number, team_handicap, drive_minimum)
    select v_me, d.club_id, d.course_name, d.tee_name, 'stroke', d.holes, d.course_rating, d.slope, d.par_total,
           case when v_size = 4 then 0.25 else 0.35 end,
           v_day_id, nullif(v_team ->> 'tee_time', '')::time,
           v_size,
           coalesce(nullif(btrim(coalesce(v_team ->> 'name', '')), ''), 'Team ' || v_n),
           v_n,
           (v_team ->> 'team_handicap')::smallint,
           v_drives
      from public.live_match_days d where d.id = v_day_id
    returning id into v_round_id;

    v_pos := 0;
    for v_player in select * from jsonb_array_elements(v_team -> 'players') loop
      v_pos := v_pos + 1;
      insert into public.live_round_players (round_id, member_id, display_name, handicap_index, course_handicap,
                                             playing_handicap, handicap_estimated, position, side)
      values (
        v_round_id,
        nullif(v_player ->> 'member_id', '')::uuid,
        btrim(v_player ->> 'name'),
        (v_player ->> 'handicap_index')::numeric,
        (v_player ->> 'course_handicap')::smallint,
        (v_player ->> 'playing_handicap')::smallint,
        coalesce((v_player ->> 'handicap_estimated')::boolean, false),
        v_pos,
        1
      );
    end loop;

    insert into public.live_round_holes (round_id, hole, par, stroke_index)
    select v_round_id, (h ->> 'hole')::smallint, (h ->> 'par')::smallint, nullif(h ->> 'stroke_index', '')::smallint
      from jsonb_array_elements(p_card) h;
  end loop;

  return v_day_id;
end;
$$;

revoke all on function public.live_scramble_day_create(jsonb, jsonb, jsonb) from public;
revoke execute on function public.live_scramble_day_create(jsonb, jsonb, jsonb) from anon;
grant execute on function public.live_scramble_day_create(jsonb, jsonb, jsonb) to authenticated;
