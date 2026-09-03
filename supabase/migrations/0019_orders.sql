-- Pinpals: marketplace order model (/admin/orders)
--
-- One row per completed offer acceptance. Created by respondToOffer()'s
-- accept branch (src/app/marketplace/[id]/actions.ts) via the service-role
-- client, immediately after the existing offer/listing updates succeed —
-- see the comment there for the server-side re-verification this relies on
-- instead of an authenticated insert policy.
--
-- Design rules this table follows (see the phase task):
--  - Durable Pinpals order id (the bigint identity primary key below) plus
--    full timestamps, same pattern as every other table in this schema.
--  - Listing data is SNAPSHOTTED at transaction time (listing_title/
--    category/condition/image_url) so a later edit — or eventual removal —
--    of the source listing never rewrites a historical order. listing_id/
--    offer_id are kept only as optional drill-through links for admin UI
--    convenience, never read from to render the order itself.
--  - order status, payment status and payout status are three independent
--    columns, not one combined field — a completed order can have a pending
--    payout, a refunded order is still "completed" as an order, etc.
--  - No Stripe integration exists yet anywhere in the app (confirmed in
--    claude/admin-architecture-review.md §4 — greenfield). payment_status/
--    payout_status default to their "nothing has happened yet" values and
--    payment_reference/payout_reference start null; Phase 5's Stripe Connect
--    work (per that doc's §8 sequencing) is what will actually populate
--    these going forward, not this migration.

create table if not exists public.orders (
  id bigint generated always as identity primary key,

  -- Drill-through links only — never joined against to render the order
  -- itself (that's what the snapshot columns below are for). Both nullable:
  -- a listing/offer can later be removed without breaking a historical
  -- order row's FK.
  listing_id bigint references public.listings (id) on delete set null,
  offer_id bigint unique references public.offers (id) on delete set null,

  buyer_id uuid not null references auth.users (id),
  seller_id uuid not null references auth.users (id),

  -- Snapshot of the listing as it was at the moment the offer was accepted.
  listing_title text not null,
  listing_category text not null,
  listing_condition text not null,
  listing_image_url text,

  amount_eur numeric(8,2) not null check (amount_eur > 0),
  platform_fee_eur numeric(8,2) not null check (platform_fee_eur >= 0),
  total_eur numeric(8,2) not null check (total_eur >= 0),

  status text not null default 'pending'
    check (status in ('pending', 'completed', 'cancelled', 'refunded')),
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'pending', 'paid', 'failed', 'refunded')),
  payout_status text not null default 'not_started'
    check (payout_status in ('not_started', 'pending', 'paid_out', 'held')),

  -- Opaque external references (e.g. a future Stripe PaymentIntent/Payout
  -- id) — never a secret, just an id safe to show a finance admin. Nothing
  -- populates these yet.
  payment_reference text,
  payout_reference text,

  refund_reason text check (char_length(refund_reason) <= 4000),
  refunded_amount_eur numeric(8,2) check (refunded_amount_eur >= 0),

  completed_at timestamptz,
  cancelled_at timestamptz,
  refunded_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.orders enable row level security;

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
  before update on public.orders
  for each row
  execute function public.set_updated_at();

-- /admin/orders filters by order id (primary key, no index needed), buyer,
-- seller, status and date — index every one of those. buyer_id/seller_id
-- are indexed from day one (unlike offers.buyer_id/listings.seller_id,
-- which 0018's comment flagged as a pre-existing gap outside that phase's
-- scope) since this table starts empty and there's no reason to repeat it.
create index if not exists orders_buyer_id_idx on public.orders (buyer_id);
create index if not exists orders_seller_id_idx on public.orders (seller_id);
create index if not exists orders_status_idx on public.orders (status);
create index if not exists orders_payment_status_idx on public.orders (payment_status);
create index if not exists orders_created_at_idx on public.orders (created_at desc);

-- ============ RLS: orders ============
-- Staff can read every order — /admin/orders itself is further gated to
-- FINANCE_ROLES (src/lib/admin/finance.ts) at the requireStaff() layer, not
-- here, same read-broad/gate-in-app split used for reports and user notes.
create policy "Staff can view orders"
  on public.orders for select
  to authenticated
  using (public.is_staff());

-- Buyer and seller can each read their own order. No UI reads this yet (no
-- member-facing order history page ships in this phase), but the model
-- should support it without a later migration, and it costs nothing: this
-- is a read-only, own-row-only policy, the same shape as the existing
-- `offers` policies.
create policy "Buyers can view their own orders"
  on public.orders for select
  to authenticated
  using (auth.uid() = buyer_id);

create policy "Sellers can view their own orders"
  on public.orders for select
  to authenticated
  using (auth.uid() = seller_id);

-- No insert/update/delete policy for anon or authenticated: order creation
-- (respondToOffer's accept branch) and any future admin mutation (refunds,
-- payout status changes) both go through the service-role client, which
-- bypasses RLS entirely. Explicitly revoke rather than relying on "no
-- policy = no access" alone — same discipline as 0008/0010/0013/0016.
revoke insert, update, delete, truncate, references, trigger
  on public.orders from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.orders from authenticated;
