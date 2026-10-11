-- ============================================================================
-- Live rounds from a group, and the society Stableford day (Oct 2026)
-- ============================================================================
--
-- Two changes, both for groups (0120) meeting live scoring (0103/0104/0113):
--
-- 1. WHO YOU CAN PUT ON A CARD. Until now: yourself, your accepted PinPals,
--    or a guest by name — checked inline, three times over, in
--    live_round_create, live_match_day_create and live_scramble_day_create.
--    A society secretary isn't connected with 40 members, so that rule would
--    make a group draw useless. It moves into ONE function,
--    live_can_add_player(), which adds:
--
--      - anyone in the same crew or trip as you (small, invite-only groups
--        of people who already play together), and
--      - anyone in a group you run (owner or admin) — a society's secretary
--        and committee. An ordinary member of a 300-strong society does NOT
--        get to put the other 299 on cards: that is a notification to a
--        stranger, and joining a searchable society shouldn't grant it.
--
--    Still never: someone you've blocked or who has blocked you, or a deleted
--    member. The three functions are recreated with the check swapped and
--    nothing else changed (bodies copied from 0113 and 0104).
--
-- 2. THE SOCIETY DAY: individual Stableford or stroke play across several
--    groups at one course, everyone on one leaderboard. The usual society
--    format, and the one live scoring couldn't do: a single round holds 8
--    players, and match/scramble days rank matches and teams, not people.
--    It is a live_match_days row with kind 'fourballs' and one live round
--    per tee group (match_number = group number), so everything already
--    built for days carries over unchanged: who can see it (anyone in the
--    day), who can score a card (its own players, whoever started the round,
--    the day's organiser), the realtime board channel, delete, and calendar.
--    The board itself is computed in the app (lib/live-day-board.ts) from
--    each group's card, like every other leaderboard: nothing is stored.
--
-- Applying it: the kind check has to be dropped and re-added to allow
-- 'fourballs'. The Supabase tool cancels any batch containing a drop, so
-- that statement goes in by hand in the SQL editor (it's marked below).
--
-- Rollback: recreate the three functions from 0113/0104, drop
-- live_can_add_player() and live_fourball_day_create(), and put the kind
-- check back to ('match', 'scramble') once no 'fourballs' days exist.


-- ============ Who you can put on a card ============

create or replace function public.live_can_add_player(p_me uuid, p_member uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_me is not null and p_member is not null and (
    p_member = p_me
    or (
      exists (select 1 from public.profiles where id = p_member and deleted_at is null)
      and not public.is_blocked(p_me, p_member)
      and (
        public.are_connected(p_me, p_member)
        or exists (
          select 1
            from public.group_members mine
            join public.group_members theirs
              on theirs.group_id = mine.group_id and theirs.member_id = p_member
            join public.groups g
              on g.id = mine.group_id and g.hidden_at is null
           where mine.member_id = p_me
             and (g.kind in ('crew', 'trip') or mine.role in ('owner', 'admin'))
        )
      )
    )
  );
$$;
revoke all on function public.live_can_add_player(uuid, uuid) from public, anon, authenticated;


-- ============ The three ways a round starts, with the shared check ============

-- live_round_create: as 0113, with the add-player check now live_can_add_player().
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
      if not public.live_can_add_player(v_me, v_member) then
        raise exception 'You can add yourself, your PinPals, people in your group, or guests by name' using errcode = '42501';
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

-- live_match_day_create: as 0104, with the add-player check now live_can_add_player().
create or replace function public.live_match_day_create(p_day jsonb, p_matches jsonb, p_card jsonb)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_holes smallint := coalesce((p_day ->> 'holes')::smallint, 18);
  v_day_id bigint;
  v_round_id bigint;
  v_match jsonb;
  v_player jsonb;
  v_type text;
  v_member uuid;
  v_n smallint := 0;
  v_pos smallint;
  v_seen uuid[] := '{}';
  v_teams text[];
  v_per_side int;
begin
  if v_me is null or not exists (select 1 from public.profiles where id = v_me and deleted_at is null) then
    raise exception 'Sign in to start a match day' using errcode = '42501';
  end if;
  if (select count(*) from public.live_match_days where created_by = v_me and created_at > now() - interval '1 day') >= 10 then
    raise exception 'That''s a lot of match days for one day. Try again tomorrow.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_matches) <> 'array' or jsonb_array_length(p_matches) not between 1 and 12 then
    raise exception 'A match day has between 1 and 12 matches' using errcode = '22023';
  end if;
  if jsonb_typeof(p_card) <> 'array' or jsonb_array_length(p_card) <> v_holes
     or (select count(distinct (h ->> 'hole')::int) from jsonb_array_elements(p_card) h
          where (h ->> 'hole')::int between 1 and v_holes) <> v_holes then
    raise exception 'The card must have one entry for each hole' using errcode = '22023';
  end if;
  if jsonb_typeof(p_day -> 'team_names') = 'array' then
    select array_agg(btrim(x)) into v_teams from jsonb_array_elements_text(p_day -> 'team_names') x;
  end if;

  -- Every match first, before anything is written.
  for v_match in select * from jsonb_array_elements(p_matches) loop
    v_type := v_match ->> 'match_type';
    if v_type is null or v_type not in ('singles', 'fourball', 'foursomes', 'greensomes') then
      raise exception 'Each match needs a format: singles, fourball, foursomes or greensomes' using errcode = '22023';
    end if;
    -- (Worked out first: PL/pgSQL ends an IF condition at the first THEN,
    -- including one inside a CASE.)
    v_per_side := case when v_type = 'singles' then 1 else 2 end;
    if jsonb_typeof(v_match -> 'players') <> 'array'
       or jsonb_array_length(v_match -> 'players') <> 2 * v_per_side
       or (select count(*) from jsonb_array_elements(v_match -> 'players') p where p ->> 'side' = '1') <> v_per_side
       or (select count(*) from jsonb_array_elements(v_match -> 'players') p where p ->> 'side' = '2') <> v_per_side then
      raise exception 'Singles is one player a side; fourball, foursomes and greensomes are two' using errcode = '22023';
    end if;
    for v_player in select * from jsonb_array_elements(v_match -> 'players') loop
      v_member := nullif(v_player ->> 'member_id', '')::uuid;
      if v_member is null then
        continue;
      end if;
      if v_member = any (v_seen) then
        raise exception 'Someone is in two matches. Each player plays one match a day.' using errcode = '22023';
      end if;
      v_seen := v_seen || v_member;
      if v_member <> v_me and (
           not public.live_can_add_player(v_me, v_member)) then
        raise exception 'You can add yourself, your PinPals, people in your group, or guests by name' using errcode = '42501';
      end if;
    end loop;
  end loop;

  insert into public.live_match_days (created_by, title, club_id, course_name, tee_name, holes,
                                      course_rating, slope, par_total, team_names)
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
    v_teams
  )
  returning id into v_day_id;

  for v_match in select * from jsonb_array_elements(p_matches) loop
    v_n := v_n + 1;
    v_type := v_match ->> 'match_type';
    insert into public.live_rounds (created_by, club_id, course_name, tee_name, format, holes, course_rating,
                                    slope, par_total, allowance, match_day_id, match_number, match_type, tee_time)
    select v_me, d.club_id, d.course_name, d.tee_name, 'matchplay', d.holes, d.course_rating, d.slope, d.par_total,
           case v_type when 'singles' then 1 when 'fourball' then 0.9 when 'foursomes' then 0.5 else 0.6 end,
           v_day_id, v_n, v_type, nullif(v_match ->> 'tee_time', '')::time
      from public.live_match_days d where d.id = v_day_id
    returning id into v_round_id;

    v_pos := 0;
    -- Side 1 first, then side 2, each in the order given: a one-ball pair's
    -- score lives on its first player.
    for v_player in
      select e.value
        from jsonb_array_elements(v_match -> 'players') with ordinality e(value, ord)
       order by (e.value ->> 'side')::int, e.ord
    loop
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
        (v_player ->> 'side')::smallint
      );
    end loop;

    insert into public.live_round_holes (round_id, hole, par, stroke_index)
    select v_round_id, (h ->> 'hole')::smallint, (h ->> 'par')::smallint, nullif(h ->> 'stroke_index', '')::smallint
      from jsonb_array_elements(p_card) h;
  end loop;

  return v_day_id;
end;
$$;

revoke all on function public.live_match_day_create(jsonb, jsonb, jsonb) from public;
revoke execute on function public.live_match_day_create(jsonb, jsonb, jsonb) from anon;
grant execute on function public.live_match_day_create(jsonb, jsonb, jsonb) to authenticated;

-- live_scramble_day_create: as 0113, with the add-player check now live_can_add_player().
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
           not public.live_can_add_player(v_me, v_member)) then
        raise exception 'You can add yourself, your PinPals, people in your group, or guests by name' using errcode = '42501';
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

-- ============ The society day ============

-- APPLY BY HAND in the SQL editor (the tool cancels a batch with a drop).
alter table public.live_match_days drop constraint if exists live_match_days_kind_check;
alter table public.live_match_days
  add constraint live_match_days_kind_check check (kind in ('match', 'scramble', 'fourballs'));

comment on column public.live_match_days.kind is
  'match: matches between two sides (0104). scramble: one round per scramble team, one leaderboard (0113). fourballs: one round per tee group, individual Stableford or stroke play on one leaderboard (0121).';

-- p_day:    {title, course_name, club_id?, tee_name?, holes, course_rating?,
--            slope?, par_total?, format: 'stableford'|'stroke', allowance}
-- p_groups: [{tee_time?, players: [{member_id?, name, handicap_index,
--            course_handicap, playing_handicap, handicap_estimated}]}]
--            in tee order, 1 to 4 players each (a 5th is allowed for an odd
--            number on a quiet day), up to 40 groups
-- p_card:   [{hole, par, stroke_index?}] one per hole, copied to every group
create or replace function public.live_fourball_day_create(p_day jsonb, p_groups jsonb, p_card jsonb)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_holes smallint := coalesce((p_day ->> 'holes')::smallint, 18);
  v_format text := p_day ->> 'format';
  v_allowance numeric := nullif(p_day ->> 'allowance', '')::numeric;
  v_day_id bigint;
  v_round_id bigint;
  v_group jsonb;
  v_player jsonb;
  v_member uuid;
  v_n smallint := 0;
  v_pos smallint;
  v_seen uuid[] := '{}';
begin
  if v_me is null or not exists (select 1 from public.profiles where id = v_me and deleted_at is null) then
    raise exception 'Sign in to start a round' using errcode = '42501';
  end if;
  if (select count(*) from public.live_match_days where created_by = v_me and created_at > now() - interval '1 day') >= 10 then
    raise exception 'That''s a lot of days for one day. Try again tomorrow.' using errcode = 'P0001';
  end if;
  if char_length(btrim(coalesce(p_day ->> 'title', ''))) not between 1 and 80 then
    raise exception 'Give the day a name' using errcode = '22023';
  end if;
  if v_format is null or v_format not in ('stableford', 'stroke') then
    raise exception 'A society day is Stableford or stroke play' using errcode = '22023';
  end if;
  if v_allowance is null or v_allowance <= 0 or v_allowance > 1 then
    raise exception 'The handicap allowance must be between 0 and 100%%' using errcode = '22023';
  end if;
  if jsonb_typeof(p_groups) <> 'array' or jsonb_array_length(p_groups) not between 1 and 40 then
    raise exception 'A day has between 1 and 40 groups' using errcode = '22023';
  end if;
  if jsonb_typeof(p_card) <> 'array' or jsonb_array_length(p_card) <> v_holes
     or (select count(distinct (h ->> 'hole')::int) from jsonb_array_elements(p_card) h
          where (h ->> 'hole')::int between 1 and v_holes) <> v_holes then
    raise exception 'The card must have one entry for each hole' using errcode = '22023';
  end if;

  -- Every group and player first, before anything is written.
  for v_group in select * from jsonb_array_elements(p_groups) loop
    if jsonb_typeof(v_group -> 'players') <> 'array' or jsonb_array_length(v_group -> 'players') not between 1 and 5 then
      raise exception 'Every group needs between 1 and 5 players' using errcode = '22023';
    end if;
    for v_player in select * from jsonb_array_elements(v_group -> 'players') loop
      if char_length(btrim(coalesce(v_player ->> 'name', ''))) = 0 then
        raise exception 'Every player needs a name' using errcode = '22023';
      end if;
      v_member := nullif(v_player ->> 'member_id', '')::uuid;
      if v_member is null then
        continue;
      end if;
      if v_member = any (v_seen) then
        raise exception 'Someone is in two groups. Each player plays in one group.' using errcode = '22023';
      end if;
      v_seen := v_seen || v_member;
      if not public.live_can_add_player(v_me, v_member) then
        raise exception 'You can add yourself, your PinPals, people in your group, or guests by name' using errcode = '42501';
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
    'fourballs'
  )
  returning id into v_day_id;

  for v_group in select * from jsonb_array_elements(p_groups) loop
    v_n := v_n + 1;
    insert into public.live_rounds (created_by, club_id, course_name, tee_name, format, holes, course_rating,
                                    slope, par_total, allowance, match_day_id, match_number, tee_time)
    select v_me, d.club_id, d.course_name, d.tee_name, v_format, d.holes, d.course_rating, d.slope, d.par_total,
           v_allowance, v_day_id, v_n, nullif(v_group ->> 'tee_time', '')::time
      from public.live_match_days d where d.id = v_day_id
    returning id into v_round_id;

    v_pos := 0;
    for v_player in select * from jsonb_array_elements(v_group -> 'players') loop
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
        null
      );
    end loop;

    insert into public.live_round_holes (round_id, hole, par, stroke_index)
    select v_round_id, (h ->> 'hole')::smallint, (h ->> 'par')::smallint, nullif(h ->> 'stroke_index', '')::smallint
      from jsonb_array_elements(p_card) h;
  end loop;

  return v_day_id;
end;
$$;

revoke all on function public.live_fourball_day_create(jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.live_fourball_day_create(jsonb, jsonb, jsonb) to authenticated;
