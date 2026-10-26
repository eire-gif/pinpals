-- Plus handicaps at exactly .5 round towards zero (Oct 2026, claude/whs-handicaps.md).
--
-- WHS rounds halves up, and the R&A (Rules of Handicapping, Appendix C) has a
-- plus handicap move "up towards zero including rounding": +2.5 (−2.5) → +2
-- (−2). Postgres round() on numeric rounds halves AWAY from zero (−2.5 → −3),
-- so the course handicap behind net double bogey in the handicap indicator
-- disagreed with the app (live-scoring.ts roundHalfUp) for a plus index that
-- lands on an exact .5. floor(x + 0.5) is half-up for every sign.
--
-- handicap_differentials_of as in 0138, that one expression changed; the
-- grants are unchanged (still none — read only through handicap_indicator_of
-- and the society Handicaps screen's definer functions).

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
  -- Course handicap for the card's tees (WHS), from the index played off,
  -- halves rounded UP (0192): a plus .5 goes towards zero (+2.5 → +2), as
  -- R&A Appendix C and the app's live-scoring.ts roundHalfUp.
  ch as (
    select r.*,
           case when r.idx is null then null
                else floor(r.idx * r.slope / 113.0 + (r.course_rating - r.par) + 0.5)::int end as course_hcp
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
