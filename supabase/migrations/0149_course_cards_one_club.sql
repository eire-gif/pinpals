-- 0149 — Course cards: read one club at a time (Oct 2026).
--
-- WHY. course_cards / course_card_holes have been readable by any signed-in
-- member as plain tables (0103: "a scorecard is public information printed
-- on every card in the pro shop"). True for a card a member typed in — but
-- the golfapi bulk import (0148) is about to fill them with ~3,300 courses'
-- cards bought from golfapi.io, whose terms require "reasonable measures"
-- against that data being copied out of PinPals. With open tables, one REST
-- call (`select * from course_card_holes`) would hand over all of it.
--
-- WHAT. The same arrangement as the hole maps (0108, course_layout_get):
--
--   course_cards_for_club(club_id)  every card on file for ONE club, with its
--                                   holes, as jsonb. Signed-in members only.
--
-- This migration only ADDS the function, so apps still on the old bundle
-- (reading the tables directly) keep working. 0150 then closes the tables —
-- applied once the app update that uses this function has been published
-- (eas update) and the website is deployed.
--
-- Rollback:
--   drop function if exists public.course_cards_for_club(bigint);

create or replace function public.course_cards_for_club(p_club_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to see course cards' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(
             jsonb_build_object(
               'id', cc.id,
               'tee_name', cc.tee_name,
               'holes', cc.holes,
               'par_total', cc.par_total,
               'course_rating', cc.course_rating,
               'slope', cc.slope,
               'verified_at', cc.verified_at,
               'course_card_holes', coalesce((
                 select jsonb_agg(jsonb_build_object('hole', h.hole, 'par', h.par, 'stroke_index', h.stroke_index, 'yards', h.yards) order by h.hole)
                 from public.course_card_holes h
                 where h.card_id = cc.id
               ), '[]'::jsonb)
             )
             order by cc.tee_name, cc.id
           )
    from public.course_cards cc
    where cc.club_id = p_club_id
  ), '[]'::jsonb);
end;
$$;

comment on function public.course_cards_for_club(bigint) is 'Every course card (tee) on file for one club, with par / stroke index / yards per hole. Signed-in members only. The only read path for course_cards once 0150 closes the tables (golfapi terms: no bulk copying).';

revoke all on function public.course_cards_for_club(bigint) from public, anon;
grant execute on function public.course_cards_for_club(bigint) to authenticated;
