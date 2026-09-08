-- Pinpals: centralize the platform application fee into one server config
--
-- Part of the Stripe Connect hardening task (checkpoint: stripe-connect).
-- Before this migration, the 7% commission rate was a literal duplicated
-- independently in three places: PLATFORM_FEE_RATE (src/lib/marketplace.ts,
-- a client-side display mirror only) and inline `0.07` in two SECURITY
-- DEFINER functions that actually snapshot amount_eur/platform_fee_eur onto
-- an order — offer_action() (0048) and create_purchase_order() (0050). That
-- snapshotted platform_fee_eur is what createOrderPaymentIntent()
-- (src/app/dashboard/orders/[id]/actions.ts) later sends to Stripe as
-- application_fee_amount, so the SQL-side literal is the figure that
-- actually reaches Stripe — this migration gives it one named source
-- instead of two copies that could silently drift apart.
--
-- platform_fee_rate() is deliberately a tiny, framework-free SQL constant
-- function rather than a table: there's no admin UI need (yet) to change
-- this at runtime without a deploy, and a table would need its own RLS,
-- audit trail, and cache-invalidation story for a value that's read inside
-- a hot transactional path on every offer acceptance and Buy Now purchase.
-- If Pinpals ever wants an admin-configurable rate, replace this function's
-- body with a lookup against a new settings table — every caller already
-- goes through this one function, so that would be a one-file change.
--
-- Revoked from public/anon/authenticated same as format_eur()/notify_user()
-- (0048) — an internal building block for other SECURITY DEFINER functions,
-- never called directly by a client. STABLE (not IMMUTABLE): reserves the
-- right to become a real settings-table lookup later without relabeling.
--
-- Rollback:
--   Restore the two functions below to their previous bodies (0048/0050),
--   inlining `0.07` again in place of `public.platform_fee_rate()`.
--   drop function if exists public.platform_fee_rate();

create or replace function public.platform_fee_rate()
returns numeric
language sql
stable
set search_path = public
as $$
  select 0.07;
$$;

revoke execute on function public.platform_fee_rate() from public, anon, authenticated;

-- ============ offer_action(): now reads the fee rate from platform_fee_rate() ============
-- Identical to the version in 0048_marketplace_offer_workflow.sql except for
-- the v_fee_eur line — every other line, comment, and behavior is unchanged.
create or replace function public.offer_action(
  p_offer_id bigint,
  p_caller_id uuid,
  p_action text,
  p_counter_amount_cents integer default null,
  p_checkout_minutes integer default 30
)
returns public.offers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing_id bigint;
  v_offer public.offers%rowtype;
  v_listing public.listings%rowtype;
  v_is_seller boolean;
  v_is_buyer boolean;
  v_now timestamptz := now();
  v_accept_amount_cents integer;
  v_listing_price_cents integer;
  v_amount_eur numeric(8,2);
  v_fee_eur numeric(8,2);
  v_total_eur numeric(8,2);
begin
  if p_caller_id is null then
    raise exception 'Not authenticated';
  end if;
  if p_action not in ('accept', 'decline', 'counter', 'withdraw') then
    raise exception 'Unknown offer action: %', p_action;
  end if;

  -- Unlocked lookup purely to learn which listing to lock first — see the
  -- lock-ordering comment above. Re-read under lock just below, so nothing
  -- here is trusted for anything beyond routing to the right listing row.
  select listing_id into v_listing_id from public.offers where id = p_offer_id;
  if not found then
    raise exception 'Offer % not found', p_offer_id;
  end if;

  select * into v_listing from public.listings where id = v_listing_id for update;
  if not found then
    raise exception 'Listing % not found', v_listing_id;
  end if;

  select * into v_offer from public.offers where id = p_offer_id for update;
  if not found then
    raise exception 'Offer % not found', p_offer_id;
  end if;

  v_is_seller := (p_caller_id = v_listing.seller_id);
  v_is_buyer := (p_caller_id = v_offer.buyer_id);
  if not v_is_seller and not v_is_buyer then
    raise exception 'You are not a party to this offer';
  end if;

  -- Lazy expiry check: correctness never depends on the stored status
  -- column already having caught up (see header comment) — an offer past
  -- its own deadline is refused here regardless of what expire_stale_
  -- offers() has or hasn't swept yet.
  if v_offer.status in ('pending', 'countered') and v_offer.expires_at < v_now then
    raise exception 'This offer has expired';
  end if;

  -- accept/counter need the listing to still actually be for sale; decline/
  -- withdraw are always safe to apply regardless of listing state (a buyer
  -- or seller should always be able to close out their own side).
  if p_action in ('accept', 'counter') and v_listing.status <> 'active' then
    raise exception 'This listing is no longer available';
  end if;

  -- ============ withdraw: buyer, 'pending' only ============
  if p_action = 'withdraw' then
    if not v_is_buyer then
      raise exception 'Only the buyer can withdraw an offer';
    end if;
    if v_offer.status <> 'pending' then
      raise exception 'Only a pending offer can be withdrawn';
    end if;
    update public.offers set status = 'withdrawn' where id = v_offer.id returning * into v_offer;
    perform public.notify_user(
      v_listing.seller_id, 'offer_withdrawn', 'Offer withdrawn',
      format('A buyer withdrew their offer of %s on "%s".', public.format_eur(v_offer.amount_eur), v_listing.title)
    );
    return v_offer;
  end if;

  -- ============ seller responds to a 'pending' offer ============
  if v_offer.status = 'pending' then
    if not v_is_seller then
      raise exception 'Only the seller can respond to a pending offer';
    end if;

    if p_action = 'decline' then
      update public.offers set status = 'declined' where id = v_offer.id returning * into v_offer;
      perform public.notify_user(
        v_offer.buyer_id, 'offer_declined', 'Offer declined',
        format('Your offer of %s on "%s" was declined.', public.format_eur(v_offer.amount_eur), v_listing.title)
      );
      return v_offer;
    end if;

    if p_action = 'counter' then
      if p_counter_amount_cents is null then
        raise exception 'A counter offer needs an amount';
      end if;
      v_listing_price_cents := coalesce(v_listing.price_cents, round(v_listing.price_eur * 100)::integer);
      if p_counter_amount_cents <= round(v_offer.amount_eur * 100)::integer then
        raise exception 'A counter offer must be higher than the current offer';
      end if;
      if p_counter_amount_cents > v_listing_price_cents then
        raise exception 'A counter offer cannot exceed the asking price';
      end if;

      -- amount_eur becomes "the amount currently on the table" (now the
      -- counter) — original_amount_eur keeps the buyer's initial ask for
      -- history/display. log_offer_event() (0038) logs new.amount_eur on
      -- every status change already, so this needs no change there: the
      -- 'countered' event it records now correctly carries the counter
      -- amount, not the original ask.
      update public.offers
        set status = 'countered',
            amount_eur = round(p_counter_amount_cents / 100.0, 2),
            expires_at = v_now + interval '48 hours'
        where id = v_offer.id
        returning * into v_offer;

      perform public.notify_user(
        v_offer.buyer_id, 'offer_countered', 'Seller countered your offer',
        format('The seller countered your offer on "%s" with %s.', v_listing.title, public.format_eur(v_offer.amount_eur))
      );
      return v_offer;
    end if;

    -- p_action = 'accept' falls through to the shared accept logic below.
    v_accept_amount_cents := round(v_offer.amount_eur * 100)::integer;

  -- ============ buyer responds to a 'countered' offer ============
  elsif v_offer.status = 'countered' then
    if not v_is_buyer then
      raise exception 'Only the buyer can respond to a countered offer';
    end if;

    if p_action = 'decline' then
      update public.offers set status = 'declined' where id = v_offer.id returning * into v_offer;
      perform public.notify_user(
        v_listing.seller_id, 'offer_declined', 'Counter offer declined',
        format('Your counter offer of %s on "%s" was declined.', public.format_eur(v_offer.amount_eur), v_listing.title)
      );
      return v_offer;
    end if;

    if p_action = 'counter' then
      raise exception 'Only the seller can counter a pending offer';
    end if;

    -- p_action = 'accept': amount_eur already holds the counter value.
    v_accept_amount_cents := round(v_offer.amount_eur * 100)::integer;

  else
    raise exception 'Offer % (status %) cannot be acted on', v_offer.id, v_offer.status;
  end if;

  -- ============ shared accept path (from 'pending' or 'countered') ============
  update public.offers set status = 'accepted' where id = v_offer.id returning * into v_offer;

  -- Every other still-open offer on this listing loses out — accepting one
  -- closes the rest, now covering 'countered' chains too, not just
  -- 'pending' ones (the old respondToOffer() only handled the latter).
  update public.offers
    set status = 'declined'
    where listing_id = v_listing.id
      and status in ('pending', 'countered')
      and id <> v_offer.id;

  update public.listings set status = 'reserved' where id = v_listing.id;

  v_amount_eur := round(v_accept_amount_cents / 100.0, 2);
  -- Single server-config source of truth — see this migration's own header
  -- comment. Was: `round(v_amount_eur * 0.07, 2)`.
  v_fee_eur := round(v_amount_eur * public.platform_fee_rate(), 2);
  v_total_eur := round(v_amount_eur + v_fee_eur, 2);

  insert into public.orders (
    listing_id, offer_id, buyer_id, seller_id,
    listing_title, listing_category, listing_condition, listing_image_url,
    amount_eur, platform_fee_eur, total_eur,
    reservation_expires_at
  ) values (
    v_listing.id, v_offer.id, v_offer.buyer_id, v_listing.seller_id,
    v_listing.title, v_listing.category, v_listing.condition, v_listing.image_url,
    v_amount_eur, v_fee_eur, v_total_eur,
    v_now + make_interval(mins => greatest(coalesce(p_checkout_minutes, 30), 1))
  );

  perform public.notify_user(
    v_offer.buyer_id, 'offer_accepted', 'Offer accepted - checkout now',
    format(
      'Your offer of %s on "%s" was accepted. Complete checkout within %s minutes to secure it.',
      public.format_eur(v_amount_eur), v_listing.title, greatest(coalesce(p_checkout_minutes, 30), 1)
    )
  );
  perform public.notify_user(
    v_listing.seller_id, 'offer_accepted', 'You accepted an offer',
    format(
      'You accepted an offer of %s on "%s". It''s reserved while the buyer checks out.',
      public.format_eur(v_amount_eur), v_listing.title
    )
  );

  return v_offer;
end;
$$;

revoke execute on function public.offer_action(bigint, uuid, text, integer, integer) from public, anon, authenticated;

-- ============ create_purchase_order(): now reads the fee rate from platform_fee_rate() ============
-- Identical to the version in 0050_marketplace_checkout.sql except for the
-- v_fee_eur line — every other line, comment, and behavior is unchanged.
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
  -- Single server-config source of truth — see this migration's own header
  -- comment. Was: `round(v_amount_eur * 0.07, 2)`.
  v_fee_eur := round(v_amount_eur * public.platform_fee_rate(), 2);

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
