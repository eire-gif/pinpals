-- 0138 — Pair and team cards, certified; results on the society's page
--          (Oct 2026)
--
-- 1. A PAIR'S OR TEAM'S CARD. Foursomes, greensomes and scramble play one
--    ball per side, scored on the side's first player. Until now a member
--    could only save (and get certified) a personal card, so:
--      - a foursomes or scramble DAY offered no card and no certification;
--      - a foursomes MATCH offered both, but the partner's card came out
--        blank (their own score rows are empty) — a bug.
--    scorecard_from_live_round now saves the SIDE's card for these rounds:
--    the side's ball, the side's handicap (team handicap; foursomes ½ of the
--    pair's course handicaps, greensomes 60/40), no index, and
--    scorecards.team_card says which format. Either partner can save it.
--
--    WHO CERTIFIES IT: never the partner — Rule 3.3b, a side's marker isn't
--    on that side. In a match, someone on the other side; on a foursomes or
--    scramble day, someone in another pair or team in the same tee group
--    (or in the day, when there are no tee times). scorecard_certify_request
--    already asks scorecard_certify_candidates(), so it needs no change.
--
--    NOT FOR HANDICAPS: the World Handicap System accepts individual formats
--    only, so a team card is never one of the 20 cards behind the handicap
--    indicator (handicap_differentials_of, recreated from 0133 with one
--    line added). Existing cards from such rounds are marked here.
--
-- 2. RESULTS ON THE SOCIETY'S PAGE. competition_results.group_id: the group
--    whose page lists the results (the outing's group when the day came
--    from an event, else the organiser's choice). Members of that group read
--    the published results, whether or not they played — joined to "past
--    results" on the group page. The organiser must be in the group.
--
-- No drop statements: safe for the Supabase tool.
--
-- Rollback:
--   recreate scorecard_from_live_round (0110), scorecard_certify_candidates
--   (0128) and handicap_differentials_of (0133);
--   drop function if exists public.competition_results_set_group(bigint, bigint);
--   drop function if exists public.competition_results_group_suggestion(bigint);
--   drop policy if exists "Group members read their group's published results" on public.competition_results;
--   alter table public.competition_results drop column if exists group_id;
--   alter table public.scorecards drop column if exists team_card;

alter table public.scorecards
  add column if not exists team_card text check (team_card is null or team_card in ('foursomes', 'greensomes', 'scramble'));

comment on column public.scorecards.team_card is
  'Set when the card is a pair''s or team''s (0138): one ball, the side''s handicap; certified by the other side; never counted for the handicap indicator.';

-- Cards already saved from such rounds.
update public.scorecards s
   set team_card = case
         when r.scramble_size is not null then case when r.foursomes_scoring is not null then 'foursomes' else 'scramble' end
         else r.match_type end
  from public.live_rounds r
 where s.live_round_id = r.id and s.team_card is null
   and (r.scramble_size is not null or r.match_type in ('foursomes', 'greensomes'));

-- ============ Saving a side's card ============

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

  insert into public.scorecards (member_id, club_id, course_name, tee_name, holes, played_on, par_total,
                                 course_rating, slope, handicap_index, playing_handicap, source, live_round_id, team_card)
  values (v_me, v_round.club_id, v_round.course_name, v_round.tee_name, v_round.holes, v_round.played_on,
          v_round.par_total, v_round.course_rating, v_round.slope, v_index,
          v_hcp, 'live', v_round.id, v_team)
  on conflict (member_id, live_round_id) where live_round_id is not null do update set
    tee_name = excluded.tee_name, par_total = excluded.par_total, course_rating = excluded.course_rating,
    slope = excluded.slope, handicap_index = excluded.handicap_index,
    playing_handicap = excluded.playing_handicap, team_card = excluded.team_card, updated_at = now()
  returning id into v_id;

  insert into public.scorecard_holes (scorecard_id, hole, par, stroke_index, yards, strokes)
  select v_id, h.hole, h.par, h.stroke_index,
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

-- ============ Who can certify it ============

create or replace function public.scorecard_certify_candidates(p_scorecard_id bigint)
returns table (member_id uuid, first_name text, last_name text, avatar_url text, avatar_color text, played_in_round boolean)
language sql
stable
security definer
set search_path = public
as $$
  with card as (
    select s.id, s.member_id, s.live_round_id, s.team_card
      from public.scorecards s
     where s.id = p_scorecard_id and s.member_id = (select auth.uid())
  ),
  people as (
    select lp.member_id as id, true as played
      from card
      join public.live_round_players lp on lp.round_id = card.live_round_id
     where card.live_round_id is not null and card.team_card is null
       and lp.member_id is not null and lp.member_id <> card.member_id
    union
    -- 0138: a pair's card in a foursomes or greensomes MATCH — the other side
    -- (a partner can't mark their own side's card, Rule 3.3b).
    select lp.member_id, true
      from card
      join public.live_rounds r on r.id = card.live_round_id
      join public.live_round_players mine on mine.round_id = r.id and mine.member_id = card.member_id
      join public.live_round_players lp on lp.round_id = r.id and lp.side is distinct from mine.side
     where card.team_card is not null and r.scramble_size is null
       and lp.member_id is not null
    union
    -- 0138: a pair's or team's card from a foursomes or scramble DAY — the
    -- other pairs and teams in the day, in the same tee group when the day
    -- has tee times. Never the card's own team.
    select lp.member_id, true
      from card
      join public.live_rounds r on r.id = card.live_round_id
      join public.live_rounds other on other.match_day_id = r.match_day_id and other.id <> r.id
      join public.live_round_players lp on lp.round_id = other.id
     where card.team_card is not null and r.scramble_size is not null and r.match_day_id is not null
       and (r.tee_time is null or other.tee_time is not distinct from r.tee_time)
       and lp.member_id is not null and lp.member_id <> card.member_id
       and not exists (select 1 from public.live_round_players t where t.round_id = r.id and t.member_id = lp.member_id)
    union
    select case when c.requester_id = card.member_id then c.recipient_id else c.requester_id end, false
      from card
      join public.connections c
        on c.status = 'accepted' and (c.requester_id = card.member_id or c.recipient_id = card.member_id)
     where card.live_round_id is null
  )
  select p.id, p.first_name, p.last_name, p.avatar_url, p.avatar_color, people.played
    from people
    join public.profiles p on p.id = people.id and p.deleted_at is null
    cross join card
   where not public.is_blocked(card.member_id, p.id)
   order by p.first_name nulls last, p.last_name nulls last;
$$;

revoke all on function public.scorecard_certify_candidates(bigint) from public, anon, authenticated;
grant execute on function public.scorecard_certify_candidates(bigint) to authenticated;

-- ============ Not for handicaps ============

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
       and s.team_card is null  -- 0138: a pair's or team's card never counts (WHS: individual formats only)
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

-- ============ Results on the society's page ============

alter table public.competition_results
  add column if not exists group_id bigint references public.groups (id) on delete set null;

create index if not exists competition_results_group_idx
  on public.competition_results (group_id, published_at desc) where status = 'published';

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'competition_results' and policyname = 'Group members read their group''s published results') then
    create policy "Group members read their group's published results" on public.competition_results
      for select to authenticated
      using (status = 'published' and group_id is not null and public.is_group_member(group_id, (select auth.uid())));
  end if;
end $$;

-- Which group's page lists the results; null takes them off it.
create or replace function public.competition_results_set_group(p_day_id bigint, p_group_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if not exists (select 1 from public.live_match_days where id = p_day_id and created_by = v_me) then
    raise exception 'Only the organiser can choose where the results are shown' using errcode = '42501';
  end if;
  if p_group_id is not null and (
       not public.is_group_member(p_group_id, v_me)
       or exists (select 1 from public.groups where id = p_group_id and hidden_at is not null)
     ) then
    raise exception 'You can show results on a group you''re in' using errcode = '42501';
  end if;
  insert into public.competition_results (match_day_id, group_id)
  values (p_day_id, p_group_id)
  on conflict (match_day_id) do update set group_id = excluded.group_id, updated_at = now();
end;
$$;

revoke all on function public.competition_results_set_group(bigint, bigint) from public;
revoke execute on function public.competition_results_set_group(bigint, bigint) from anon;
grant execute on function public.competition_results_set_group(bigint, bigint) to authenticated;

-- The group a day most likely belongs to, for the organiser: the event's
-- group when it was started from one, else the organiser's group with the
-- most of the day's players in it (two or more).
create or replace function public.competition_results_group_suggestion(p_day_id bigint)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  with me as (select (select auth.uid()) as id),
  day as (select d.id from public.live_match_days d, me where d.id = p_day_id and d.created_by = me.id)
  select coalesce(
    (select o.group_id from public.society_outings o join day on o.match_day_id = day.id
      where public.is_group_member(o.group_id, (select id from me)) limit 1),
    (select g.id
       from day
       join public.live_rounds r on r.match_day_id = day.id
       join public.live_round_players p on p.round_id = r.id and p.member_id is not null
       join public.group_members gm on gm.member_id = p.member_id
       join public.groups g on g.id = gm.group_id and g.hidden_at is null
      where public.is_group_member(g.id, (select id from me))
      group by g.id
     having count(distinct p.member_id) >= 2
      order by count(distinct p.member_id) desc, g.id
      limit 1)
  );
$$;

revoke all on function public.competition_results_group_suggestion(bigint) from public;
revoke execute on function public.competition_results_group_suggestion(bigint) from anon;
grant execute on function public.competition_results_group_suggestion(bigint) to authenticated;
