-- Expands offers.status to the fuller offer lifecycle requested for the
-- marketplace schema (pending, countered, accepted, declined, withdrawn,
-- expired), superset-only: every value the live app currently writes
-- (pending / accepted / declined, from makeOffer()/respondToOffer() in
-- src/app/marketplace/[id]/actions.ts) stays allowed and the column default
-- ('pending') is unchanged. The three new values are unused by any code path
-- yet — they're schema-only groundwork for a later phase (counter-offers,
-- buyer withdrawal, offer expiry), per "Do not build UI in this phase".
--
-- Rollback: re-run this migration's DROP with the previous 3-value list:
--   alter table public.offers drop constraint offers_status_check;
--   alter table public.offers add constraint offers_status_check
--     check (status in ('pending', 'accepted', 'declined'));
-- Safe only if no row has since taken one of the 3 new values.

alter table public.offers drop constraint if exists offers_status_check;
alter table public.offers add constraint offers_status_check
  check (status in ('pending', 'countered', 'accepted', 'declined', 'withdrawn', 'expired'));
