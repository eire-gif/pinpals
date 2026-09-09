-- Restore 'review' to reports.target_type, dropped by the 0048-0055 catch-up.
--
-- Phase 26 (0056_marketplace_notifications_reviews.sql) widened this
-- constraint to include 'review' so a member could report another member's
-- review. Its SQL was applied to production directly, but its migration file
-- never landed in the repo, so when 0055_marketplace_trust_safety.sql was
-- replayed during the catch-up it re-ran its own
--   drop constraint if exists reports_target_type_check;
--   add constraint ... check (target_type in (..., 'order'));
-- pair against a database that was already past it, silently narrowing the
-- constraint back and taking 'review' out with it.
--
-- Nothing failed at the time: `reports` has no rows, and the app code that
-- files a review report is itself part of phase 26 and was not yet deployed.
-- It would have failed the first time anyone clicked "Report this review"
-- after phase 26 shipped — a constraint violation on an otherwise valid
-- action.
--
-- This is deliberately a new forward migration rather than a re-run of 0056:
-- 0056's body is already fully applied in production (verified object by
-- object — notification_preferences, notifications.dedupe_key, the
-- 6-argument notify_user(), reviews.hidden_*, review_is_visible(),
-- seller_rating_summaries, notify_seller_of_new_offer(), apply_new_bid()'s
-- outbid branch, run_auction_sweeps(), and the "Reviews are publicly
-- readable unless hidden" policy are all present and correct), and this
-- constraint was the single item the catch-up regressed.
--
-- On a fresh database replayed in order this is a harmless no-op: 0056 two
-- files earlier already sets exactly this constraint.
--
-- Rollback:
--   alter table public.reports drop constraint if exists reports_target_type_check;
--   alter table public.reports add constraint reports_target_type_check
--     check (target_type in ('user', 'listing', 'tee_time_invite', 'message', 'conversation', 'order'));

alter table public.reports drop constraint if exists reports_target_type_check;
alter table public.reports add constraint reports_target_type_check
  check (target_type in ('user', 'listing', 'tee_time_invite', 'message', 'conversation', 'order', 'review'));
