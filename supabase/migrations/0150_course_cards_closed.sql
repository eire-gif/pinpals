-- 0150 — Course cards: close the tables (Oct 2026).
--
-- Second half of 0149. APPLY ONLY AFTER the app update that reads cards
-- through course_cards_for_club() has been published (eas update) and the
-- website using it is deployed — an older app bundle reads the tables
-- directly and would see no cards until it updates.
--
-- After this, members read cards only one club at a time, through
-- course_cards_for_club(); they write only through course_card_save() (as
-- before). The tables keep RLS on with no policies, like course_layouts
-- (0108). Security-definer functions (course_card_save,
-- scorecard_from_live_round, golfapi_bulk_next) and the importer (service
-- role) are unaffected.
--
-- Applied to production 15 Oct 2026 as the REVOKE only: the Supabase tool
-- cancels any batch containing DROP, so the two now-inert policies are still
-- there (with no SELECT grant they open nothing) — drop them by hand in the
-- SQL editor when convenient.
--
-- Rollback (re-opens them):
--   create policy "Members read course cards" on public.course_cards for select to authenticated using (true);
--   create policy "Members read course card holes" on public.course_card_holes for select to authenticated using (true);
--   grant select on public.course_cards, public.course_card_holes to authenticated;

drop policy if exists "Members read course cards" on public.course_cards;
drop policy if exists "Members read course card holes" on public.course_card_holes;

revoke all on public.course_cards, public.course_card_holes from anon, authenticated;

comment on table public.course_cards is 'A course''s card per tee: rating, slope and (in course_card_holes) par and stroke index per hole. Read only via course_cards_for_club() (one club per call — golfapi terms, 0149/0150); written only via course_card_save() and the golfapi importer.';
