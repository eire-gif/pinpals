-- 0154_longest_shots.sql — Longest shots, per club (Oct 2026).
--
-- A shot the player marks on the hole map and tags with a club ("Which
-- club?") already keeps its distance (0153). This reads those back as the
-- member's longest shot with each club: for one round (shown under the
-- scorecard made from it) or ever (on My bag). Only the caller's own shots.
--
-- Rollback:
--   drop function if exists public.my_longest_shots(bigint);

create or replace function public.my_longest_shots(p_round_id bigint default null)
returns table (club text, distance_m numeric, round_id bigint, hole smallint, shot_no smallint, played_on date, course_name text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (s.club)
         s.club, s.club_distance_m, s.round_id, s.hole, s.shot_no, r.played_on, r.course_name
    from public.live_round_shots s
    join public.live_round_players p on p.id = s.player_id and p.round_id = s.round_id
    join public.live_rounds r on r.id = s.round_id
   where p.member_id = (select auth.uid())
     and s.club is not null
     and s.club_distance_m is not null
     and (p_round_id is null or s.round_id = p_round_id)
   order by s.club, s.club_distance_m desc, r.played_on desc, s.id desc;
$$;

revoke all on function public.my_longest_shots(bigint) from public, anon;
grant execute on function public.my_longest_shots(bigint) to authenticated;
