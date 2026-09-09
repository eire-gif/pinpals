-- Repair: restore the phase-26 (marketplace-notifications-reviews) versions of
-- the three functions that this session's 0048/0051/0055/0056 catch-up
-- overwrote, and remove the notify_user() overload that catch-up introduced.
--
-- DEPENDS ON 0056_marketplace_notifications_reviews.sql. Do not replay this
-- migration on a database that has not applied phase 26 first: it drops the
-- 5-argument notify_user() on the assumption that phase 26's 6-argument form
-- (with p_dedupe_key) is present, and the function bodies below call it with
-- six arguments.
--
-- What went wrong. Phase 26's SQL had been applied to production directly,
-- but its migration file and app code never landed in the repo, so the repo's
-- migration series stopped at 0055 and gave no hint that production was
-- already carrying phase-26 objects. Applying 0048 therefore re-created
-- public.notify_user(uuid, text, text, text, jsonb) -- the 5-argument form
-- phase 26 had superseded. Postgres kept BOTH: the 5-arg one has 1 defaulted
-- parameter and the 6-arg one has 2, so every 4-argument call site became
-- ambiguous and failed with 42725 "function public.notify_user(uuid, text,
-- text, text) is not unique".
--
-- Blast radius while that stood: every offer_action() path (accept, decline,
-- counter, withdraw), release_expired_offer_reservations(), and the
-- listings_invalidate_offers_on_unavailable trigger -- which fires on ANY
-- active -> non-active listing status change, so it would also have failed a
-- listing update whenever that listing had a pending or countered offer.
--
-- 0048/0051/0055/0056 also replaced the three functions below with their
-- pre-phase-26 bodies, silently dropping the notification payloads
-- (href/listingId/offerId) and the dedupe keys phase 26 added to every call
-- site. The definitions below are phase 26's own, restored verbatim.
--
-- 0056_offer_action_restore_platform_fee_rate.sql was applied to production
-- during that catch-up but is deliberately NOT in this repo: phase 26's
-- offer_action() already calls platform_fee_rate() (it was written against
-- 0051), and its number collides with phase 26's own 0056.
--
-- Rollback:
--   Re-create notify_user(uuid, text, text, text, jsonb) from 0048 and re-run
--   0055's offer_action() body. Not advised: that is precisely the ambiguous
--   state this migration removes.

-- ============ remove the ambiguous 5-argument overload ============
-- Phase 26's 6-argument notify_user() is a strict superset (p_dedupe_key
-- defaults to null, and the insert's ON CONFLICT is a no-op when it is),
-- so every existing 4-, 5- and 6-argument call resolves to it unambiguously.
drop function if exists public.notify_user(uuid, text, text, text, jsonb);

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
  v_order_id bigint;
begin
  if p_caller_id is null then
    raise exception 'Not authenticated';
  end if;
  if p_action not in ('accept', 'decline', 'counter', 'withdraw') then
    raise exception 'Unknown offer action: %', p_action;
  end if;

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

  if v_offer.status in ('pending', 'countered') and v_offer.expires_at < v_now then
    raise exception 'This offer has expired';
  end if;

  if p_action in ('accept', 'counter') and v_listing.status <> 'active' then
    raise exception 'This listing is no longer available';
  end if;

  if public.is_blocked(v_offer.buyer_id, v_listing.seller_id) and p_action in ('accept', 'counter') then
    raise exception 'This offer can''t be accepted or countered — messaging or trading between these members is blocked';
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
      format('A buyer withdrew their offer of %s on "%s".', public.format_eur(v_offer.amount_eur), v_listing.title),
      jsonb_build_object('href', '/marketplace/' || v_listing.id, 'listingId', v_listing.id, 'offerId', v_offer.id),
      'offer:' || v_offer.id || ':withdrawn'
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
        format('Your offer of %s on "%s" was declined.', public.format_eur(v_offer.amount_eur), v_listing.title),
        jsonb_build_object('href', '/marketplace/' || v_listing.id, 'listingId', v_listing.id, 'offerId', v_offer.id),
        'offer:' || v_offer.id || ':declined'
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

      update public.offers
        set status = 'countered',
            amount_eur = round(p_counter_amount_cents / 100.0, 2),
            expires_at = v_now + interval '48 hours'
        where id = v_offer.id
        returning * into v_offer;

      perform public.notify_user(
        v_offer.buyer_id, 'offer_countered', 'Seller countered your offer',
        format('The seller countered your offer on "%s" with %s.', v_listing.title, public.format_eur(v_offer.amount_eur)),
        jsonb_build_object('href', '/marketplace/' || v_listing.id, 'listingId', v_listing.id, 'offerId', v_offer.id),
        'offer:' || v_offer.id || ':countered:' || v_offer.updated_at
      );
      return v_offer;
    end if;

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
        format('Your counter offer of %s on "%s" was declined.', public.format_eur(v_offer.amount_eur), v_listing.title),
        jsonb_build_object('href', '/marketplace/' || v_listing.id, 'listingId', v_listing.id, 'offerId', v_offer.id),
        'offer:' || v_offer.id || ':declined'
      );
      return v_offer;
    end if;

    if p_action = 'counter' then
      raise exception 'Only the seller can counter a pending offer';
    end if;

    v_accept_amount_cents := round(v_offer.amount_eur * 100)::integer;

  else
    raise exception 'Offer % (status %) cannot be acted on', v_offer.id, v_offer.status;
  end if;

  -- ============ shared accept path (from 'pending' or 'countered') ============
  update public.offers set status = 'accepted' where id = v_offer.id returning * into v_offer;

  update public.offers
    set status = 'declined'
    where listing_id = v_listing.id
      and status in ('pending', 'countered')
      and id <> v_offer.id;

  update public.listings set status = 'reserved' where id = v_listing.id;

  v_amount_eur := round(v_accept_amount_cents / 100.0, 2);
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
  )
  returning id into v_order_id;

  perform public.notify_user(
    v_offer.buyer_id, 'offer_accepted', 'Offer accepted - checkout now',
    format(
      'Your offer of %s on "%s" was accepted. Complete checkout within %s minutes to secure it.',
      public.format_eur(v_amount_eur), v_listing.title, greatest(coalesce(p_checkout_minutes, 30), 1)
    ),
    jsonb_build_object('href', '/dashboard/orders/' || v_order_id, 'orderId', v_order_id, 'listingId', v_listing.id),
    'offer:' || v_offer.id || ':accepted:buyer'
  );
  perform public.notify_user(
    v_listing.seller_id, 'offer_accepted', 'You accepted an offer',
    format(
      'You accepted an offer of %s on "%s". It''s reserved while the buyer checks out.',
      public.format_eur(v_amount_eur), v_listing.title
    ),
    jsonb_build_object('href', '/dashboard/orders/' || v_order_id, 'orderId', v_order_id, 'listingId', v_listing.id),
    'offer:' || v_offer.id || ':accepted:seller'
  );

  return v_offer;
end;
$$;
revoke execute on function public.offer_action(bigint, uuid, text, integer, integer) from public, anon, authenticated;


create or replace function public.release_expired_offer_reservations()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  for v_row in
    select o.id as order_id, o.listing_id, o.buyer_id, o.seller_id, o.listing_title
    from public.orders o
    where o.status = 'pending'
      and o.reservation_expires_at is not null
      and o.reservation_expires_at < now()
      and o.payment_status <> 'paid'
    for update
  loop
    update public.orders set status = 'cancelled' where id = v_row.order_id;
    update public.listings set status = 'active' where id = v_row.listing_id and status = 'reserved';

    perform public.notify_user(
      v_row.seller_id, 'reservation_expired', 'Checkout window expired',
      format('The buyer did not complete checkout in time for "%s" - it is active again.', v_row.listing_title),
      jsonb_build_object('href', '/marketplace/' || v_row.listing_id, 'listingId', v_row.listing_id),
      'order:' || v_row.order_id || ':reservation_expired:seller'
    );
    perform public.notify_user(
      v_row.buyer_id, 'reservation_expired', 'Checkout window expired',
      format('Your checkout window for "%s" expired, so it is no longer reserved for you.', v_row.listing_title),
      jsonb_build_object('href', '/marketplace/' || v_row.listing_id, 'listingId', v_row.listing_id),
      'order:' || v_row.order_id || ':reservation_expired:buyer'
    );
  end loop;
end;
$$;
revoke execute on function public.release_expired_offer_reservations() from public, anon, authenticated;


create or replace function public.invalidate_offers_on_listing_unavailable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer_id uuid;
  v_offer_id bigint;
begin
  if old.status = 'active' and new.status <> 'active' then
    for v_buyer_id, v_offer_id in
      update public.offers
        set status = 'expired'
        where listing_id = new.id
          and status in ('pending', 'countered')
        returning buyer_id, id
    loop
      perform public.notify_user(
        v_buyer_id, 'offer_invalidated', 'Offer no longer valid',
        format('Your offer on "%s" is no longer valid - the listing is no longer available.', new.title),
        jsonb_build_object('href', '/marketplace/' || new.id, 'listingId', new.id),
        'offer:' || v_offer_id || ':invalidated'
      );
    end loop;
  end if;
  return new;
end;
$$;
revoke execute on function public.invalidate_offers_on_listing_unavailable() from public, anon, authenticated;
