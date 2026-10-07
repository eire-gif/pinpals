-- Match days (Oct 2026): several matches at once, in teams.
--
-- A society or a group of friends plays several matches on the same day at
-- the same course: singles, fourball (better ball), foursomes or greensomes,
-- each in its own group, often with two teams keeping a running score
-- (Blues 2½ – Golds 1½). Every player sees every match on one board, and
-- scores the match they are in.
--
-- SHAPE
--
--   live_match_days  the day: course, tees, card details, optional team names.
--   live_rounds      each MATCH is a live round (0103) with match_day_id set,
--                    its match number and tee time, format 'matchplay' and a
--                    match_type: singles, fourball, foursomes or greensomes.
--                    Players' `side` (0103) is the team: 1 or 2.
--
-- Why match_type instead of more values in live_rounds.format: widening that
-- CHECK means dropping and re-adding it, and a migration with a drop in it
-- can't be applied through the Supabase tool this project uses (it cancels
-- the batch waiting for a confirmation that never arrives — see
-- claude/live-scoring.md). 'matchplay' + match_type says the same thing.
--
-- Points, hole results and team totals are computed on the phone by
-- src/lib/live-scoring.ts (teamMatchState, matchPoints), never stored.
--
-- WHO CAN DO WHAT
--
--   See:   everyone playing in any match of the day, and its organiser —
--          every match, so the board can show them all.
--   Score: the players in THAT match, the round's creator, and the day's
--          organiser (who can fix a mis-tap for a group without the app).
--          Not other matches' players: you score the game you're in.
--   Add:   the organiser can put themselves, their accepted PinPals and
--          guests by name on the card — never a stranger, never across a
--          block — and nobody in two matches on the same day.
--
-- LIVE
--
--   Score and card changes now also ping live-day-<id>, so the board
--   updates as any group scores. Same "go re-fetch" rule as 0103.
--
-- NOTIFICATIONS are sent by the website (src/lib/live-match-notifications.ts)
-- after the app starts a day or finishes a match, because push and email
-- delivery and notification preferences live in TypeScript (notifyUser).
--
-- APPLIED to production on 7 Oct 2026 in five parts (0104a…0104e in
-- supabase_migrations), comment-free, as 0103 was. The parts add up to
-- exactly this file.
--
-- Rollback (nothing here drops anything; to undo):
--   drop function if exists public.live_match_day_create(jsonb, jsonb, jsonb);
--   drop policy if exists "Players receive their match day broadcasts" on realtime.messages;
--   drop function if exists public.realtime_live_day_id(text);
--   alter table public.live_rounds drop column if exists match_day_id, drop column if exists match_number,
--     drop column if exists match_type, drop column if exists tee_time;
--   drop table if exists public.live_match_days;
--   drop function if exists public.can_view_match_day(bigint), public.can_score_live_round(bigint);
--   then re-run 0103's definitions of can_view_live_round, live_round_set_score,
--   live_round_set_hole, live_round_finish and live_round_broadcast.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.live_match_days (
  id bigint generated always as identity primary key,
  created_by uuid references public.profiles (id) on delete set null,
  title text not null check (char_length(btrim(title)) between 1 and 80),
  club_id bigint references public.clubs (id) on delete set null,
  course_name text not null check (char_length(btrim(course_name)) between 1 and 120),
  tee_name text check (tee_name is null or char_length(btrim(tee_name)) between 1 and 40),
  holes smallint not null default 18 check (holes in (9, 18)),
  course_rating numeric(4, 1) check (course_rating is null or course_rating between 25 and 85),
  slope smallint check (slope is null or slope between 55 and 155),
  par_total smallint check (par_total is null or par_total between 27 and 80),
  -- Null: no team totals. Otherwise exactly two names, side 1 then side 2.
  team_names text[] check (
    team_names is null
    or (array_length(team_names, 1) = 2
        and char_length(btrim(team_names[1])) between 1 and 30
        and char_length(btrim(team_names[2])) between 1 and 30)
  ),
  played_on date not null default current_date,
  created_at timestamptz not null default now()
);

create index live_match_days_created_by_idx on public.live_match_days (created_by, created_at desc);

alter table public.live_rounds
  add column match_day_id bigint references public.live_match_days (id) on delete cascade,
  add column match_number smallint check (match_number is null or match_number between 1 and 12),
  add column match_type text check (match_type is null or match_type in ('singles', 'fourball', 'foursomes', 'greensomes')),
  add column tee_time time;

alter table public.live_rounds
  add constraint live_rounds_match_type_is_matchplay check (match_type is null or format = 'matchplay');

create index live_rounds_match_day_idx on public.live_rounds (match_day_id) where match_day_id is not null;

comment on table public.live_match_days is 'Match day: several matches (live_rounds with match_day_id) at one course, optionally between two named teams. Written only via live_match_day_create().';
comment on column public.live_rounds.match_type is 'For a match: singles, fourball, foursomes or greensomes (format is then matchplay). Null for an ordinary round.';

alter table public.live_match_days enable row level security;
revoke insert, update, delete, truncate, references, trigger on public.live_match_days from authenticated;
revoke all on public.live_match_days from anon;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

create or replace function public.can_view_match_day(p_day_id bigint)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select (select auth.uid()) is not null
     and exists (
       select 1 from public.live_match_days d
        where d.id = p_day_id
          and (
            d.created_by = (select auth.uid())
            or exists (
              select 1
                from public.live_rounds r
                join public.live_round_players p on p.round_id = r.id
               where r.match_day_id = d.id and p.member_id = (select auth.uid())
            )
          )
     );
$$;

revoke all on function public.can_view_match_day(bigint) from public;
revoke execute on function public.can_view_match_day(bigint) from anon;
grant execute on function public.can_view_match_day(bigint) to authenticated;

create policy "Players read their match days" on public.live_match_days
  for select to authenticated using (public.can_view_match_day(id));

-- Seeing a round: as 0103, plus anyone who can see its match day.
create or replace function public.can_view_live_round(p_round_id bigint)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select (select auth.uid()) is not null
     and exists (
       select 1
         from public.live_rounds r
        where r.id = p_round_id
          and (
            r.created_by = (select auth.uid())
            or exists (
              select 1 from public.live_round_players p
               where p.round_id = r.id and p.member_id = (select auth.uid())
            )
            or (r.match_day_id is not null and public.can_view_match_day(r.match_day_id))
          )
     );
$$;

-- Scoring a round: its creator, its own players, and its match day's
-- organiser. Narrower than seeing it.
create or replace function public.can_score_live_round(p_round_id bigint)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select (select auth.uid()) is not null
     and exists (
       select 1
         from public.live_rounds r
         left join public.live_match_days d on d.id = r.match_day_id
        where r.id = p_round_id
          and (
            r.created_by = (select auth.uid())
            or d.created_by = (select auth.uid())
            or exists (
              select 1 from public.live_round_players p
               where p.round_id = r.id and p.member_id = (select auth.uid())
            )
          )
     );
$$;

revoke all on function public.can_score_live_round(bigint) from public;
revoke execute on function public.can_score_live_round(bigint) from anon;
grant execute on function public.can_score_live_round(bigint) to authenticated;

-- The three writes now ask "may you score this round", not "may you see it".
create or replace function public.live_round_set_score(
  p_round_id bigint,
  p_player_id bigint,
  p_hole smallint,
  p_strokes smallint,
  p_clear boolean default false
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
  if not exists (select 1 from public.live_round_holes where round_id = p_round_id and hole = p_hole) then
    raise exception 'No such hole in this round' using errcode = '22023';
  end if;

  if p_clear then
    delete from public.live_round_scores where player_id = p_player_id and hole = p_hole;
  else
    insert into public.live_round_scores (player_id, hole, round_id, strokes, entered_by)
    values (p_player_id, p_hole, p_round_id, p_strokes, (select auth.uid()))
    on conflict (player_id, hole) do update
      set strokes = excluded.strokes, entered_by = excluded.entered_by, updated_at = now();
  end if;
end;
$$;

create or replace function public.live_round_set_hole(p_round_id bigint, p_hole smallint, p_par smallint, p_stroke_index smallint)
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
  update public.live_round_holes set par = p_par, stroke_index = p_stroke_index
   where round_id = p_round_id and hole = p_hole;
  if not found then
    raise exception 'No such hole in this round' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.live_round_finish(p_round_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_score_live_round(p_round_id) then
    raise exception 'Not your round' using errcode = '42501';
  end if;
  update public.live_rounds set status = 'finished', finished_at = now()
   where id = p_round_id and status = 'live';
end;
$$;

-- ---------------------------------------------------------------------------
-- Live pings: also to the match day's board
-- ---------------------------------------------------------------------------

create or replace function public.realtime_live_day_id(topic text)
returns bigint
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case when topic ~ '^live-day-[0-9]{1,18}$' then substring(topic from 10)::bigint else null end;
$$;

revoke all on function public.realtime_live_day_id(text) from public;
grant execute on function public.realtime_live_day_id(text) to authenticated;

create policy "Players receive their match day broadcasts"
on realtime.messages
for select
to authenticated
using (
  extension = 'broadcast'
  and public.realtime_live_day_id(topic) is not null
  and public.can_view_match_day(public.realtime_live_day_id(topic))
);

create or replace function public.live_round_broadcast()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round bigint := case when tg_op = 'DELETE' then old.round_id else new.round_id end;
  v_day bigint;
begin
  begin
    perform realtime.send(jsonb_build_object('round_id', v_round, 'table', tg_table_name), 'changed', 'live-round-' || v_round, true);
    select match_day_id into v_day from public.live_rounds where id = v_round;
    if v_day is not null then
      perform realtime.send(jsonb_build_object('round_id', v_round, 'day_id', v_day), 'changed', 'live-day-' || v_day, true);
    end if;
  exception when others then
    null;
  end;
  return null;
end;
$$;

create or replace function public.live_round_status_broadcast()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform realtime.send(jsonb_build_object('round_id', new.id, 'table', 'live_rounds'), 'changed', 'live-round-' || new.id, true);
    if new.match_day_id is not null then
      perform realtime.send(jsonb_build_object('round_id', new.id, 'day_id', new.match_day_id), 'changed', 'live-day-' || new.match_day_id, true);
    end if;
  exception when others then
    null;
  end;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Starting a match day
-- ---------------------------------------------------------------------------

-- p_day:     {title, course_name, club_id?, tee_name?, holes, course_rating?,
--             slope?, par_total?, team_names?: [a, b]}
-- p_matches: [{match_type, tee_time?, players: [{member_id?, name,
--             handicap_index, course_handicap, playing_handicap,
--             handicap_estimated, side}]}]   in match order
-- p_card:    [{hole, par, stroke_index?}] one per hole, copied to every match
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
