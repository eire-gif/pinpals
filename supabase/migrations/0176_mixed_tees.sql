-- 0176 — Players on different tees in one day (Oct 2026)
--
-- Asked by Eire, 18 Oct 2026: ladies off the reds and men off the whites in
-- the same society day, as an option.
--
-- The organiser picks the day's tees as before, then can put some players on
-- other tees. Each of those players' course handicap is worked out from
-- their own tee's rating, slope and par (in the app), and, if the organiser
-- leaves "Adjust for the different tees" on, they get the World Handicap
-- System's adjustment for the difference in par (Rule 6.2b; PinPals' course
-- handicap already includes course rating minus par, so the par difference
-- is what's left). Everyone is scored on the day's one card (pars and stroke
-- indexes), as the committee names one card for the competition.
--
-- New on each player:
--   tee_name   the tees they play from, when not the day's (null = the day's)
--   tee_extra  the adjustment in shots already in their playing handicap
--              (0 when none), so the card and the results can say why
--
-- The three day-create functions take tee_name and tee_extra on each player.
-- They are long; only their player insert changes, so they're rewritten from
-- their current definition with the two columns added, and the migration
-- refuses to run if the text it looks for isn't found exactly once. CREATE OR
-- REPLACE keeps their grants.
--
-- Saving a card for the handicap record (scorecard_from_live_round): a
-- player off other tees saves it on THEIR tees — that card's rating, slope,
-- pars, stroke indexes and yards, and their playing handicap without the
-- competition adjustment — so the differential is worked out on the tees
-- they played. Without a card on file for those tees it's saved with no
-- rating or slope, rather than the wrong ones.
--
-- No drop statements.
--
-- Applied to production 18 Oct 2026.
--
-- Rollback: recreate scorecard_from_live_round from 0138; the same
-- replacements the other way, then
--   alter table public.live_round_players drop column if exists tee_extra, drop column if exists tee_name;

alter table public.live_round_players
  add column if not exists tee_name text check (tee_name is null or char_length(btrim(tee_name)) between 1 and 40),
  add column if not exists tee_extra smallint not null default 0 check (tee_extra between -20 and 20);

comment on column public.live_round_players.tee_name is
  'Mixed tees (0176): the tees this player plays from when not the day''s; null = the day''s tees.';
comment on column public.live_round_players.tee_extra is
  'Mixed tees (0176): shots added to (or taken from) the playing handicap for the difference in par between tees.';

do $$
declare
  d text;
  fn text;
  cols_old constant text := 'playing_handicap, handicap_estimated,';
  cols_new constant text := 'playing_handicap, tee_name, tee_extra, handicap_estimated,';
  vals_old constant text := '(v_player ->> ''playing_handicap'')::smallint,';
  vals_new constant text := '(v_player ->> ''playing_handicap'')::smallint, nullif(btrim(coalesce(v_player ->> ''tee_name'', '''')), ''''), coalesce((v_player ->> ''tee_extra'')::smallint, 0),';
begin
  foreach fn in array array[
    'public.live_fourball_day_create(jsonb,jsonb,jsonb)',
    'public.live_scramble_day_create(jsonb,jsonb,jsonb)',
    'public.live_match_day_create(jsonb,jsonb,jsonb)'
  ] loop
    d := pg_get_functiondef(fn::regprocedure);
    if (length(d) - length(replace(d, cols_old, ''))) / length(cols_old) <> 1 then
      raise exception '0176: expected "%" once in %', cols_old, fn;
    end if;
    if (length(d) - length(replace(d, vals_old, ''))) / length(vals_old) <> 1 then
      raise exception '0176: expected "%" once in %', vals_old, fn;
    end if;
    execute replace(replace(d, cols_old, cols_new), vals_old, vals_new);
  end loop;
end $$;

create or replace function public.scorecard_from_live_round(p_round_id bigint)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_round public.live_rounds;
  v_player public.live_round_players;
  v_id bigint;
  v_card_id bigint;
  -- 0138: a pair's or team's card — one ball, scored on its first player.
  v_team text;
  v_lead bigint;
  v_hcp smallint;
  v_index numeric;
  -- 0176: a player off other tees saves their card on those tees.
  v_tee text;
  v_rating numeric;
  v_slope smallint;
  v_par smallint;
  v_own_card bigint;
begin
  if v_me is null or not exists (select 1 from public.profiles where id = v_me and deleted_at is null) then
    raise exception 'Sign in to save a scorecard' using errcode = '42501';
  end if;
  select * into v_round from public.live_rounds where id = p_round_id;
  select * into v_player from public.live_round_players where round_id = p_round_id and member_id = v_me;
  if v_round.id is null or v_player.id is null then
    raise exception 'You can only save your own card from a round you played in' using errcode = '42501';
  end if;

  v_lead := v_player.id;
  v_hcp := v_player.playing_handicap;
  v_index := v_player.handicap_index;
  if v_round.scramble_size is not null then
    -- A scramble team or a foursomes pair: the team's handicap, its ball.
    v_team := case when v_round.foursomes_scoring is not null then 'foursomes' else 'scramble' end;
    select id into v_lead from public.live_round_players where round_id = v_round.id order by position limit 1;
    v_hcp := v_round.team_handicap;
    v_index := null;
  elsif v_round.match_type in ('foursomes', 'greensomes') then
    -- A pair in a foursomes or greensomes match: the side's ball is on its
    -- first player; the pair's handicap as the match works it out
    -- (live-scoring.ts matchCompetitors), rounded half up.
    v_team := v_round.match_type;
    select id into v_lead from public.live_round_players
     where round_id = v_round.id and side = v_player.side order by position limit 1;
    select case when v_round.match_type = 'foursomes'
                then floor(0.5 * sum(course_handicap) + 0.5)
                else floor(0.6 * min(course_handicap) + 0.4 * max(course_handicap) + 0.5) end
      into v_hcp
      from public.live_round_players where round_id = v_round.id and side = v_player.side;
    v_index := null;
  end if;

  if v_round.club_id is not null then
    select id into v_card_id from public.course_cards
     where club_id = v_round.club_id and holes = v_round.holes
       and lower(btrim(tee_name)) = lower(btrim(coalesce(v_round.tee_name, '')))
     limit 1;
  end if;

  v_tee := v_round.tee_name;
  v_rating := v_round.course_rating;
  v_slope := v_round.slope;
  v_par := v_round.par_total;
  -- 0176: their own ball off other tees — the card goes in on those tees
  -- (rating, slope, pars, stroke indexes and yards), so the handicap record
  -- is right, and the playing handicap without the competition adjustment.
  if v_team is null and v_player.tee_name is not null and v_round.club_id is not null then
    select c.id, c.tee_name, c.course_rating, c.slope, coalesce(c.par_total, (select sum(par) from public.course_card_holes where card_id = c.id))
      into v_own_card, v_tee, v_rating, v_slope, v_par
      from public.course_cards c
     where c.club_id = v_round.club_id and c.holes = v_round.holes
       and lower(btrim(c.tee_name)) = lower(btrim(v_player.tee_name))
     limit 1;
    if v_own_card is null then
      v_tee := v_player.tee_name;
      v_rating := null;
      v_slope := null;
      v_par := v_round.par_total;
    else
      v_card_id := v_own_card;
    end if;
    v_hcp := v_hcp - coalesce(v_player.tee_extra, 0);
  end if;

  insert into public.scorecards (member_id, club_id, course_name, tee_name, holes, played_on, par_total,
                                 course_rating, slope, handicap_index, playing_handicap, source, live_round_id, team_card)
  values (v_me, v_round.club_id, v_round.course_name, v_tee, v_round.holes, v_round.played_on,
          v_par, v_rating, v_slope, v_index,
          v_hcp, 'live', v_round.id, v_team)
  on conflict (member_id, live_round_id) where live_round_id is not null do update set
    tee_name = excluded.tee_name, par_total = excluded.par_total, course_rating = excluded.course_rating,
    slope = excluded.slope, handicap_index = excluded.handicap_index,
    playing_handicap = excluded.playing_handicap, team_card = excluded.team_card, updated_at = now()
  returning id into v_id;

  insert into public.scorecard_holes (scorecard_id, hole, par, stroke_index, yards, strokes)
  select v_id, h.hole,
         -- 0176: off their own tees, that card's par and stroke index.
         coalesce((select ch.par from public.course_card_holes ch where v_own_card is not null and ch.card_id = v_own_card and ch.hole = h.hole), h.par),
         coalesce((select ch.stroke_index from public.course_card_holes ch where v_own_card is not null and ch.card_id = v_own_card and ch.hole = h.hole), h.stroke_index),
         (select ch.yards from public.course_card_holes ch where ch.card_id = v_card_id and ch.hole = h.hole),
         s.strokes
    from public.live_round_holes h
    left join public.live_round_scores s on s.player_id = v_lead and s.hole = h.hole
   where h.round_id = v_round.id
  on conflict (scorecard_id, hole) do update set
    par = excluded.par, stroke_index = excluded.stroke_index,
    yards = coalesce(excluded.yards, public.scorecard_holes.yards), strokes = excluded.strokes;

  return v_id;
end;
$$;

revoke all on function public.scorecard_from_live_round(bigint) from public, anon, authenticated;
grant execute on function public.scorecard_from_live_round(bigint) to authenticated;
