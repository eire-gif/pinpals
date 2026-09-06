-- Three additive changes to `orders`, none of which touch existing rows or
-- the columns/values src/app/marketplace/[id]/actions.ts and the Stripe
-- webhook handlers (src/lib, per 0021/0023/0024) already read and write:
--
-- 1. Expand orders.status to the fuller order lifecycle requested (pending,
--    pending_payment, paid, seller_confirmed, shipped, delivered, completed,
--    cancelled, refunded, disputed) — superset of the existing 4 values.
--    'pending' is deliberately kept (not replaced by 'pending_payment'):
--    the column's default is 'pending' and existing code relies on it, so
--    dropping it would break every current order-creation path. The two
--    co-exist until a later app-code phase migrates writers off 'pending'.
--
-- 2. A hard, schema-level guarantee that a buyer can never transact on their
--    own listing: `check (buyer_id <> seller_id)`. Belt-and-braces alongside
--    the RLS guard already on `offers` (0032) — respondToOffer() only ever
--    creates an order from an offer whose buyer already passed that check,
--    so this should never fire in practice; it exists so the invariant is
--    enforced by the database itself, not only by application code.
--
-- 3. Immutable delivery snapshot columns, filling the one gap in the
--    "snapshot listing title, image, agreed price, fee, delivery and
--    seller/buyer IDs at purchase time" requirement — the other five are
--    already snapshotted (listing_title, listing_image_url, amount_eur,
--    platform_fee_eur, buyer_id/seller_id, all added in 0019). Delivery
--    itself has no representation anywhere yet in this schema, so this adds
--    the minimal fields needed to snapshot it: a method, a fee (new column,
--    so integer cents per the money-representation rule — existing
--    `orders.currency` already covers "with currency"), and a free-text
--    snapshot of the agreed delivery/collection details. All three are
--    nullable/defaulted so every existing row and insert stays valid.
--
-- Rollback:
--   alter table public.orders drop constraint orders_status_check;
--   alter table public.orders add constraint orders_status_check
--     check (status in ('pending', 'completed', 'cancelled', 'refunded'));
--   alter table public.orders drop constraint if exists orders_no_self_dealing_check;
--   alter table public.orders
--     drop column if exists delivery_method,
--     drop column if exists delivery_fee_cents,
--     drop column if exists delivery_detail;
-- Safe only if no row has since taken one of the new status values or a
-- non-null delivery_* value.

alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in (
    'pending', 'pending_payment', 'paid', 'seller_confirmed', 'shipped',
    'delivered', 'completed', 'cancelled', 'refunded', 'disputed'
  ));

alter table public.orders drop constraint if exists orders_no_self_dealing_check;
alter table public.orders
  add constraint orders_no_self_dealing_check check (buyer_id <> seller_id);

alter table public.orders
  add column if not exists delivery_method text not null default 'collection'
    check (delivery_method in ('collection', 'delivery')),
  add column if not exists delivery_fee_cents integer not null default 0
    check (delivery_fee_cents >= 0),
  add column if not exists delivery_detail text
    check (char_length(delivery_detail) <= 2000);
