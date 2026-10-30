-- 0197 — Course leaderboards: this week's board, Course Legend, hole champions
-- (Oct 2026, claude/course-boards.md)
--
-- Asked by Eire, 30 Oct 2026 (canvas "PinPals Engagement Features", row 2,
-- approved): every course gets
--
--   1. a WEEKLY LEADERBOARD (Monday to Sunday): each member's best round at
--      the course that week, by Stableford points, net or gross;
--   2. a COURSE LEGEND: whoever has played the course most in 90 days;
--   3. HOLE CHAMPIONS: for each hole, the best net score this month — ties
--      go to whoever did it first.
--
-- Built from members' own scorecards (0110), which every live round now
-- saves for each member when it finishes. A card counts when it's 18 holes
-- at the course with a stroke index on every hole and is either from a
-- finished live round (a blank hole there was picked up: 0 points) or typed
-- in with every hole filled.
--
-- WHO IS SHOWN. Rounds enter automatically, as approved ("turn it off any
-- time in Privacy"), except:
--   - cards set to "Only me" (scorecards.visibility = 'private');
--   - members who switched course boards off (course_board_optouts);
--   - members under 18 (0159) — a junior is never on a public board;
--   - deleted accounts; and anyone either way of a block with the viewer.
-- Only a first name and surname initial, the score and the day are shown:
-- never the card. The handicap shows only for members who show it on their
-- profile (profiles.handicap_visible).
--
-- All three are SECURITY DEFINER functions that return rows, because they
-- rank other members' cards the viewer couldn't otherwise read row by row.
--
-- Rollback:
--   drop function if exists public.course_hole_champions(bigint, date),
--     public.course_legend(bigint), public.course_week_board(bigint, text, date),
--     public.set_course_boards_hidden(boolean), public.course_board_holes(bigint, date, date);
--   drop table if exists public.course_board_optouts;

-- ===========================================================================
-- 1. Switching it off
-- ===========================================================================

create table if not exists public.course_board_optouts (
  member_id uuid primary key references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.course_board_optouts is
  'Members who keep their rounds off course leaderboards, Course Legend and hole champions (0197).';

alter table public.course_board_optouts enable row level security;
revoke all on public.course_board_optouts from anon;
revoke insert, update, delete, truncate, references, trigger on public.course_board_optouts from authenticated;
grant select on public.course_board_optouts to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'course_board_optouts' and policyname = 'Members read their own course board setting') then
    create policy "Members read their own course board setting" on public.course_board_optouts
      for select to authenticated using (member_id = (select auth.uid()));
  end if;
end $$;

create or replace function public.set_course_boards_hidden(p_hidden boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if p_hidden then
    insert into public.course_board_optouts (member_id) values (me) on conflict do nothing;
  else
    delete from public.course_board_optouts where member_id = me;
  end if;
end;
$$;

revoke all on function public.set_course_boards_hidden(boolean) from public, anon, authenticated;
grant execute on function public.set_course_boards_hidden(boolean) to authenticated;

-- ===========================================================================
-- 2. Every counting hole at a course between two dates (internal)
-- ===========================================================================

-- One row per hole of every card that counts: the card, its member, the
-- day, par, strokes (null = picked up), the shots received and the points.
-- Shots are handed out by rank of stroke index, hardest first, exactly as
-- live-scoring.ts shotsByHole() does (plus handicaps give back on the
-- easiest holes).
create or replace function public.course_board_holes(p_club_id bigint, p_from date, p_to date)
returns table (
  scorecard_id bigint,
  member_id uuid,
  played_on date,
  created_at timestamptz,
  playing_handicap smallint,
  hole smallint,
  par smallint,
  strokes smallint,
  shots integer,
  points integer
)
language sql
stable
security definer
set search_path = public
as $$
  with cards as (
    select s.id, s.member_id, s.played_on, s.created_at, s.playing_handicap, s.source, s.live_round_id
      from public.scorecards s
      join public.profiles pr on pr.id = s.member_id and pr.deleted_at is null
     where s.club_id = p_club_id
       and s.holes = 18
       and s.played_on between p_from and p_to
       and s.visibility <> 'private'
       and s.playing_handicap is not null
       and not exists (select 1 from public.course_board_optouts o where o.member_id = s.member_id)
       and not public.is_minor(s.member_id)
       and not public.is_blocked(s.member_id, (select auth.uid()))
  ),
  complete as (
    select c.*
      from cards c
     where (select count(*) from public.scorecard_holes h where h.scorecard_id = c.id and h.stroke_index is not null) = 18
       and (
         (c.source = 'live' and exists (select 1 from public.live_rounds r where r.id = c.live_round_id and r.status = 'finished'))
         or (select count(*) from public.scorecard_holes h where h.scorecard_id = c.id and h.strokes is not null) = 18
       )
  ),
  ranked as (
    select c.id, c.member_id, c.played_on, c.created_at, c.playing_handicap, h.hole, h.par, h.strokes,
           row_number() over (partition by c.id order by h.stroke_index, h.hole) as rk
      from complete c
      join public.scorecard_holes h on h.scorecard_id = c.id
  ),
  shot as (
    select r.*,
           (trunc(r.playing_handicap / 18.0))::int
             + case
                 when r.playing_handicap >= 0 and r.rk <= abs(r.playing_handicap % 18) then 1
                 when r.playing_handicap < 0 and r.rk > 18 - abs(r.playing_handicap % 18) then -1
                 else 0
               end as s
      from ranked r
  )
  select id, member_id, played_on, created_at, playing_handicap, hole, par, strokes, s,
         case when strokes is null then 0 else greatest(0, par + 2 + s - strokes) end
    from shot;
$$;

revoke all on function public.course_board_holes(bigint, date, date) from public, anon, authenticated;

-- ===========================================================================
-- 3. This week's board
-- ===========================================================================

-- p_metric: 'stableford' (most points), 'net' (net to par) or 'gross'.
-- p_week: any day of the week wanted; null = this week. Best round per
-- member, top 50, plus the viewer's own row if they're further down.
create or replace function public.course_week_board(p_club_id bigint, p_metric text default 'stableford', p_week date default null)
returns table (
  place integer,
  member_id uuid,
  first_name text,
  last_initial text,
  avatar_url text,
  avatar_color text,
  handicap numeric,
  played_on date,
  points integer,
  gross integer,
  net_to_par integer,
  is_me boolean,
  players integer,
  week_start date
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_start date := date_trunc('week', coalesce(p_week, (now() at time zone 'Europe/Dublin')::date))::date;
  v_metric text := coalesce(nullif(p_metric, ''), 'stableford');
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if v_metric not in ('stableford', 'net', 'gross') then
    raise exception 'Choose Stableford, net or gross' using errcode = '22023';
  end if;
  return query
  with holes as (
    select * from public.course_board_holes(p_club_id, v_start, v_start + 6)
  ),
  cards as (
    select h.scorecard_id, h.member_id, h.played_on, h.created_at,
           sum(h.points)::int as pts,
           sum(coalesce(h.strokes, h.par + 2 + h.shots))::int as grs,
           sum(coalesce(h.strokes, h.par + 2 + h.shots) - h.shots - h.par)::int as ntp
      from holes h
     group by h.scorecard_id, h.member_id, h.played_on, h.created_at
  ),
  best as (
    select distinct on (c.member_id) c.*
      from cards c
     order by c.member_id,
              case v_metric when 'stableford' then -c.pts when 'net' then c.ntp else c.grs end,
              c.played_on, c.created_at
  ),
  ranked as (
    select b.*,
           (rank() over (order by case v_metric when 'stableford' then -b.pts when 'net' then b.ntp else b.grs end))::int as pos,
           (row_number() over (order by case v_metric when 'stableford' then -b.pts when 'net' then b.ntp else b.grs end, b.played_on, b.created_at))::int as rn,
           (count(*) over ())::int as n
      from best b
  )
  select r.pos, r.member_id, pr.first_name, left(coalesce(pr.last_name, ''), 1),
         pr.avatar_url, pr.avatar_color,
         case when pr.handicap_visible then pr.handicap else null end,
         r.played_on, r.pts, r.grs, r.ntp,
         r.member_id = (select auth.uid()), r.n, v_start
    from ranked r
    join public.profiles pr on pr.id = r.member_id
   where r.rn <= 50 or r.member_id = (select auth.uid())
   order by r.rn;
end;
$$;

revoke all on function public.course_week_board(bigint, text, date) from public, anon, authenticated;
grant execute on function public.course_week_board(bigint, text, date) to authenticated;

-- ===========================================================================
-- 4. Course Legend: most rounds here in 90 days
-- ===========================================================================

-- Any card at the course counts here (9 or 18 holes, finished or not) —
-- this is about turning up, not scoring. Same who-is-shown rules.
create or replace function public.course_legend(p_club_id bigint)
returns table (
  member_id uuid,
  first_name text,
  last_initial text,
  avatar_url text,
  avatar_color text,
  rounds integer,
  my_rounds integer,
  is_me boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with counted as (
    select s.member_id, count(distinct s.played_on)::int as n, min(s.created_at) as first_at
      from public.scorecards s
      join public.profiles pr on pr.id = s.member_id and pr.deleted_at is null
     where s.club_id = p_club_id
       and s.played_on > (now() at time zone 'Europe/Dublin')::date - 90
       and s.visibility <> 'private'
       and not exists (select 1 from public.course_board_optouts o where o.member_id = s.member_id)
       and not public.is_minor(s.member_id)
       and not public.is_blocked(s.member_id, (select auth.uid()))
     group by s.member_id
  ),
  mine as (
    select count(distinct s.played_on)::int as n
      from public.scorecards s
     where s.club_id = p_club_id
       and s.member_id = (select auth.uid())
       and s.played_on > (now() at time zone 'Europe/Dublin')::date - 90
  ),
  top as (
    select * from counted order by n desc, first_at limit 1
  )
  select t.member_id, pr.first_name, left(coalesce(pr.last_name, ''), 1), pr.avatar_url, pr.avatar_color,
         t.n, (select n from mine), t.member_id = (select auth.uid())
    from top t
    join public.profiles pr on pr.id = t.member_id
   where (select auth.uid()) is not null;
$$;

revoke all on function public.course_legend(bigint) from public, anon, authenticated;
grant execute on function public.course_legend(bigint) to authenticated;

-- ===========================================================================
-- 5. Hole champions: the best net score on each hole this month
-- ===========================================================================

-- p_month: any day in the month wanted; null = this month. net_to_par is
-- strokes − shots − par (−1 a net birdie). Ties go to whoever did it first;
-- `tied` says how many matched it.
create or replace function public.course_hole_champions(p_club_id bigint, p_month date default null)
returns table (
  hole smallint,
  member_id uuid,
  first_name text,
  last_initial text,
  net_to_par integer,
  played_on date,
  tied integer,
  is_me boolean,
  month_start date
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_start date := date_trunc('month', coalesce(p_month, (now() at time zone 'Europe/Dublin')::date))::date;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  return query
  with holes as (
    select h.*, (h.strokes - h.shots - h.par)::int as ntp
      from public.course_board_holes(p_club_id, v_start, (v_start + interval '1 month' - interval '1 day')::date) h
     where h.strokes is not null
  ),
  best as (
    select h.hole as hn, min(h.ntp) as b from holes h group by h.hole
  ),
  winners as (
    select distinct on (h.hole) h.hole as hn, h.member_id as mid, h.ntp, h.played_on as pd,
           (select count(distinct h2.member_id) from holes h2 where h2.hole = h.hole and h2.ntp = h.ntp)::int as t
      from holes h
      join best b on b.hn = h.hole and b.b = h.ntp
     order by h.hole, h.played_on, h.created_at
  )
  select w.hn, w.mid, pr.first_name, left(coalesce(pr.last_name, ''), 1), w.ntp, w.pd, w.t,
         w.mid = (select auth.uid()), v_start
    from winners w
    join public.profiles pr on pr.id = w.mid
   order by w.hn;
end;
$$;

revoke all on function public.course_hole_champions(bigint, date) from public, anon, authenticated;
grant execute on function public.course_hole_champions(bigint, date) to authenticated;
