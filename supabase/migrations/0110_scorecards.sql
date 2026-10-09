-- Scorecards (Oct 2026).
--
-- A member's own card for a round: course, tees, date, and strokes hole by
-- hole. Made two ways:
--
--   from a live round   scorecard_from_live_round(): the caller's own line of
--                       a live round (0103), copied with the round's card.
--                       Run it again and it refreshes, never duplicates.
--   by hand             scorecard_save(): pick a course and tees (a saved
--                       course card fills par, stroke index and yards), or
--                       type the card in, then enter the scores.
--
-- A copy, not a link, for the same reason live rounds copy the course card:
-- correcting a course later must not rewrite a finished round.
--
-- WHO SEES ONE
--
--   private   only its owner
--   pinpals   its owner and their accepted PinPals (the default)
--   members   any signed-in member
--
-- …and never anyone across a block, and nothing once the owner's account is
-- being deleted. The visibility test takes the row's own values and never
-- reads `scorecards` again (see 0052 and
-- claude/incident-listing-creation-rls-returning-bug.md).
--
-- WRITES go through the two functions, which check ownership and shape.
-- The one direct write is DELETE, owner only, by policy: removing a card
-- needs no checks beyond "it's yours", and its holes go with it.
--
-- Totals, points and "vs par" are not stored: the app works them out from
-- the holes (mobile/src/lib/scorecard-math.ts), so an edited hole can't
-- leave a stale total.
--
-- ALSO: course_card_holes gains `yards`, the printed length of each hole
-- from those tees, filled by the provider import (import-golfapi).
--
-- Rollback:
--   alter table public.course_card_holes drop column if exists yards;
--   drop function if exists public.scorecard_save(bigint, jsonb, jsonb);
--   drop function if exists public.scorecard_from_live_round(bigint);
--   drop function if exists public.scorecard_visible_row(uuid, text);
--   drop table if exists public.scorecard_holes, public.scorecards;

alter table public.course_card_holes
  add column if not exists yards smallint check (yards is null or yards between 30 and 800);

create table public.scorecards (
  id bigint generated always as identity primary key,
  member_id uuid not null references public.profiles (id) on delete cascade,
  club_id bigint references public.clubs (id) on delete set null,
  course_name text not null check (char_length(btrim(course_name)) between 1 and 120),
  tee_name text check (tee_name is null or char_length(btrim(tee_name)) between 1 and 40),
  holes smallint not null check (holes in (9, 18)),
  played_on date not null,
  par_total smallint check (par_total is null or par_total between 27 and 80),
  course_rating numeric(4, 1) check (course_rating is null or course_rating between 25 and 85),
  slope smallint check (slope is null or slope between 55 and 155),
  handicap_index numeric(3, 1) check (handicap_index is null or handicap_index between -10 and 54),
  playing_handicap smallint check (playing_handicap is null or playing_handicap between -20 and 80),
  source text not null check (source in ('live', 'manual')),
  live_round_id bigint references public.live_rounds (id) on delete set null,
  visibility text not null default 'pinpals' check (visibility in ('private', 'pinpals', 'members')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index scorecards_one_per_live_round_idx
  on public.scorecards (member_id, live_round_id) where live_round_id is not null;
create index scorecards_member_idx on public.scorecards (member_id, played_on desc, id desc);
create index scorecards_club_idx on public.scorecards (club_id) where club_id is not null;

create table public.scorecard_holes (
  scorecard_id bigint not null references public.scorecards (id) on delete cascade,
  hole smallint not null check (hole between 1 and 18),
  par smallint not null check (par between 3 and 6),
  stroke_index smallint check (stroke_index is null or stroke_index between 1 and 18),
  yards smallint check (yards is null or yards between 30 and 800),
  -- NULL = not entered yet, or no return on the hole.
  strokes smallint check (strokes is null or strokes between 1 and 20),
  putts smallint check (putts is null or putts between 0 and 10),
  primary key (scorecard_id, hole)
);

comment on table public.scorecards is 'A member''s own card for one round, from a live round or entered by hand. Totals are computed from scorecard_holes, never stored. Written via scorecard_save / scorecard_from_live_round; deleted by the owner.';
comment on column public.scorecard_holes.strokes is 'NULL = not entered, or no return on the hole.';

-- ---------------------------------------------------------------------------
-- Who can see one
-- ---------------------------------------------------------------------------

create or replace function public.scorecard_visible_row(p_member uuid, p_visibility text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select (select auth.uid()) is not null
     and (
       p_member = (select auth.uid())
       or (
         p_visibility <> 'private'
         and not public.is_blocked(p_member, (select auth.uid()))
         and exists (select 1 from public.profiles where id = p_member and deleted_at is null)
         and (p_visibility = 'members' or public.are_connected(p_member, (select auth.uid())))
       )
     );
$$;

revoke all on function public.scorecard_visible_row(uuid, text) from public, anon, authenticated;
grant execute on function public.scorecard_visible_row(uuid, text) to authenticated;

alter table public.scorecards enable row level security;
alter table public.scorecard_holes enable row level security;

create policy "Members read scorecards they may see" on public.scorecards
  for select to authenticated using (public.scorecard_visible_row(member_id, visibility));
create policy "Members read the holes of scorecards they may see" on public.scorecard_holes
  for select to authenticated using (exists (select 1 from public.scorecards s where s.id = scorecard_id));
create policy "Members delete their own scorecards" on public.scorecards
  for delete to authenticated using (member_id = (select auth.uid()));

revoke all on public.scorecards, public.scorecard_holes from anon;
revoke insert, update, truncate, references, trigger on public.scorecards, public.scorecard_holes from authenticated;
revoke delete on public.scorecard_holes from authenticated;
grant select, delete on public.scorecards to authenticated;
grant select on public.scorecard_holes to authenticated;

-- ---------------------------------------------------------------------------
-- Writing one by hand (new or edit)
-- ---------------------------------------------------------------------------
--
-- p_card:  { club_id?, course_name, tee_name?, holes: 9|18, played_on,
--            par_total?, course_rating?, slope?, handicap_index?,
--            playing_handicap?, visibility? }
-- p_holes: [{ hole, par, stroke_index?, yards?, strokes?, putts? }], one per hole.
--
-- With p_id, edits that card (yours only). The number of holes can't change
-- on an edit: start a new card instead.

create or replace function public.scorecard_save(p_id bigint, p_card jsonb, p_holes jsonb)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_id bigint := p_id;
  v_holes smallint;
  v_played date;
  v_vis text := coalesce(nullif(p_card ->> 'visibility', ''), 'pinpals');
  v_existing public.scorecards;
begin
  if v_me is null or not exists (select 1 from public.profiles where id = v_me and deleted_at is null) then
    raise exception 'Sign in to save a scorecard' using errcode = '42501';
  end if;
  if jsonb_typeof(p_card) <> 'object' or jsonb_typeof(p_holes) <> 'array' then
    raise exception 'That scorecard is incomplete' using errcode = '22023';
  end if;

  v_holes := (p_card ->> 'holes')::smallint;
  if v_holes not in (9, 18) or jsonb_array_length(p_holes) <> v_holes then
    raise exception 'A scorecard needs one entry for each hole' using errcode = '22023';
  end if;
  if (select count(distinct (h ->> 'hole')::smallint) from jsonb_array_elements(p_holes) h
       where (h ->> 'hole')::smallint between 1 and v_holes) <> v_holes then
    raise exception 'A scorecard needs one entry for each hole' using errcode = '22023';
  end if;

  v_played := (p_card ->> 'played_on')::date;
  if v_played is null or v_played > current_date + 1 or v_played < date '2000-01-01' then
    raise exception 'That date doesn''t look right' using errcode = '22023';
  end if;
  if v_vis not in ('private', 'pinpals', 'members') then
    raise exception 'Choose who can see this card' using errcode = '22023';
  end if;

  if (select count(*) from public.scorecards where member_id = v_me) >= 2000 and v_id is null then
    raise exception 'That''s a lot of scorecards — delete some old ones first' using errcode = 'P0001';
  end if;

  if v_id is not null then
    select * into v_existing from public.scorecards where id = v_id for update;
    if not found or v_existing.member_id <> v_me then
      raise exception 'That scorecard isn''t yours' using errcode = '42501';
    end if;
    if v_existing.holes <> v_holes then
      raise exception 'Start a new card to change the number of holes' using errcode = 'P0001';
    end if;
    update public.scorecards set
      club_id = nullif(p_card ->> 'club_id', '')::bigint,
      course_name = btrim(p_card ->> 'course_name'),
      tee_name = nullif(btrim(coalesce(p_card ->> 'tee_name', '')), ''),
      played_on = v_played,
      par_total = nullif(p_card ->> 'par_total', '')::smallint,
      course_rating = nullif(p_card ->> 'course_rating', '')::numeric,
      slope = nullif(p_card ->> 'slope', '')::smallint,
      handicap_index = nullif(p_card ->> 'handicap_index', '')::numeric,
      playing_handicap = nullif(p_card ->> 'playing_handicap', '')::smallint,
      visibility = v_vis,
      updated_at = now()
    where id = v_id;
  else
    insert into public.scorecards (member_id, club_id, course_name, tee_name, holes, played_on, par_total,
                                   course_rating, slope, handicap_index, playing_handicap, source, visibility)
    values (v_me, nullif(p_card ->> 'club_id', '')::bigint, btrim(p_card ->> 'course_name'),
            nullif(btrim(coalesce(p_card ->> 'tee_name', '')), ''), v_holes, v_played,
            nullif(p_card ->> 'par_total', '')::smallint, nullif(p_card ->> 'course_rating', '')::numeric,
            nullif(p_card ->> 'slope', '')::smallint, nullif(p_card ->> 'handicap_index', '')::numeric,
            nullif(p_card ->> 'playing_handicap', '')::smallint, 'manual', v_vis)
    returning id into v_id;
  end if;

  insert into public.scorecard_holes (scorecard_id, hole, par, stroke_index, yards, strokes, putts)
  select v_id, (h ->> 'hole')::smallint, (h ->> 'par')::smallint,
         nullif(h ->> 'stroke_index', '')::smallint, nullif(h ->> 'yards', '')::smallint,
         nullif(h ->> 'strokes', '')::smallint, nullif(h ->> 'putts', '')::smallint
    from jsonb_array_elements(p_holes) h
  on conflict (scorecard_id, hole) do update set
    par = excluded.par, stroke_index = excluded.stroke_index, yards = excluded.yards,
    strokes = excluded.strokes, putts = excluded.putts;

  return v_id;
end;
$$;

revoke all on function public.scorecard_save(bigint, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.scorecard_save(bigint, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- My line of a live round, as a scorecard
-- ---------------------------------------------------------------------------
--
-- Only your own line: you must be a member player in the round. Running it
-- again (more holes scored since) refreshes the same card. Yards come from
-- the club's saved card for those tees, when there is one.

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
begin
  if v_me is null or not exists (select 1 from public.profiles where id = v_me and deleted_at is null) then
    raise exception 'Sign in to save a scorecard' using errcode = '42501';
  end if;
  select * into v_round from public.live_rounds where id = p_round_id;
  select * into v_player from public.live_round_players where round_id = p_round_id and member_id = v_me;
  if v_round.id is null or v_player.id is null then
    raise exception 'You can only save your own card from a round you played in' using errcode = '42501';
  end if;

  if v_round.club_id is not null then
    select id into v_card_id from public.course_cards
     where club_id = v_round.club_id and holes = v_round.holes
       and lower(btrim(tee_name)) = lower(btrim(coalesce(v_round.tee_name, '')))
     limit 1;
  end if;

  insert into public.scorecards (member_id, club_id, course_name, tee_name, holes, played_on, par_total,
                                 course_rating, slope, handicap_index, playing_handicap, source, live_round_id)
  values (v_me, v_round.club_id, v_round.course_name, v_round.tee_name, v_round.holes, v_round.played_on,
          v_round.par_total, v_round.course_rating, v_round.slope, v_player.handicap_index,
          v_player.playing_handicap, 'live', v_round.id)
  on conflict (member_id, live_round_id) where live_round_id is not null do update set
    tee_name = excluded.tee_name, par_total = excluded.par_total, course_rating = excluded.course_rating,
    slope = excluded.slope, handicap_index = excluded.handicap_index,
    playing_handicap = excluded.playing_handicap, updated_at = now()
  returning id into v_id;

  insert into public.scorecard_holes (scorecard_id, hole, par, stroke_index, yards, strokes)
  select v_id, h.hole, h.par, h.stroke_index,
         (select ch.yards from public.course_card_holes ch where ch.card_id = v_card_id and ch.hole = h.hole),
         s.strokes
    from public.live_round_holes h
    left join public.live_round_scores s on s.player_id = v_player.id and s.hole = h.hole
   where h.round_id = v_round.id
  on conflict (scorecard_id, hole) do update set
    par = excluded.par, stroke_index = excluded.stroke_index,
    yards = coalesce(excluded.yards, public.scorecard_holes.yards), strokes = excluded.strokes;

  return v_id;
end;
$$;

revoke all on function public.scorecard_from_live_round(bigint) from public, anon, authenticated;
grant execute on function public.scorecard_from_live_round(bigint) to authenticated;
