-- Pinpals: a tee_times notification preference category
--
-- Adds 'tee_times' to notification_preferences.category, so a member can
-- turn off "one of my connections posted a tee time" email without losing
-- messages, offers, auctions or reviews.
--
-- This one needs its own off switch more than any category before it. Every
-- existing notification is one-to-one and transactional — someone messaged
-- YOU, someone bid on YOUR listing, YOUR payment succeeded. This is the
-- first broadcast: one member posting availability emails all of their
-- accepted connections at once. A member with fifty connections who plays
-- twice a week is, from the other end, fifty inboxes receiving two emails a
-- week from one person. That is exactly the kind of notification people need
-- to be able to silence, and 0056's own design note — that the four
-- optional categories exist because their traffic is not something a member
-- must be forced to receive — applies to it more strongly than to any of
-- them.
--
-- It joins the OPTIONAL set, not the transactional one: 'payments' and
-- 'disputes_refunds' are deliberately unrepresentable in this table so that
-- money-related email cannot be silenced by app code that forgets to check.
-- A tee time is not money.
--
-- Defaults stay as they are: no stored row means enabled, so every existing
-- member starts opted in and can opt out. Nothing is backfilled.
--
-- Rollback:
--   delete from public.notification_preferences where category = 'tee_times';
--   alter table public.notification_preferences drop constraint if exists notification_preferences_category_check;
--   alter table public.notification_preferences
--     add constraint notification_preferences_category_check
--     check (category in ('messages', 'offers', 'auctions', 'reviews'));

alter table public.notification_preferences
  drop constraint if exists notification_preferences_category_check;

alter table public.notification_preferences
  add constraint notification_preferences_category_check
  check (category in ('messages', 'offers', 'auctions', 'reviews', 'tee_times'));
