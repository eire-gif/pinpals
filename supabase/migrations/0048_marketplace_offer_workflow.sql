-- Private offer negotiation workflow: single-round counter-offers, buyer
-- withdraw, timed expiry, and a transactional accept path that reserves the
-- listing and snapshots a pending order — replacing the old flow's flat
-- pending/accepted/declined offers table (0032) and respondToOffer()'s
-- multi-round-trip, non-atomic accept (src/app/marketplace/[id]/actions.ts,
-- superseded by this migration + that file's companion rewrite).
--
-- Design decisions (the task explicitly leaves these to the implementation):
--   * Negotiation is single-round: buyer offers -> seller accepts/declines/
--     counters -> if countered, buyer accepts/declines. A buyer cannot
--     re-counter; they withdraw only from 'pending' (before the seller has
--     responded). This matches offers_status_check's existing six values
--     (0033) exactly — no new statuses, no new offer_events.event_type
--     values (0038) needed.
--   * "Only one active offer chain per buyer/listing" is enforced literally
--     as a DB-level exclusivity rule (partial unique index below) rather
--     than a softer app-layer check, so the race between two concurrent
--     create-offer requests from the same buyer is closed by Postgres
--     itself, not by hoping the app serializes them.
--   * Offers now only make sense on `offers_allowed` listings (the
--     Buy-Now-only 'fixed_price' type never wired up an offer path in the
--     UI, and auctions have their own bid mechanism) — tightened at both
--     the RLS INSERT policy and the creation trigger below, closing a
--     latent gap where 0032's original policy didn't check sale_type at
--     all.
--   * "Integer-cent amount within server-defined limits": amounts are
--     accepted in euro (numeric(8,2), matching the existing column — exact
--     to the cent, so no precision is lost) but every bound check below
--     works in integer cents, and the app layer (src/lib/marketplace.ts)
--     converts via eurToCents()/centsToEur() the same way buyNow()/
--     placeBid() already do, rather than trusting a raw float.
--   * Accepting an offer (from 'pending' or from a buyer-accepted
--     'countered') is the one operation that genuinely needs cross-table
--     atomicity — lock the offer and listing, re-validate both, reserve the
--     listing, snapshot an order. That's offer_action() below: a single
--     SECURITY DEFINER function, called only via the service-role client
--     from a Server Action that has already re-verified the caller's own
--     identity (never trusting a client-supplied role), same "one
--     choke-point function for a privileged multi-step write" shape as
--     claim_webhook_event()/create_refund_request() (0021/0023). Simple
--     single-row creation stays on the ordinary RLS+trigger path instead
--     (matching bids' own INSERT-policy-plus-trigger precedent, 0039) —
--     only the response/accept step needed a new privileged function.
--   * Orders created here use the existing default `status = 'pending'`
--     (NOT the 'pending_payment' value 0034 added to the check constraint
--     as unused groundwork) — apply_order_payment_succeeded() (0021) only
--     flips `status` to 'completed' when it finds `status = 'pending'`, and
--     touching that already-shipped webhook function is out of scope here.
--     `reservation_expires_at` (new column, below) is what actually drives
--     the checkout-window/release behaviour; `status`/`payment_status`
--     keep meaning exactly what they already mean everywhere else in this
--     app.
--   * No pg_cron dependency (see 0031_rate_limiting.sql's own header on why
--     not to assume it's enabled on this project). Offer expiry is
--     correctness-checked lazily wherever it matters (offer_action()
--     refuses to act on a past-deadline offer even if its stored status
--     hasn't caught up yet) and only actually swept into a persisted
--     'expired'/cancelled state by expire_stale_offers()/
--     release_expired_offer_reservations() below, called opportunistically
--     from the app (offer creation, and the listing detail page's own
--     load) — same "lazy correctness, eventual persisted cleanup" split
--     0031 already established for rate_limit_hits.
--
-- Rollback:
--   drop trigger if exists listings_invalidate_offers_on_unavailable on public.listings;
--   drop function if exists public.invalidate_offers_on_listing_unavailable();
--   drop function if exists public.release_expired_offer_reservations();
--   drop function if exists public.expire_stale_offers();
--   drop function if exists public.offer_action(bigint, uuid, text, integer, integer);
--   drop function if exists public.notify_user(uuid, text, text, text, jsonb);
--   drop function if exists public.format_eur(numeric);
--   drop trigger if exists offers_prepare_and_validate on public.offers;
--   drop function if exists public.prepare_and_validate_offer();
--   drop index if exists public.offers_one_active_chain_per_buyer_listing;
--   drop index if exists public.offers_expires_at_idx;
--   alter table public.offers drop column if exists expires_at;
--   alter table public.offers drop column if exists original_amount_eur;
--   drop index if exists public.orders_reservation_expires_at_idx;
--   alter table public.orders drop column if exists reservation_expires_at;
--   -- then re-run 0032's original INSERT policy body to restore the
--   -- pre-0048 (sale_type-unaware) version, and re-add "sellers can
--   -- respond to offers" (0032) if fully reverting to direct client writes.

-- ============ offers: new columns ============
alter table public.offers add column if not exists original_amount_eur numeric(8,2);
update public.offers set original_amount_eur = amount_eur where original_amount_eur is null;
alter table public.offers alter column original_amount_eur set not null;
alter table public.offers drop constraint if exists offers_original_amount_eur_check;
alter table public.offers add constraint offers_original_amount_eur_check check (original_amount_eur > 0);

-- Pre-existing rows (created before this migration, so never subject to a
-- real deadline) get a backfilled expires_at in the past — harmless, since
-- every such row is already 'accepted'/'declined' (terminal) in practice,
-- and even a stray 'pending' one simply reads as already-expired rather
-- than as a fresh 48-hour window it never actually had.
alter table public.offers add column if not exists expires_at timestamptz;
update public.offers set expires_at = coalesce(updated_at, created_at) where expires_at is null;
alter table public.offers alter column expires_at set not null;

create index if not exists offers_expires_at_idx
  on public.offers (expires_at)
  where status in ('pending', 'countered');

-- "Only one active offer chain per buyer/listing" — see header comment.
create unique index if not exists offers_one_active_chain_per_buyer_listing
  on public.offers (listing_id, buyer_id)
  where status in ('pending', 'countered');

-- ============ orders: checkout-window column ============
alter table public.orders add column if not exists reservation_expires_at timestamptz;

create index if not exists orders_reservation_expires_at_idx
  on public.orders (reservation_expires_at)
  where status = 'pending' and reservation_expires_at is not null;

-- ============ offers: RLS — tighten INSERT, remove direct UPDATE ============
-- Same shape as 0032's original policy, plus: only an 'offers_allowed'
-- listing accepts offers at all (see header comment).
drop policy if exists "buyers can create offers" on public.offers;
create policy "buyers can create offers"
  on public.offers for insert
  to public
  with check (
    (select auth.uid()) = buyer_id
    and exists (
      select 1 from public.listings l
      where l.id = offers.listing_id
        and l.seller_id <> (select auth.uid())
        and l.status = 'active'
        and l.sale_type = 'offers_allowed'
    )
  );

-- Every status transition (accept/decline/counter/withdraw) now goes
-- through offer_action() below, never a direct client UPDATE — same "no
-- authenticated UPDATE path, everything through a checked function" shape
-- auctions/bids already established (0039).
drop policy if exists "sellers can respond to offers" on public.offers;
revoke update on public.offers from anon, authenticated;

-- ============ offers: creation trigger (amount bounds, expiry, snapshot) ============
-- Runs alongside (not instead of) 0044's prevent_offer_self_dealing — both
-- are independent BEFORE INSERT checks that either pass through or raise.
create or replace function public.prepare_and_validate_offer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing record;
  v_listing_price_cents integer;
  v_amount_cents integer;
begin
  -- Privileged callers (no end-user JWT — service-role/superuser writes
  -- such as fixture seeding or a future admin tool — or staff) bypass this
  -- consumer-facing validation entirely and defer to whatever the caller
  -- explicitly set, same "who is actually privileged" test as
  -- validate_listing_status_transition()/prevent_notification_tampering()
  -- (0045). An ordinary authenticated buyer always has a real auth.uid(),
  -- so the real creation path below is unaffected.
  if auth.uid() is null or public.is_staff() then
    return new;
  end if;

  -- Locked so a concurrent listing-status change (a sale via Buy Now, a
  -- removal) can't race past this check — this insert either sees the
  -- fully-settled prior state or waits for it, never a torn read.
  select id, status, sale_type, price_cents, price_eur
    into v_listing
    from public.listings
    where id = new.listing_id
    for update;

  if not found then
    raise exception 'Listing % not found', new.listing_id;
  end if;

  if v_listing.status <> 'active' then
    raise exception 'This listing is not currently accepting offers';
  end if;

  if v_listing.sale_type <> 'offers_allowed' then
    raise exception 'This listing does not accept offers';
  end if;

  -- price_cents is meant to always mirror price_eur (0046), but plenty of
  -- legitimate rows only ever set price_eur (see 0046's own header comment)
  -- — fall back rather than trust price_cents is populated.
  v_listing_price_cents := coalesce(v_listing.price_cents, round(v_listing.price_eur * 100)::integer);
  v_amount_cents := round(new.amount_eur * 100)::integer;

  -- Server-defined limits: at least 1 EUR (blunt zero/penny spam), and
  -- strictly less than the asking price (an "offer" at or above the asking
  -- price isn't a negotiation — Buy Now already covers that case). Mirrored
  -- in src/lib/marketplace.ts's OFFER_MIN_AMOUNT_CENTS for the client-side
  -- hint; this is what's actually trusted, same split as everywhere else in
  -- this schema.
  if v_amount_cents < 100 then
    raise exception 'Offers must be at least EUR 1';
  end if;
  if v_amount_cents >= v_listing_price_cents then
    raise exception 'An offer must be less than the asking price — use Buy Now to pay the full price';
  end if;

  new.original_amount_eur := new.amount_eur;
  -- Mirrors OFFER_EXPIRY_HOURS in src/lib/marketplace.ts.
  new.expires_at := now() + interval '48 hours';
  new.status := 'pending';

  return new;
end;
$$;

revoke execute on function public.prepare_and_validate_offer() from public, anon, authenticated;

drop trigger if exists offers_prepare_and_validate on public.offers;
create trigger offers_prepare_and_validate
  before insert on public.offers
  for each row
  execute function public.prepare_and_validate_offer();

-- ============ small internal helpers ============
create or replace function public.format_eur(p_amount numeric)
returns text
language sql
immutable
as $$
  select 'EUR ' || trim(to_char(p_amount, 'FM999999990.00'));
$$;

revoke execute on function public.format_eur(numeric) from public, anon, authenticated;

-- Every notification this migration sends goes through here — one place
-- that actually writes `notifications` (system-populated only, 0042), so
-- every call site stays a one-line `perform`. SECURITY DEFINER so it can be
-- called from offer_action()/the sweep functions/the listings trigger below
-- regardless of who's actually driving the outer transaction.
create or replace function public.notify_user(
  p_user_id uuid,
  p_type text,
  p_title text,
  p_body text,
  p_data jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notifications (user_id, type, title, body, data)
  values (p_user_id, p_type, p_title, p_body, p_data);
$$;

revoke execute on function public.notify_user(uuid, text, text, text, jsonb) from public, anon, authenticated;

-- ============ offer_action(): the transactional response/accept path ============
-- Handles every offer state transition except creation: seller
-- accept/decline/counter on a 'pending' offer, buyer accept/decline on a
-- 'countered' offer, and buyer withdraw on a 'pending' offer.
--
-- SECURITY DEFINER, and deliberately NOT granted to anon/authenticated —
-- this is called only from a Server Action via the service-role client,
-- exactly like createAdminClient() is already used for buyNow()/
-- respondToOffer()'s privileged writes. `p_caller_id` is passed explicitly
-- rather than read from auth.uid() (which would be null under service_role
-- anyway): the calling Server Action re-verifies it against the user's own
-- session first (the same "authorization as a server-side security
-- boundary, re-checked explicitly rather than inherited from a policy"
-- discipline respondToOffer()'s own IDOR-guard comment describes), and this
-- function re-checks it again against the locked row before doing anything
-- — belt and suspenders, not a substitute for either layer.
--
-- Row locking: the LISTING is locked first, then the offer — deliberately,
-- not the more obvious "offer, then its listing" order. Accepting an offer
-- also has to decline every other still-open offer on the same listing
-- (see the shared accept path below), which takes a lock on THOSE rows too;
-- if two concurrent calls each locked their own offer row before the
-- listing, two different buyers' offers on the same listing being accepted
-- at the same moment could deadlock (A holds offer_A, wants the listing;
-- B holds offer_B, wants the listing; A also wants offer_B once it reaches
-- the decline-competitors step, and vice versa — a genuine AB/BA cycle).
-- Locking the coarser listing resource first makes every call on the same
-- listing serialize on that one lock before either ever touches an offers
-- row, which rules the cycle out entirely.
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
  -- Mirrors PLATFORM_FEE_RATE in src/lib/marketplace.ts.
  v_fee_eur := round(v_amount_eur * 0.07, 2);
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

-- ============ sweeps (no pg_cron dependency — see header comment) ============

-- Timer-based expiry: flips any 'pending'/'countered' offer past its own
-- deadline to 'expired'. Bulk statement, no per-row notification (an
-- unnoticed, un-acted-on offer quietly expiring is a low-stakes, passive
-- event for both sides — matching how an ended auction gets no notification
-- of its own anywhere in this app either) — contrast with the listings
-- trigger below, which notifies, since being told your listing just made
-- someone's offer invalid is a much more surprising outcome to the buyer.
create or replace function public.expire_stale_offers()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.offers
    set status = 'expired'
    where status in ('pending', 'countered')
      and expires_at < now();
end;
$$;

revoke execute on function public.expire_stale_offers() from public, anon, authenticated;

-- Checkout-window release: any order still 'pending' past its
-- reservation_expires_at (and not already paid) is cancelled and its
-- listing handed back to 'active'. Looping per-row (rather than one bulk
-- update) since each release also needs its own pair of notifications —
-- fine at this scale, since at most one such order exists per listing at a
-- time (accept only ever reserves a listing that was 'active', so nothing
-- can pile up multiple simultaneously-expired reservations on the same
-- listing).
--
-- Payment-webhook race, accepted rather than solved with more locking: if a
-- buyer's payment succeeds at the exact moment this sweep is also
-- considering their order, whichever transaction commits first wins — the
-- `payment_status <> 'paid'` guard below (mirroring apply_order_payment_
-- succeeded()'s own never-downgrade-a-paid-order check, 0021) means a
-- payment that lands first is never subsequently cancelled by this sweep. A
-- payment that only lands *after* the checkout window had already passed is
-- the buyer missing their own deadline, same as any TTL-based reservation.
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
      format('The buyer did not complete checkout in time for "%s" - it is active again.', v_row.listing_title)
    );
    perform public.notify_user(
      v_row.buyer_id, 'reservation_expired', 'Checkout window expired',
      format('Your checkout window for "%s" expired, so it is no longer reserved for you.', v_row.listing_title)
    );
  end loop;
end;
$$;

revoke execute on function public.release_expired_offer_reservations() from public, anon, authenticated;

-- ============ listings: invalidate dangling offers when it leaves 'active' ============
-- Backstop for every path OTHER than offer_action()'s own accept branch
-- (which already declines every competing offer itself, before this trigger
-- ever sees the listing status change — so it's a no-op there): buyNow()
-- claiming a fixed_price/offers_allowed listing, an admin
-- hide/restore-then-hide, a seller-driven status change, anything else that
-- moves a listing away from 'active'. Reuses 'expired' rather than adding a
-- seventh offers_status_check value — see header comment.
create or replace function public.invalidate_offers_on_listing_unavailable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer_id uuid;
begin
  if old.status = 'active' and new.status <> 'active' then
    for v_buyer_id in
      update public.offers
        set status = 'expired'
        where listing_id = new.id
          and status in ('pending', 'countered')
        returning buyer_id
    loop
      perform public.notify_user(
        v_buyer_id, 'offer_invalidated', 'Offer no longer valid',
        format('Your offer on "%s" is no longer valid - the listing is no longer available.', new.title)
      );
    end loop;
  end if;
  return new;
end;
$$;

revoke execute on function public.invalidate_offers_on_listing_unavailable() from public, anon, authenticated;

drop trigger if exists listings_invalidate_offers_on_unavailable on public.listings;
create trigger listings_invalidate_offers_on_unavailable
  after update on public.listings
  for each row
  execute function public.invalidate_offers_on_listing_unavailable();
