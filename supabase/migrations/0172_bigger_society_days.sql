-- 0172 — Bigger society days: 100 pairs or teams, 60 tee groups (Oct 2026)
--
-- Asked by Eire (18 Oct 2026) for a 130-player foursomes test, which is
-- 65 pairs — over the 60 that a pairs/team day allowed.
--
--   live_scramble_day_create   (scramble and foursomes days)  60 → 100 teams
--   live_rounds.team_number                                 1–60 → 1–100
--   live_fourball_day_create   (individual society days)   40 → 60 groups
--                              (match_number already allows 60, 0171)
--
-- A 100-pair foursomes day is 50 tee groups, which still fits the outing
-- draw (publish_outing_draw: 60 groups). Match days stay at 40 matches.
--
-- The two functions are long; only their size check changes, so they are
-- rewritten from their current definition with the one number replaced, and
-- the migration refuses to run if that text isn't found exactly once.
-- CREATE OR REPLACE keeps their grants.
--
-- Applied to production 18 Oct 2026.
--
-- Rollback: the same replacement the other way (100 → 60, 60 → 40), and
--   team_number back to 1–60 once no round uses more.

do $$
declare
  d text;
  fix record;
begin
  for fix in
    select * from (values
      ('public.live_scramble_day_create(jsonb,jsonb,jsonb)', 'jsonb_array_length(p_teams) not between 1 and 60', 'jsonb_array_length(p_teams) not between 1 and 100'),
      ('public.live_fourball_day_create(jsonb,jsonb,jsonb)', 'jsonb_array_length(p_groups) not between 1 and 40', 'jsonb_array_length(p_groups) not between 1 and 60')
    ) as t(fn, old_text, new_text)
  loop
    d := pg_get_functiondef(fix.fn::regprocedure);
    if (length(d) - length(replace(d, fix.old_text, ''))) / length(fix.old_text) <> 1 then
      raise exception '0172: expected "%" once in %', fix.old_text, fix.fn;
    end if;
    execute replace(d, fix.old_text, fix.new_text);
  end loop;
end $$;

alter table public.live_rounds drop constraint if exists live_rounds_team_number_check;
alter table public.live_rounds add constraint live_rounds_team_number_check
  check (team_number is null or team_number between 1 and 100) not valid;
alter table public.live_rounds validate constraint live_rounds_team_number_check;
