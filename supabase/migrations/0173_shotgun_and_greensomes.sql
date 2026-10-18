-- 0173 — Shotgun starts and greensomes pairs (Oct 2026)
--
-- Asked by Eire, 18 Oct 2026, for a 130-player society day: pairs playing
-- greensomes ("foursomes off the best drive"), off a shotgun start with an
-- A and a B group on most holes.
--
-- GREENSOMES: both partners drive, the pair picks the better drive, then
-- they play alternate shots. It already existed as a match (0104); now it
-- is a pairs competition like foursomes (0136) — one card per pair, one
-- leaderboard, Stableford or net stroke play. Stored exactly like a
-- foursomes pair, plus a flag:
--
--   live_rounds.greensomes, live_match_days.greensomes   (only with
--   foursomes_scoring set; a greensomes pair's allowance is 0.6)
--
-- The pair's handicap (WHS Appendix C): 60% of the lower course handicap
-- plus 40% of the higher, rounded once — worked out by the app
-- (greensomesHandicap in live-scoring.ts) and sent as team_handicap.
--
-- SHOTGUN START: every group goes off at the same time from a different
-- hole; with more groups than holes, a second "B" group starts on a hole
-- once the "A" group has played its tee shot. Each group's start is kept:
--
--   live_rounds.start_hole, start_letter              (A, B, C or D)
--   society_outing_entries / society_outing_guests    the same, so the
--                                                     published draw says
--                                                     "Shotgun 9:00 · 7B"
--
-- A group's card begins on its start hole and wraps round; ties are still
-- judged on holes 10–18 by number (competition-results.ts), the R&A's
-- recommendation for shotgun starts. Null = an ordinary tee-time start.
--
-- Also from 0172: a pairs/team day takes 100 teams, a society day 60 groups.
--
-- No drop statements. Applied to production 18 Oct 2026.
--
-- Rollback:
--   recreate live_scramble_day_create (0136, with 0172's limit),
--   live_fourball_day_create (0121, with 0172's limit) and
--   publish_outing_draw (0131); drop function public.live_check_start;
--   alter table public.live_rounds drop column start_hole, drop column start_letter, drop column greensomes;
--   alter table public.live_match_days drop column greensomes;
--   alter table public.society_outing_entries drop column start_hole, drop column start_letter;
--   alter table public.society_outing_guests drop column start_hole, drop column start_letter;

alter table public.live_rounds
  add column if not exists start_hole smallint check (start_hole is null or start_hole between 1 and 18),
  add column if not exists start_letter text check (start_letter is null or start_letter in ('A', 'B', 'C', 'D')),
  add column if not exists greensomes boolean not null default false;

alter table public.live_match_days
  add column if not exists greensomes boolean not null default false;

alter table public.society_outing_entries
  add column if not exists start_hole smallint check (start_hole is null or start_hole between 1 and 18),
  add column if not exists start_letter text check (start_letter is null or start_letter in ('A', 'B', 'C', 'D'));

alter table public.society_outing_guests
  add column if not exists start_hole smallint check (start_hole is null or start_hole between 1 and 18),
  add column if not exists start_letter text check (start_letter is null or start_letter in ('A', 'B', 'C', 'D'));

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'live_rounds_start_letter_has_hole') then
    alter table public.live_rounds add constraint live_rounds_start_letter_has_hole
      check (start_letter is null or start_hole is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'live_rounds_greensomes_is_a_pair') then
    alter table public.live_rounds add constraint live_rounds_greensomes_is_a_pair
      check (not greensomes or foursomes_scoring is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'live_match_days_greensomes_is_pairs') then
    alter table public.live_match_days add constraint live_match_days_greensomes_is_pairs
      check (not greensomes or foursomes_scoring is not null);
  end if;
end $$;

comment on column public.live_rounds.start_hole is 'Shotgun start (0173): the hole this group starts on. Null = an ordinary tee-time start from the 1st.';
comment on column public.live_rounds.start_letter is 'Shotgun start (0173): A for the first group on its start hole, B for the second.';
comment on column public.live_rounds.greensomes is 'Greensomes pair (0173): both drive, play the better, then alternate. Only with foursomes_scoring set.';

-- A group's or team's start, in a draw: start_hole 1..holes and a letter, or neither.
create or replace function public.live_check_start(p_group jsonb, p_holes smallint)
returns void
language plpgsql
immutable
set search_path = public
as $$
declare
  v_hole text := nullif(p_group ->> 'start_hole', '');
  v_letter text := nullif(p_group ->> 'start_letter', '');
begin
  if v_hole is null then
    if v_letter is not null then
      raise exception 'A shotgun group needs its starting hole' using errcode = '22023';
    end if;
    return;
  end if;
  if v_hole !~ '^[0-9]{1,2}$' or v_hole::int not between 1 and coalesce(p_holes, 18) then
    raise exception 'A shotgun group starts on a hole of the course' using errcode = '22023';
  end if;
  if v_letter is not null and v_letter not in ('A', 'B', 'C', 'D') then
    raise exception 'A shotgun group is A, B, C or D on its hole' using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.live_check_start(jsonb, smallint) from public, anon, authenticated;

-- ============ A day of pairs or teams ============

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
  -- 0173: a greensomes day — pairs, both drive, play the better one.
  v_greensomes boolean := coalesce((p_day ->> 'greensomes')::boolean, false);
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
  if v_greensomes and v_foursomes is null then
    raise exception 'Greensomes is played in pairs, on Stableford or stroke play' using errcode = '22023';
  end if;
  if jsonb_typeof(p_teams) <> 'array' or jsonb_array_length(p_teams) not between 1 and 100 then
    raise exception 'A scramble has between 1 and 100 teams' using errcode = '22023';
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
    perform public.live_check_start(v_team, v_holes);
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
                                      course_rating, slope, par_total, kind, foursomes_scoring, greensomes)
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
    v_foursomes,
    v_greensomes
  )
  returning id into v_day_id;

  for v_team in select * from jsonb_array_elements(p_teams) loop
    v_n := v_n + 1;
    insert into public.live_rounds (created_by, club_id, course_name, tee_name, format, holes, course_rating,
                                    slope, par_total, allowance, match_day_id, tee_time,
                                    scramble_size, team_name, team_number, team_handicap, drive_minimum,
                                    foursomes_scoring, greensomes, start_hole, start_letter)
    select v_me, d.club_id, d.course_name, d.tee_name, 'stroke', d.holes, d.course_rating, d.slope, d.par_total,
           case when v_greensomes then 0.6 when v_foursomes is not null then 0.5 when v_size = 4 then 0.25 else 0.35 end,
           v_day_id, nullif(v_team ->> 'tee_time', '')::time,
           v_size,
           coalesce(nullif(btrim(coalesce(v_team ->> 'name', '')), ''), case when v_foursomes is not null then 'Pair ' else 'Team ' end || v_n),
           v_n,
           (v_team ->> 'team_handicap')::smallint,
           v_drives,
           v_foursomes,
           v_greensomes,
           nullif(v_team ->> 'start_hole', '')::smallint,
           nullif(v_team ->> 'start_letter', '')
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

revoke all on function public.live_scramble_day_create(jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.live_scramble_day_create(jsonb, jsonb, jsonb) to authenticated;

-- ============ A society day of tee groups ============

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
  if jsonb_typeof(p_groups) <> 'array' or jsonb_array_length(p_groups) not between 1 and 60 then
    raise exception 'A day has between 1 and 60 groups' using errcode = '22023';
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
    perform public.live_check_start(v_group, v_holes);
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
                                    slope, par_total, allowance, match_day_id, match_number, tee_time,
                                    start_hole, start_letter)
    select v_me, d.club_id, d.course_name, d.tee_name, v_format, d.holes, d.course_rating, d.slope, d.par_total,
           v_allowance, v_day_id, v_n, nullif(v_group ->> 'tee_time', '')::time,
           nullif(v_group ->> 'start_hole', '')::smallint, nullif(v_group ->> 'start_letter', '')
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

-- ============ An outing's published draw ============

create or replace function public.publish_outing_draw(p_outing_id bigint, p_groups jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  o public.society_outings%rowtype;
  v_group jsonb;
  v_el jsonb;
  v_n smallint := 0;
  v_pos smallint;
  v_member uuid;
  v_guest bigint;
  v_seen uuid[] := '{}';
  v_seen_guests bigint[] := '{}';
  v_time time;
  v_start smallint;
  v_letter text;
begin
  select * into o from public.society_outings where id = p_outing_id;
  if not found or not public.outing_officer(o.group_id, me) then
    raise exception 'Only the captain or secretary can publish the draw.' using errcode = '42501';
  end if;
  if o.status <> 'open' then raise exception 'This outing was cancelled.'; end if;
  if jsonb_typeof(p_groups) <> 'array' or jsonb_array_length(p_groups) not between 1 and 60 then
    raise exception 'A draw has between 1 and 60 groups.';
  end if;

  update public.society_outing_entries set tee_group = null, tee_time = null, tee_position = null, start_hole = null, start_letter = null
   where outing_id = p_outing_id;
  update public.society_outing_guests set tee_group = null, tee_time = null, tee_position = null, start_hole = null, start_letter = null
   where outing_id = p_outing_id;

  for v_group in select * from jsonb_array_elements(p_groups) loop
    v_n := v_n + 1;
    v_pos := 0;
    begin
      v_time := nullif(v_group ->> 'tee_time', '')::time;
    exception when others then
      raise exception 'A tee time doesn''t look right.';
    end;
    -- 0173: a shotgun start — the hole this group starts on, and A/B.
    perform public.live_check_start(v_group, 18::smallint);
    v_start := nullif(v_group ->> 'start_hole', '')::smallint;
    v_letter := nullif(v_group ->> 'start_letter', '');
    if jsonb_typeof(v_group -> 'members') <> 'array' or jsonb_array_length(v_group -> 'members') not between 1 and 8 then
      raise exception 'Each group has between 1 and 8 players.';
    end if;
    for v_el in select * from jsonb_array_elements(v_group -> 'members') loop
      v_pos := v_pos + 1;
      if jsonb_typeof(v_el) = 'object' then
        begin
          v_guest := (v_el ->> 'guest')::bigint;
        exception when others then
          raise exception 'That draw doesn''t look right.';
        end;
        if v_guest is null then raise exception 'That draw doesn''t look right.'; end if;
        if v_guest = any (v_seen_guests) then raise exception 'Someone is in two groups.'; end if;
        v_seen_guests := v_seen_guests || v_guest;
        update public.society_outing_guests
           set tee_group = v_n, tee_time = v_time, tee_position = v_pos, start_hole = v_start, start_letter = v_letter
         where outing_id = p_outing_id and id = v_guest;
        if not found then raise exception 'Only guests on this outing can be in the draw.'; end if;
      else
        begin
          v_member := (v_el #>> '{}')::uuid;
        exception when others then
          raise exception 'That draw doesn''t look right.';
        end;
        if v_member = any (v_seen) then raise exception 'Someone is in two groups.'; end if;
        v_seen := v_seen || v_member;
        update public.society_outing_entries
           set tee_group = v_n, tee_time = v_time, tee_position = v_pos, start_hole = v_start, start_letter = v_letter
         where outing_id = p_outing_id and member_id = v_member;
        if not found then raise exception 'Only people entered can be in the draw.'; end if;
      end if;
    end loop;
  end loop;

  update public.society_outings set draw_published_at = now() where id = p_outing_id;
end;
$$;

revoke all on function public.publish_outing_draw(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.publish_outing_draw(bigint, jsonb) to authenticated;
