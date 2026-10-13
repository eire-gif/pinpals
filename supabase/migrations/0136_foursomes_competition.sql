-- 0136 — Foursomes (Scotch foursomes) as a competition (Oct 2026)
--
-- Foursomes — "Scotch foursomes" — is two players sharing one ball, taking
-- alternate shots, one partner teeing off on the odd holes and the other on
-- the even holes. Until now it could only be played as a MATCH (pair v pair,
-- 0104). Eire, 13 Oct 2026: make it available as societies and clubs
-- usually run it too — pairs on one leaderboard, scored by Stableford or
-- net stroke play.
--
-- Handicap (WHS): the pair plays off 50% of its combined course handicaps,
-- rounded once (the match version already does this: matchCompetitors in
-- live-scoring.ts). The app works it out and sends it as team_handicap.
--
-- Shape: a foursomes pair is scored exactly like a 2-person scramble team —
-- one ball, the pair's score on its first player, one round per pair, a day
-- of pairs is a live_match_days row with kind 'scramble' — so it reuses
-- those columns (scramble_size = 2, team_name, team_number, team_handicap)
-- and everything built on them (who sees it, who scores it, realtime,
-- delete, calendar, highlights). One new column says it's foursomes and how
-- it's ranked:
--
--   live_rounds.foursomes_scoring      'stableford' | 'stroke' | null
--   live_match_days.foursomes_scoring  the same, for a day of pairs
--
-- format stays 'stroke' on the round, as for every team round (the 0113
-- check live_rounds_scramble_is_stroke requires it, and changing that check
-- would mean a drop); the app and website rank by foursomes_scoring.
-- No drives are kept for foursomes: who tees off is the odd/even rule.
--
-- No drop statements: safe to apply with the Supabase tool.
--
-- Rollback:
--   recreate live_round_create and live_scramble_day_create from 0121, then
--   alter table public.live_rounds drop constraint if exists live_rounds_foursomes_is_a_pair,
--     drop column if exists foursomes_scoring;
--   alter table public.live_match_days drop column if exists foursomes_scoring;

alter table public.live_rounds
  add column if not exists foursomes_scoring text
    check (foursomes_scoring is null or foursomes_scoring in ('stableford', 'stroke'));

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'live_rounds_foursomes_is_a_pair') then
    alter table public.live_rounds
      add constraint live_rounds_foursomes_is_a_pair
      check (foursomes_scoring is null or (coalesce(scramble_size, 0) = 2 and drive_minimum is null));
  end if;
end $$;

comment on column public.live_rounds.foursomes_scoring is
  'Foursomes (Scotch foursomes) pair, 0136: stableford or stroke. Set: this round is one pair (scramble_size 2), one ball on its first player, playing off team_handicap (50% of combined course handicaps).';

alter table public.live_match_days
  add column if not exists foursomes_scoring text
    check (foursomes_scoring is null or foursomes_scoring in ('stableford', 'stroke'));

comment on column public.live_match_days.foursomes_scoring is
  'Set on a kind = scramble day whose teams are foursomes pairs (0136): how the pairs are ranked.';

-- ============ Starting one round: live_round_create ============
--
-- As 0121, plus p_round.format 'foursomes' with scoring 'stableford'|'stroke',
-- two players and team_handicap. Stored as a 2-person team round.

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
  v_foursomes text;
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
  elsif v_format = 'foursomes' then
    -- 0136: one pair, one ball, alternate shot — Stableford or stroke play.
    v_foursomes := p_round ->> 'scoring';
    if v_foursomes is null or v_foursomes not in ('stableford', 'stroke') then
      raise exception 'Foursomes is scored by Stableford or stroke play' using errcode = '22023';
    end if;
    if jsonb_typeof(p_players) <> 'array' or jsonb_array_length(p_players) <> 2 then
      raise exception 'A foursomes pair is two players' using errcode = '22023';
    end if;
    if nullif(p_round ->> 'team_handicap', '') is null then
      raise exception 'A foursomes pair needs its handicap' using errcode = '22023';
    end if;
    v_scramble := 2;
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
      if not public.live_can_add_player(v_me, v_member) then
        raise exception 'You can add yourself, your PinPals, people in your group, or guests by name' using errcode = '42501';
      end if;
    end if;
  end loop;

  insert into public.live_rounds (created_by, club_id, course_name, tee_name, format, holes,
                                  course_rating, slope, par_total, allowance,
                                  scramble_size, team_name, team_handicap, drive_minimum, foursomes_scoring)
  values (
    v_me,
    nullif(p_round ->> 'club_id', '')::bigint,
    btrim(p_round ->> 'course_name'),
    nullif(btrim(coalesce(p_round ->> 'tee_name', '')), ''),
    case when v_format in ('scramble', 'foursomes') then 'stroke' else v_format end,
    v_holes,
    nullif(p_round ->> 'course_rating', '')::numeric,
    nullif(p_round ->> 'slope', '')::smallint,
    nullif(p_round ->> 'par_total', '')::smallint,
    (p_round ->> 'allowance')::numeric,
    v_scramble,
    case when v_scramble is null then null else nullif(btrim(coalesce(p_round ->> 'team_name', '')), '') end,
    case when v_scramble is null then null else (p_round ->> 'team_handicap')::smallint end,
    case when v_scramble is null or v_foursomes is not null then null else nullif(p_round ->> 'drive_minimum', '')::smallint end,
    v_foursomes
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


-- ============ A day of pairs: live_scramble_day_create ============
--
-- As 0121, plus p_day.foursomes_scoring: every team is a pair, no drives,
-- allowance 0.5, the day and each round marked as foursomes.

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
  -- 0136: set for a foursomes day — pairs, one ball, alternate shot.
  v_foursomes text := nullif(p_day ->> 'foursomes_scoring', '');
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
  if v_foursomes is not null then
    if v_foursomes not in ('stableford', 'stroke') then
      raise exception 'Foursomes is scored by Stableford or stroke play' using errcode = '22023';
    end if;
    if v_size <> 2 then
      raise exception 'Foursomes is played in pairs' using errcode = '22023';
    end if;
    v_drives := null;
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
           not public.live_can_add_player(v_me, v_member)) then
        raise exception 'You can add yourself, your PinPals, people in your group, or guests by name' using errcode = '42501';
      end if;
    end loop;
  end loop;

  insert into public.live_match_days (created_by, title, club_id, course_name, tee_name, holes,
                                      course_rating, slope, par_total, kind, foursomes_scoring)
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
    'scramble',
    v_foursomes
  )
  returning id into v_day_id;

  for v_team in select * from jsonb_array_elements(p_teams) loop
    v_n := v_n + 1;
    insert into public.live_rounds (created_by, club_id, course_name, tee_name, format, holes, course_rating,
                                    slope, par_total, allowance, match_day_id, tee_time,
                                    scramble_size, team_name, team_number, team_handicap, drive_minimum,
                                    foursomes_scoring)
    select v_me, d.club_id, d.course_name, d.tee_name, 'stroke', d.holes, d.course_rating, d.slope, d.par_total,
           case when v_foursomes is not null then 0.5 when v_size = 4 then 0.25 else 0.35 end,
           v_day_id, nullif(v_team ->> 'tee_time', '')::time,
           v_size,
           coalesce(nullif(btrim(coalesce(v_team ->> 'name', '')), ''), case when v_foursomes is not null then 'Pair ' else 'Team ' end || v_n),
           v_n,
           (v_team ->> 'team_handicap')::smallint,
           v_drives,
           v_foursomes
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
