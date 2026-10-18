-- 0180 — Every player's card saves itself when a round finishes (Oct 2026)
--
-- At Swords on 18 Oct (round 378) Stephen scored and tapped Finish. Only the
-- member who taps Finish had their card saved (and was asked to get it
-- certified); Matt certified Stephen's card, landed on "Done — back to Home",
-- and never had a card of his own. Nothing failed — nobody pointed him at it.
--
-- Now, when a round goes from live to finished — by any route (Finish in the
-- app, a match day being closed) — every member who played in it gets their
-- card saved, at the normal default visibility, exactly as if they'd tapped
-- "Save my scorecard" themselves. A card already saved "so far" is refreshed
-- with the final scores. Guests (no member_id) get nothing, as before.
--
--   - scorecard_from_live_round_for(round, member): the 0176 body, for a
--     given member. Server-only — not callable from the app.
--   - scorecard_from_live_round(round): unchanged for the app; now a thin
--     wrapper that checks you're signed in and calls the above for you.
--   - live_rounds_finish_cards trigger: saves everyone's card on finish. One
--     card failing never stops the round finishing.
--   - Backfill: finished rounds with a member's card missing (3 at the time).
--
-- Rollback (restores the 0176 behaviour; backfilled cards stay):
--   drop trigger if exists live_rounds_finish_cards on public.live_rounds;
--   drop function if exists public.live_round_finish_cards();
--   -- re-run the scorecard_from_live_round definition from 0176_mixed_tees.sql
--   drop function if exists public.scorecard_from_live_round_for(bigint, uuid);

create or replace function public.scorecard_from_live_round_for(p_round_id bigint, p_member uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := p_member;
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
    raise exception 'No such member' using errcode = '42501';
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

revoke all on function public.scorecard_from_live_round_for(bigint, uuid) from public, anon, authenticated;

comment on function public.scorecard_from_live_round_for(bigint, uuid) is
  '0180: save (or refresh) one member''s card from a live round they played in. Server-only; the app calls scorecard_from_live_round.';

create or replace function public.scorecard_from_live_round(p_round_id bigint)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null or not exists (select 1 from public.profiles where id = v_me and deleted_at is null) then
    raise exception 'Sign in to save a scorecard' using errcode = '42501';
  end if;
  return public.scorecard_from_live_round_for(p_round_id, v_me);
end;
$$;

revoke all on function public.scorecard_from_live_round(bigint) from public, anon, authenticated;
grant execute on function public.scorecard_from_live_round(bigint) to authenticated;

create or replace function public.live_round_finish_cards()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member uuid;
begin
  for v_member in
    select p.member_id
      from public.live_round_players p
      join public.profiles pr on pr.id = p.member_id and pr.deleted_at is null
     where p.round_id = new.id and p.member_id is not null
     order by p.position
  loop
    begin
      perform public.scorecard_from_live_round_for(new.id, v_member);
    exception when others then
      -- The round still finishes; that member can tap "Save my scorecard".
      raise warning 'live_round_finish_cards: round %, member %: %', new.id, v_member, sqlerrm;
    end;
  end loop;
  return null;
end;
$$;

revoke all on function public.live_round_finish_cards() from public, anon, authenticated;

drop trigger if exists live_rounds_finish_cards on public.live_rounds;
create trigger live_rounds_finish_cards
  after update of status on public.live_rounds
  for each row
  when (old.status = 'live' and new.status = 'finished')
  execute function public.live_round_finish_cards();

-- Backfill: anyone who played in a finished round and has no card from it.
do $$
declare
  r record;
begin
  for r in
    select p.round_id, p.member_id
      from public.live_rounds lr
      join public.live_round_players p on p.round_id = lr.id and p.member_id is not null
      join public.profiles pr on pr.id = p.member_id and pr.deleted_at is null
     where lr.status = 'finished'
       and not exists (select 1 from public.scorecards s where s.live_round_id = lr.id and s.member_id = p.member_id)
  loop
    begin
      perform public.scorecard_from_live_round_for(r.round_id, r.member_id);
    exception when others then
      raise warning '0180 backfill: round %, member %: %', r.round_id, r.member_id, sqlerrm;
    end;
  end loop;
end;
$$;
