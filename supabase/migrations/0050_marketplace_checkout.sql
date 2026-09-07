-- Pinpals: Buy Now / accepted-offer checkout (no charging yet)
--
-- Three things ship together:
--
--   1. `addresses` — a buyer's saved delivery addresses. No shipping-address
--      concept existed anywhere in this schema before now. This deliberately
--      does NOT live on `profiles`: that table's own SELECT policy is
--      "readable by every signed-in member" (0001_init.sql — it backs the
--      member directory), which is exactly wrong for a home address. Instead
--      this copies the access-control shape already established for other
--      sensitive per-user rows in this schema (`stripe_connected_accounts`,
--      0020) — own-row-only + staff, nothing public — which is what this
--      phase's task means by "the existing secure profile pattern": the
--      pattern is the RLS shape, not the `profiles` table itself. Unlike
--      stripe_connected_accounts (service-role-write-only, since only
--      Stripe's own onboarding populates it), a member manages their own
--      addresses directly, so this also carries ordinary own-row
--      insert/update/delete policies — the same shape `profiles` itself uses
--      for writes, just not for reads.
--
--   2. `orders.checkout_completed_at` — a new nullable marker distinguishing
--      "this pending order still needs a delivery choice" from "checkout is
--      finalized, only payment is left". This matters because the two entry
--      points this phase implements are NOT symmetric in when the order gets
--      created: a Buy Now purchase goes through the checkout page BEFORE any
--      order exists (create_purchase_order() below creates it already
--      carrying the buyer's delivery choice, so checkout_completed_at is set
--      at the same instant); an accepted-offer purchase already has a
--      'pending' order the moment the seller accepts (offer_action(), 0048 —
--      unchanged by this migration, deliberately: see the header comment on
--      finalize_offer_checkout() below for why that function was NOT folded
--      into offer_action() itself) with no delivery info yet, so it needs an
--      explicit second step (finalize_offer_checkout()) before this flips.
--      orders.delivery_method already defaults to 'collection' (0034), which
--      makes it useless on its own for telling "buyer chose collection" apart
--      from "buyer hasn't chosen anything yet" — checkout_completed_at is
--      what the app layer (src/app/marketplace/[id]/my-offer-status.tsx,
--      src/app/dashboard/orders/[id]/page.tsx) actually branches on to decide
--      whether to send a buyer to the checkout page first or straight to Pay.
--
--   3. Order state transitions, centralized and enforced. Every status write
--      this app has ever actually performed, across every phase so far, is
--      exactly one of: a fresh row defaulting to 'pending'; 'pending' ->
--      'completed' (apply_order_payment_succeeded, 0021); 'pending' ->
--      'cancelled' (release_expired_offer_reservations, 0048); or ANY status
--      -> 'refunded' (apply_order_payment_refunded, 0021, which has never
--      itself guarded on the order's prior status). validate_order_status_
--      transition() below is the "one server-side module" the task calls
--      for: a single BEFORE UPDATE trigger enumerating exactly those edges
--      (plus same-value no-ops) and raising on anything else. Deliberately
--      UNCONDITIONAL — no `auth.uid() is null or is_staff()` bypass, unlike
--      this schema's other tampering guards (prevent_conversation_tampering,
--      prevent_notification_tampering, 0045/0049). Those bypass trusted
--      writers because their tables have a real authenticated-user UPDATE
--      path RLS otherwise allows, and the guard's job is telling that path
--      apart from a trusted one. `orders` has no authenticated/anon UPDATE
--      path at all (0019 revokes it outright) — literally every caller this
--      trigger will ever see is already a trusted SECURITY DEFINER function
--      or the service-role client, so the only thing left worth guarding
--      against is a bug in one of those, and a bypass would defeat that
--      entirely. Scoped to fire only `when (new.status is distinct from
--      old.status)` so it's a no-op for the many existing writes that touch
--      other columns (payment_reference, payout_status, delivery_* below) —
--      see orders.test.ts's existing "service-role can update payout_status"
--      test, which this migration must not (and does not) break.
--
-- create_purchase_order() and finalize_offer_checkout() are this phase's own
-- new writers, and both only ever produce edges already in that list (insert
-- at 'pending'; finalize_offer_checkout() never touches status at all).
--
-- Rollback:
--   drop function if exists public.finalize_offer_checkout(uuid, bigint, text, bigint);
--   drop function if exists public.create_purchase_order(uuid, bigint, text, bigint, integer);
--   drop trigger if exists orders_validate_status_transition on public.orders;
--   drop function if exists public.validate_order_status_transition();
--   alter table public.orders drop constraint if exists orders_delivery_method_check;
--   alter table public.orders add constraint orders_delivery_method_check check (delivery_method in ('collection', 'delivery'));
--   alter table public.orders drop column if exists checkout_completed_at;
--   drop table if exists public.addresses cascade;

-- ============ addresses ============
create table if not exists public.addresses (
  id bigint generated always as identity primary key,

  user_id uuid not null references auth.users (id) on delete cascade,

  -- A buyer's own label for the address ("Home", "Work") — shown in the
  -- picker so a repeat buyer with more than one saved address can tell them
  -- apart at a glance, never validated against anything.
  label text not null check (char_length(label) between 1 and 60),
  recipient_name text not null check (char_length(recipient_name) between 1 and 120),
  line1 text not null check (char_length(line1) between 1 and 200),
  line2 text check (line2 is null or char_length(line2) <= 200),
  city text not null check (char_length(city) between 1 and 100),
  -- Same free-text county convention profiles.county/listings.county already
  -- use (0001/0003) rather than a closed enum — Ireland-only app, no country
  -- column for the same reason those two tables have none.
  county text check (county is null or char_length(county) <= 100),
  eircode text check (eircode is null or char_length(eircode) <= 20),
  phone text check (phone is null or char_length(phone) <= 30),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.addresses enable row level security;

drop trigger if exists addresses_set_updated_at on public.addresses;
create trigger addresses_set_updated_at
  before update on public.addresses
  for each row
  execute function public.set_updated_at();

create index if not exists addresses_user_id_idx on public.addresses (user_id);

-- ============ RLS: addresses ("the existing secure profile pattern") ============
-- Staff read access mirrors every other user-owned table in this schema
-- (orders, stripe_connected_accounts) — a support agent resolving a delivery
-- dispute needs to see where an order was meant to go. Never broadened to
-- "every signed-in member", unlike profiles' own directory-style policy.
create policy "Staff can view addresses"
  on public.addresses for select
  to authenticated
  using (public.is_staff());

create policy "Members can view their own addresses"
  on public.addresses for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Members can insert their own addresses"
  on public.addresses for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Members can update their own addresses"
  on public.addresses for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Members can delete their own addresses"
  on public.addresses for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- No anon access at all — an address is only ever meaningful tied to a
-- signed-in member's own account.
revoke all on public.addresses from anon;

-- ============ orders: checkout-finalized marker ============
alter table public.orders add column if not exists checkout_completed_at timestamptz;

-- 0034's original delivery_method vocabulary ('collection', 'delivery') never
-- got reconciled with the one 0046 actually settled on for the rest of the
-- app (listings.delivery_options's own check constraint, and the
-- `DeliveryOption = "post" | "collection"` TS type, src/lib/types.ts) — until
-- this migration, nothing had ever actually written a delivery choice onto an
-- order, so the mismatch was latent. create_purchase_order()/
-- finalize_offer_checkout() below are the first writers of a real buyer
-- choice here, so this is corrected now rather than carried forward: 'post'
-- replaces the never-used 'delivery' value.
alter table public.orders drop constraint if exists orders_delivery_method_check;
alter table public.orders add constraint orders_delivery_method_check
  check (delivery_method in ('collection', 'post'));

comment on column public.orders.checkout_completed_at is
  'Set the instant this order''s delivery method/address/total are finalized — at INSERT time for a Buy Now purchase (create_purchase_order()), or by a later finalize_offer_checkout() call for an order that started from an accepted private offer (offer_action(), 0048). Null means the buyer still needs to complete the checkout page before paying.';

-- ============ orders: permitted status transitions (one module, see header) ============
create or replace function public.validate_order_status_transition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'refunded' then
    return new;
  end if;
  if old.status = 'pending' and new.status in ('completed', 'cancelled') then
    return new;
  end if;

  raise exception 'Invalid order status transition: % -> %', old.status, new.status;
end;
$$;

revoke execute on function public.validate_order_status_transition() from public, anon, authenticated;

drop trigger if exists orders_validate_status_transition on public.orders;
create trigger orders_validate_status_transition
  before update on public.orders
  for each row
  when (new.status is distinct from old.status)
  execute function public.validate_order_status_transition();

-- ============ create_purchase_order(): the Buy Now checkout transaction ============
-- Called once, from the new checkout page's submit action
-- (src/app/marketplace/[id]/checkout/actions.ts), after the buyer has chosen
-- a delivery method and (if 'post') an address — everything this phase's
-- "Server transaction" spec asks for, as one atomic function body (a single
-- Postgres function call is already one transaction, so there's no
-- multi-statement window for a crash to leave a half-done purchase, the same
-- reasoning 0021's header comment gives for its own five small functions):
--   * verify listing availability and buyer eligibility — re-read fresh
--     inside this function, never trusted from the caller;
--   * lock the listing (and, for a Buy-It-Now purchase, the auction) with
--     `for update` before checking anything, so two buyers racing the same
--     Buy Now button can't both succeed;
--   * derive the agreed item price from the listing/auction row just locked
--     (never a client-supplied amount), the platform fee (mirrors
--     PLATFORM_FEE_RATE, src/lib/marketplace.ts), a flat delivery amount
--     (mirrors DELIVERY_FEE_EUR, src/lib/orders.ts — see that constant's own
--     comment on why it's a flat platform-wide fee, not seller-set postage),
--     and the total;
--   * tax treatment: deliberately none. Pinpals is a peer-to-peer marketplace
--     between individual members, not a registered retailer selling its own
--     stock, so no VAT line applies to a private sale between two members —
--     this is a considered "not applicable" rather than a silently-missing
--     column;
--   * insert the order — every column on it is a snapshot, immutable from
--     this instant on (nothing later ever rewrites listing_title/amount_eur/
--     platform_fee_eur/etc.), and its own AFTER INSERT trigger
--     (log_order_event(), 0040) records the matching order_events row with
--     no extra code needed here;
--   * reserve the listing for the payment window (reservation_expires_at —
--     the same column/mechanism 0048 introduced for the offer path, now
--     populated here too so release_expired_offer_reservations() already
--     covers a Buy Now reservation with no change to that function);
--   * return only the new order's id.
--
-- SECURITY DEFINER, revoked from anon/authenticated below — called only via
-- the service-role client from a Server Action that has already re-verified
-- the caller's own session, same "belt and suspenders, not a substitute for
-- either layer" discipline as offer_action() (0048). p_caller_id is that
-- re-verified id, never read from auth.uid() (which is null under
-- service_role regardless).
create or replace function public.create_purchase_order(
  p_caller_id uuid,
  p_listing_id bigint,
  p_delivery_method text,
  p_address_id bigint default null,
  p_reservation_minutes integer default 30
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing public.listings%rowtype;
  v_auction public.auctions%rowtype;
  v_address public.addresses%rowtype;
  v_price_cents integer;
  v_amount_eur numeric(8,2);
  v_fee_eur numeric(8,2);
  v_delivery_fee_eur numeric(8,2);
  v_delivery_detail text;
  v_order_id bigint;
begin
  if p_caller_id is null then
    raise exception 'Not authenticated';
  end if;
  if p_delivery_method not in ('post', 'collection') then
    raise exception 'Choose a valid delivery method';
  end if;

  select * into v_listing from public.listings where id = p_listing_id for update;
  if not found then
    raise exception 'Listing not found';
  end if;
  if v_listing.seller_id = p_caller_id then
    raise exception 'You can''t buy your own listing';
  end if;
  if v_listing.status <> 'active' then
    raise exception 'This listing is no longer available';
  end if;
  if not (p_delivery_method = any(v_listing.delivery_options)) then
    raise exception 'This seller doesn''t offer that delivery method';
  end if;

  if p_delivery_method = 'post' then
    if p_address_id is null then
      raise exception 'Choose a delivery address';
    end if;
    select * into v_address from public.addresses where id = p_address_id and user_id = p_caller_id;
    if not found then
      raise exception 'Choose a delivery address';
    end if;
    -- Matches DELIVERY_FEE_EUR (src/lib/orders.ts) — see that constant's
    -- comment for why this is a flat fee rather than seller-set postage.
    v_delivery_fee_eur := 6.00;
    v_delivery_detail := v_address.recipient_name || ', ' || v_address.line1
      || coalesce(', ' || v_address.line2, '') || ', ' || v_address.city
      || coalesce(', ' || v_address.county, '') || coalesce(' ' || v_address.eircode, '');
  else
    v_delivery_fee_eur := 0;
    v_delivery_detail := v_listing.collection_notes;
  end if;

  if v_listing.sale_type = 'auction_with_buy_now' then
    select * into v_auction from public.auctions where listing_id = p_listing_id for update;
    if not found or v_auction.buy_now_price_cents is null then
      raise exception 'Buy It Now isn''t available on this listing';
    end if;
    if v_auction.status in ('ended', 'cancelled') or v_auction.ends_at <= now() then
      raise exception 'This auction has already ended';
    end if;
    -- Same atomic claim buyNow() used to do in application code (see this
    -- migration's own companion app-layer changes) — only succeeds while
    -- still genuinely open, which the row lock above already guarantees is
    -- a consistent read, so a plain UPDATE (not a further WHERE-guarded
    -- conditional one) is enough here.
    update public.auctions set status = 'ended' where id = v_auction.id;
    v_price_cents := v_auction.buy_now_price_cents;
  else
    if v_listing.price_eur is null then
      raise exception 'This listing doesn''t have a Buy Now price';
    end if;
    v_price_cents := coalesce(v_listing.price_cents, round(v_listing.price_eur * 100)::integer);
  end if;

  update public.listings set status = 'reserved' where id = v_listing.id;

  v_amount_eur := round(v_price_cents / 100.0, 2);
  -- Mirrors PLATFORM_FEE_RATE in src/lib/marketplace.ts, same as offer_action().
  v_fee_eur := round(v_amount_eur * 0.07, 2);

  insert into public.orders (
    listing_id, buyer_id, seller_id,
    listing_title, listing_category, listing_condition, listing_image_url,
    amount_eur, platform_fee_eur, total_eur,
    delivery_method, delivery_fee_cents, delivery_detail,
    reservation_expires_at, checkout_completed_at
  ) values (
    v_listing.id, p_caller_id, v_listing.seller_id,
    v_listing.title, v_listing.category, v_listing.condition, v_listing.image_url,
    v_amount_eur, v_fee_eur, round(v_amount_eur + v_fee_eur + v_delivery_fee_eur, 2),
    p_delivery_method, round(v_delivery_fee_eur * 100)::integer, v_delivery_detail,
    now() + make_interval(mins => greatest(coalesce(p_reservation_minutes, 30), 1)), now()
  )
  returning id into v_order_id;

  return v_order_id;
end;
$$;

revoke execute on function public.create_purchase_order(uuid, bigint, text, bigint, integer) from public, anon, authenticated;

-- ============ finalize_offer_checkout(): delivery choice for an accepted offer ============
-- The accepted-offer counterpart to create_purchase_order() above, for the
-- one real asymmetry between the two entry points this phase covers:
-- offer_action() (0048) already creates a 'pending' order the instant a
-- seller accepts (or a buyer accepts a counter) — reserving the listing and
-- snapshotting the agreed price is genuinely part of THAT transaction (it
-- has to lock the listing and every competing offer together, atomically,
-- regardless of delivery choice), so there is no "order doesn't exist yet"
-- moment for this path the way there is for Buy Now. This function is
-- deliberately NOT folded into offer_action() itself — that function is
-- already shipped, tested (offers.test.ts, offer-workflow-race.test.ts) and
-- has no notion of delivery/addresses, and giving it one would mean asking a
-- buyer to pick delivery/an address at the exact moment they're clicking
-- "Accept counter", before they've even seen a checkout page. Instead, the
-- checkout page appears right after acceptance (src/app/dashboard/orders/
-- [id]/checkout/), and THIS function is what it submits to: re-verify the
-- caller is really this order's buyer, the order is still genuinely
-- checkout-able (still 'pending', reservation not lapsed, not already paid —
-- the same guards release_expired_offer_reservations() and
-- createOrderPaymentIntent() already apply, re-checked here independently),
-- then set delivery_method/delivery_fee_cents/delivery_detail and recompute
-- total_eur — the only order columns this function ever touches, and
-- notably never `status`, so validate_order_status_transition() above never
-- even fires for this write (its `when` clause only fires on a status
-- change). Can be called more than once for the same order (a buyer
-- changing their mind about delivery before paying) — nothing about it is
-- single-use.
create or replace function public.finalize_offer_checkout(
  p_caller_id uuid,
  p_order_id bigint,
  p_delivery_method text,
  p_address_id bigint default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_listing public.listings%rowtype;
  v_address public.addresses%rowtype;
  v_delivery_fee_eur numeric(8,2);
  v_delivery_detail text;
begin
  if p_caller_id is null then
    raise exception 'Not authenticated';
  end if;
  if p_delivery_method not in ('post', 'collection') then
    raise exception 'Choose a valid delivery method';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found';
  end if;
  if v_order.buyer_id <> p_caller_id then
    raise exception 'Not authorized';
  end if;
  if v_order.status <> 'pending' then
    raise exception 'This order is no longer awaiting checkout';
  end if;
  if v_order.reservation_expires_at is not null and v_order.reservation_expires_at <= now() then
    raise exception 'Your checkout window has expired';
  end if;
  if v_order.payment_status = 'paid' then
    raise exception 'This order has already been paid';
  end if;

  -- listing_id/its row can in principle be gone (on delete set null,
  -- 0019/0034) for an old order, though never for one freshly reserved by
  -- offer_action() — falls back to allowing any delivery method rather than
  -- raising, so a buyer is never blocked from checking out by a dangling
  -- link this function doesn't actually need for anything but the delivery-
  -- options/collection-notes check below.
  select * into v_listing from public.listings where id = v_order.listing_id;
  if found and not (p_delivery_method = any(v_listing.delivery_options)) then
    raise exception 'This seller doesn''t offer that delivery method';
  end if;

  if p_delivery_method = 'post' then
    if p_address_id is null then
      raise exception 'Choose a delivery address';
    end if;
    select * into v_address from public.addresses where id = p_address_id and user_id = p_caller_id;
    if not found then
      raise exception 'Choose a delivery address';
    end if;
    v_delivery_fee_eur := 6.00;
    v_delivery_detail := v_address.recipient_name || ', ' || v_address.line1
      || coalesce(', ' || v_address.line2, '') || ', ' || v_address.city
      || coalesce(', ' || v_address.county, '') || coalesce(' ' || v_address.eircode, '');
  else
    v_delivery_fee_eur := 0;
    v_delivery_detail := v_listing.collection_notes;
  end if;

  update public.orders
    set delivery_method = p_delivery_method,
        delivery_fee_cents = round(v_delivery_fee_eur * 100)::integer,
        delivery_detail = v_delivery_detail,
        total_eur = round(amount_eur + platform_fee_eur + v_delivery_fee_eur, 2),
        checkout_completed_at = now()
    where id = p_order_id;

  return p_order_id;
end;
$$;

revoke execute on function public.finalize_offer_checkout(uuid, bigint, text, bigint) from public, anon, authenticated;
