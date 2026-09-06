-- Two additive changes to `listings`:
--
-- 1. Expand listings.status to the full requested listing lifecycle (draft,
--    pending_review, active, reserved, sold, expired, removed) — superset of
--    the existing 4 values (0011_listings_status_check.sql), so every row
--    and every existing write (src/app/marketplace/**, the 'active' default,
--    'reserved'/'sold' from respondToOffer()) stays valid unchanged.
--
-- 2. `sale_type`, new, defaulted to 'fixed_price' so every existing listing
--    keeps behaving exactly as it does today (a plain listing that can also
--    receive offers, per the existing `offers` flow — 'offers_allowed' is
--    for a future UI phase that distinguishes the two explicitly).
--    'auction' / 'auction_with_buy_now' are groundwork for the auctions/bids
--    tables added in 0039 — no listing is auction-typed yet, since that
--    requires UI this phase deliberately excludes.
--
-- Rollback:
--   alter table public.listings drop constraint listings_status_check;
--   alter table public.listings add constraint listings_status_check
--     check (status = any (array['active','reserved','sold','removed']));
--   alter table public.listings drop column if exists sale_type;
-- Safe only if no row has since taken one of the new status values or a
-- non-default sale_type.

alter table public.listings drop constraint if exists listings_status_check;
alter table public.listings add constraint listings_status_check
  check (status in (
    'draft', 'pending_review', 'active', 'reserved', 'sold', 'expired', 'removed'
  ));

alter table public.listings
  add column if not exists sale_type text not null default 'fixed_price'
    check (sale_type in ('fixed_price', 'offers_allowed', 'auction', 'auction_with_buy_now'));

create index if not exists listings_sale_type_idx on public.listings (sale_type);
