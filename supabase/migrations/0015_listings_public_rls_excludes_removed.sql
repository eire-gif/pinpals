-- Pinpals: stop a "removed" listing from being publicly readable.
--
-- 0011_listings_status_check.sql introduced the "removed" status for admin
-- moderation and claimed "no RLS change needed... still fetchable by direct
-- link/ID, same as every other non-active status." That claim doesn't hold
-- up: the "listings are readable by everyone" policy from
-- 0003_marketplace.sql is `using (true)` with no status condition at all, so
-- a listing an admin has taken down for a policy violation stays fully
-- readable by anyone — logged out included — who has (or guesses) its
-- numeric id, via both PostgREST directly and src/app/marketplace/[id]/page.tsx
-- (which does `.select("*").eq("id", listingId)` with no status filter).
-- That's the gap this migration closes.
--
-- "reserved" and "sold" are ordinary marketplace states, not moderation
-- states — a real transaction happened — so those stay publicly visible by
-- direct link exactly as before (src/app/marketplace/[id]/page.tsx already
-- shows a "Sale agreed" / "sold" badge and hides the offer UI for those).
-- Only "removed" is excluded, and only for everyone except the listing's own
-- seller: they can still see their own removed listing (so they know what
-- was taken down and why), the same way a suspended member can still see
-- their own profile. Nothing in the admin console is affected — every admin
-- read of `listings` goes through the service-role client
-- (src/lib/supabase/admin.ts), which bypasses RLS entirely.
drop policy if exists "listings are readable by everyone" on public.listings;

create policy "listings are readable unless removed"
  on public.listings for select
  using (status <> 'removed' or auth.uid() = seller_id);
