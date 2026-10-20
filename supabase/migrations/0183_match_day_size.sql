-- 0183 — A match day can have up to 60 matches (Oct 2026)
--
-- Found by the 130-player Testing society day on 20 Oct 2026: 33 Blues v
-- Golds fourball matches, and "Start the matches" failed with
--   A match day has between 1 and 12 matches
--
-- live_match_day_create (0104, 0121, patched by 0176) still allowed only 12
-- matches, though the app's group-round screen allowed 40 and 0171 already
-- lets live_rounds.match_number run to 60. The limit becomes 1–60, the same
-- as match_number, the fourball day's groups and an outing's draw. The app
-- limits are raised to match (group round 60 matches, manual match day 60,
-- scramble day 100 teams like live_scramble_day_create).
--
-- The function is long, so it is rewritten from its current definition with
-- the one check changed; the migration refuses to run unless the text it
-- looks for is found exactly once. CREATE OR REPLACE keeps its grants.
--
-- Applied to production 20 Oct 2026.
--
-- Rollback (only once no match day has more than 12 matches): the same
-- replacement the other way.

do $$
declare
  d text;
  fn constant text := 'public.live_match_day_create(jsonb,jsonb,jsonb)';
  old_check constant text := 'jsonb_array_length(p_matches) not between 1 and 12 then';
  new_check constant text := 'jsonb_array_length(p_matches) not between 1 and 60 then';
  old_msg constant text := 'A match day has between 1 and 12 matches';
  new_msg constant text := 'A match day has between 1 and 60 matches';
begin
  d := pg_get_functiondef(fn::regprocedure);
  if (length(d) - length(replace(d, old_check, ''))) / length(old_check) <> 1 then
    raise exception '0183: expected "%" once in %', old_check, fn;
  end if;
  if (length(d) - length(replace(d, old_msg, ''))) / length(old_msg) <> 1 then
    raise exception '0183: expected "%" once in %', old_msg, fn;
  end if;
  execute replace(replace(d, old_check, new_check), old_msg, new_msg);
end $$;
