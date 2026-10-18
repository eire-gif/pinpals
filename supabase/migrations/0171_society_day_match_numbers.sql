-- 0171 — A society day can have more than 12 groups (Oct 2026)
--
-- 0104 gave live_rounds.match_number a 1–12 check, written for match days
-- (a dozen matches is plenty). 0121 then reused match_number as the tee
-- group of a society day, where live_fourball_day_create allows up to 40
-- groups — so any day with a 13th group failed with
--   new row for relation "live_rounds" violates check constraint
--   "live_rounds_match_number_check"
-- Found by a 52-player test outing (13 fourballs) on 17 Oct 2026.
--
-- The limit becomes 1–60, the same as team_number and an outing's draw
-- (publish_outing_draw: up to 60 groups). The function's own 40-group cap
-- is unchanged.
--
-- NOT VALID then VALIDATE, so existing rows are checked without a long
-- lock. Applied to production 17 Oct 2026.
--
-- Rollback (only once no round has match_number > 12):
--   alter table public.live_rounds drop constraint live_rounds_match_number_check;
--   alter table public.live_rounds add constraint live_rounds_match_number_check
--     check (match_number is null or match_number between 1 and 12);

alter table public.live_rounds drop constraint if exists live_rounds_match_number_check;
alter table public.live_rounds add constraint live_rounds_match_number_check
  check (match_number is null or match_number between 1 and 60) not valid;
alter table public.live_rounds validate constraint live_rounds_match_number_check;
