-- Listings: constrain `status` values, and add "removed" for admin moderation.
--
-- `listings.status` has existed since the marketplace migration with no check
-- constraint at all — every other status column in this schema (offers,
-- tee_time_invites, tee_time_interests, connections, staff_roles,
-- admin_audit_log) has one. This closes that gap and, in the same migration,
-- adds the one new value Phase 3's listing.hide/listing.restore actions need:
-- "removed" — a listing an admin has taken down, distinct from "reserved"/
-- "sold" (which mean a real transaction happened) and from the seller's own
-- delete (which removes the row entirely rather than just hiding it).
--
-- No RLS change needed: the public browse query already does
-- `.eq("status", "active")` in src/app/marketplace/page.tsx, so "removed"
-- drops out of browse results the same way "reserved"/"sold" already do —
-- still fetchable by direct link/ID, same as every other non-active status.
alter table public.listings
  add constraint listings_status_check
  check (status = any (array['active', 'reserved', 'sold', 'removed']));
