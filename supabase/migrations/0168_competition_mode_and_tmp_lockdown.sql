-- 0168 — Competition mode for the hole map, and lock down import scratch tables (Oct 2026)
--
-- 1. live_round_is_competition(round)
--
-- Rule 4.3 / Model Local Rule G-5: in a competition, a distance-measuring
-- device may measure distance but must not be used to work out the effect
-- of wind on a shot or to recommend a club. The hole map shows both
-- ("plays like", the suggested club). The app hides them when this says the
-- round is a competition (mobile/src/lib/competition-mode*.ts).
--
-- A round counts as a competition for everyone in it when its day
-- (live_rounds.match_day_id) is:
--   - a society event's day (society_outings.match_day_id, 0125), or
--   - a day with competition results set up (competition_results, 0137).
-- Friends' group rounds (0121, kind 'fourballs') are not, unless a society
-- event or results sit on them. A member can still switch competition mode
-- on by hand for any round in the app.
--
-- Only someone in the round — its creator or one of its member players —
-- gets an answer; anyone else gets false. It returns a yes/no and nothing
-- else, so it's security definer to see society_outings for guests who
-- aren't in the society.
--
-- 2. Import scratch tables (tmp_*)
--
-- Tables made by hand during the golfapi / OSM imports (tmp_uk_*, tmp_es_*,
-- tmp_golfapi_*) are not in any migration. Four had row level security off
-- and one view ran as its owner, so the public anon key could read and write
-- them, including raw golfapi responses. Applied by hand to production on
-- 17 Oct 2026; repeated here so a rebuild matches. Nothing is deleted: the
-- service role and SQL editor (which the imports use) still have full access.
-- Drop the tables once the imports are finished.
--
-- Rollback:
--   drop function if exists public.live_round_is_competition(bigint);
--   (the tmp_* lockdown has no reason to be undone)

create or replace function public.live_round_is_competition(p_round_id bigint)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce((
    select r.match_day_id is not null and (
             exists (select 1 from public.society_outings o where o.match_day_id = r.match_day_id)
          or exists (select 1 from public.competition_results c where c.match_day_id = r.match_day_id)
           )
      from public.live_rounds r
     where r.id = p_round_id
       and (r.created_by = (select auth.uid())
            or exists (select 1 from public.live_round_players p
                        where p.round_id = r.id and p.member_id = (select auth.uid())))
  ), false);
$function$;

revoke all on function public.live_round_is_competition(bigint) from public, anon;
grant execute on function public.live_round_is_competition(bigint) to authenticated;

comment on function public.live_round_is_competition(bigint) is
  'Hole map competition mode (0168): true when the round is part of a society event or a day with competition results. False for anyone not in the round.';

do $$
declare r record;
begin
  for r in select c.relname, c.relkind
             from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relname like 'tmp\_%' and c.relkind in ('r', 'v', 'S') loop
    if r.relkind = 'r' then
      execute format('alter table public.%I enable row level security', r.relname);
    elsif r.relkind = 'v' then
      execute format('alter view public.%I set (security_invoker = true)', r.relname);
    end if;
    execute format('revoke all on public.%I from anon, authenticated', r.relname);
  end loop;
end $$;
