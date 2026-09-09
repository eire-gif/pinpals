-- Marketplace notifications (in-app + preference-aware email) and reviews
-- (reporting/moderation without deletion, efficient rating summaries).
--
-- Research pass (before writing this file): `notifications` (0042) and its
-- one writer, `notify_user()` (0048), already exist but only fire for the
-- offer-response lifecycle (accept/decline/counter/withdraw/reservation-
-- expiry/invalidation) — new message, offer *received*, outbid/auction
-- ending/won/lost, payment succeeded/failed, refund/dispute updates, and
-- review-available all fire zero notifications today. There is no in-app
-- notification UI anywhere (no reader was ever built against the table),
-- no notification-preferences table/column, and no email-sending
-- infrastructure in this app beyond Supabase Auth's own locked default
-- password-reset template (see claude/password-reset-setup.md) — "the
-- existing notification/email system" is only half-true: the in-app half
-- exists and is extended here; the email half does not exist and is built
-- from scratch (src/lib/email.ts, app-code, not this migration).
-- `reviews` (0041) already has full RLS/trigger enforcement (one review per
-- reviewer/order/role, order must be completed) and a working write path
-- (submitReview(), phase-23) — this migration adds moderation-without-
-- deletion (hidden_at/hidden_by/hidden_reason, same shape as messages'
-- own hidden_at/hidden_by/hidden_reason, 0025) and makes 'review' a valid
-- report target, plus an efficient rating-summary view.
--
-- Design decisions:
--   1. Deduplication is a DB-level concern, not an app-level "have I sent
--      this" check: `notifications` gets a nullable `dedupe_key` column and
--      a partial unique index on (user_id, dedupe_key) where dedupe_key is
--      not null. notify_user() gains an optional p_dedupe_key parameter and
--      does `on conflict (user_id, dedupe_key) where dedupe_key is not null
--      do nothing` — a caller that passes a stable key (e.g.
--      'stripe:evt_123:payment_succeeded:buyer') gets true idempotency
--      across webhook redelivery or an admin's manual "Retry"
--      (src/app/admin/webhook-events/[id]/actions.ts already re-invokes
--      processStripeEvent() for exactly that case); a caller that omits it
--      (every existing 0048 call site) keeps today's behaviour exactly.
--   2. "Link users directly to the relevant authenticated screen" is
--      carried in the pre-existing `data jsonb` column as `{"href": "..."}`
--      — no schema change needed for that part, only that every NEW
--      notify_user() call site (this migration's CREATE OR REPLACEs of
--      offer_action()/release_expired_offer_reservations()/
--      invalidate_offers_on_listing_unavailable(), plus the new offer-
--      received/outbid/auction triggers below) now actually populates it,
--      retrofitting the pre-existing offer-lifecycle notifications too
--      rather than leaving them without a link while every new type has
--      one.
--   3. Preferences are transactional-vs-optional by which categories the
--      table's own check constraint allows: `notification_preferences`
--      only accepts 'messages' | 'offers' | 'auctions' | 'reviews' — a
--      user can never store a disabled row for 'payments' or
--      'disputes_refunds' because no such category value is legal in this
--      table at all. Those two categories' emails are unconditional by
--      construction, not by an app-code check that could be forgotten.
--   4. "Offer received" (creation, not a response) needed a NEW trigger,
--      not an addition to the existing prepare_and_validate_offer()
--      (0048): that trigger is BEFORE INSERT, and offers.id is a
--      `generated always as identity` column with no value yet at that
--      point — a link into the notification needs the row to actually
--      exist, so this is a separate AFTER INSERT trigger.
--   5. "Outbid" hooks into apply_new_bid() (0039, AFTER INSERT) — the
--      previous winning_bid_id's bidder, read before the update, is who
--      gets notified, only when a real bidder is displaced (not on an
--      auction's very first bid).
--   6. "Auction ending soon" and "auction won/lost" both need something
--      this app has never had: an actual close-the-auction transition.
--      Per phase-14/phase-24's own notes, no scheduled job flips an
--      auction to 'ended' — it only closes lazily when someone tries to
--      bid/buy-now past its end time, or via an admin's manual force-close
--      (forceCloseAuction(), phase-24). run_auction_sweeps() below is the
--      missing piece, in the exact "no pg_cron, opportunistic sweep called
--      from app code on a relevant page load" shape 0048's own header
--      comment establishes for offers — see runAuctionSweeps() in
--      src/app/marketplace/[id]/actions.ts for where it's actually called
--      from. A reserve not met is treated as "no qualifying winner", not a
--      win — the highest bidder still gets notified (as a loss, alongside
--      every other bidder), the seller gets an ended-unsold notification.
--   7. Reviews reuse messages' exact hidden_at/hidden_by/hidden_reason
--      moderation shape (0025) — content is never edited or deleted by a
--      moderator, only flagged not-publicly-visible, with the flag itself
--      reversible. UNLIKE messages (which have no authenticated UPDATE
--      policy at all — hiding is the only way *anyone* other than the
--      service role touches that column set), reviews already have an
--      authenticated UPDATE policy for the reviewer's own row (rating/body
--      edits), so a tampering-prevention trigger is needed here that
--      messages never required: prevent_review_moderation_tampering()
--      blocks a non-staff caller from touching hidden_at/hidden_by/
--      hidden_reason on their own review, same discipline as
--      prevent_notification_tampering()/prevent_conversation_tampering()
--      (0045/0049).
--   8. Rating summaries move from "fetch every review row, reduce in JS"
--      (summarizeRatings(), src/lib/marketplace.ts — still kept as a pure
--      fallback/unit-tested helper, just no longer the only path) to a
--      plain SQL view, `seller_rating_summaries`, aggregated once in
--      Postgres — same "plain view, SECURITY INVOKER by default so it
--      naturally respects the caller's own RLS visibility" shape as
--      auction_bid_history (0045). Excludes hidden reviews explicitly so a
--      moderated-away review never skews a public rating.
--
-- Rollback:
--   drop view if exists public.seller_rating_summaries;
--   alter table public.reports drop constraint if exists reports_target_type_check;
--   alter table public.reports add constraint reports_target_type_check
--     check (target_type in ('user', 'listing', 'tee_time_invite', 'message', 'conversation', 'order'));
--   drop trigger if exists reviews_prevent_moderation_tampering on public.reviews;
--   drop function if exists public.prevent_review_moderation_tampering();
--   drop policy if exists "Reviews are publicly readable unless hidden" on public.reviews;
--   create policy "reviews are publicly readable" on public.reviews for select to public using (true); -- restores 0041's original name/policy
--   drop function if exists public.review_is_visible(timestamptz, uuid, uuid);
--   alter table public.reviews drop column if exists hidden_at, drop column if exists hidden_by, drop column if exists hidden_reason;
--   drop function if exists public.run_auction_sweeps();
--   drop trigger if exists bids_notify_outbid on public.bids;
--   drop function if exists public.notify_outbid_on_new_bid();
--   drop trigger if exists offers_notify_on_create on public.offers;
--   drop function if exists public.notify_seller_of_new_offer();
--   drop table if exists public.notification_preferences cascade;
--   drop index if exists public.notifications_user_dedupe_key_idx;
--   alter table public.notifications drop column if exists dedupe_key;
--   (offer_action()/release_expired_offer_reservations()/
--   invalidate_offers_on_listing_unavailable()/notify_user() themselves
--   are CREATE OR REPLACE — reverting their bodies to pre-0056 needs
--   restoring 0048/0055's own versions verbatim, not a DROP.)

-- ============ notifications: dedupe key + notify_user() upgrade ============
alter table public.notifications add column if not exists dedupe_key text;

create unique index if not exists notifications_user_dedupe_key_idx
  on public.notifications (user_id, dedupe_key)
  where dedupe_key is not null;

create or replace function public.notify_user(
  p_user_id uuid,
  p_type text,
  p_title text,
  p_body text,
  p_data jsonb default '{}'::jsonb,
  p_dedupe_key text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notifications (user_id, type, title, body, data, dedupe_key)
  values (p_user_id, p_type, p_title, p_body, p_data, p_dedupe_key)
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
$$;

revoke execute on function public.notify_user(uuid, text, text, text, jsonb, text) from public, anon, authenticated;

-- ============ notification_preferences ============
-- See design decision 3 above — the check constraint IS the transactional/
-- optional split. No row is stored for a category not listed here, and
-- "not listed here" (payments, disputes_refunds) is exactly the set every
-- app-code caller treats as always-on.
create table if not exists public.notification_preferences (
  user_id uuid not null references public.profiles (id) on delete cascade,
  category text not null check (category in ('messages', 'offers', 'auctions', 'reviews')),
  email_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, category)
);

alter table public.notification_preferences enable row level security;

drop policy if exists "members view their own notification preferences" on public.notification_preferences;
create policy "members view their own notification preferences"
  on public.notification_preferences for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "members set their own notification preferences" on public.notification_preferences;
create policy "members set their own notification preferences"
  on public.notification_preferences for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "members update their own notification preferences" on public.notification_preferences;
create policy "members update their own notification preferences"
  on public.notification_preferences for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "members delete their own notification preferences" on public.notification_preferences;
create policy "members delete their own notification preferences"
  on public.notification_preferences for delete
  to authenticated
  using ((select auth.uid()) = user_id);

revoke truncate, references, trigger on public.notification_preferences from anon;
revoke truncate, references, trigger on public.notification_preferences from authenticated;
revoke all on public.notification_preferences from anon;

-- ============ offers: "offer received" (creation) notification ============
-- See design decision 4 — a separate AFTER INSERT trigger, since
-- prepare_and_validate_offer() (0048) is BEFORE INSERT and new.id doesn't
-- exist yet at that point.
create or replace function public.notify_seller_of_new_offer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seller_id uuid;
  v_listing_title text;
begin
  select l.seller_id, l.title into v_seller_id, v_listing_title
    from public.listings l
    where l.id = new.listing_id;

  if v_seller_id is not null then
    perform public.notify_user(
      v_seller_id, 'offer_received', 'New offer received',
      format('You received an offer of %s on "%s".', public.format_eur(new.amount_eur), v_listing_title),
      jsonb_build_object('href', '/marketplace/' || new.listing_id, 'listingId', new.listing_id, 'offerId', new.id),
      'offer:' || new.id || ':received'
    );
  end if;
  return new;
end;
$$;

revoke execute on function public.notify_seller_of_new_offer() from public, anon, authenticated;

drop trigger if exists offers_notify_on_create on public.offers;
create trigger offers_notify_on_create
  after insert on public.offers
  for each row
  execute function public.notify_seller_of_new_offer();

-- ============ offer_action() / sweeps: retrofit hrefs + dedupe keys ============
-- Identical business logic to 0055's version (itself 0048's version plus
-- the is_blocked() accept/counter guard) — every notify_user() call site
-- now also passes a link and a dedupe key. See design decision 2.
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

-- ============ bids: "outbid" notification ============
create or replace function public.apply_new_bid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previous_bid_id bigint;
  v_previous_bidder_id uuid;
  v_listing_id bigint;
begin
  select winning_bid_id, listing_id into v_previous_bid_id, v_listing_id
    from public.auctions where id = new.auction_id;

  update public.auctions
    set status = 'live',
        winning_bid_id = new.id
    where id = new.auction_id
      and status in ('scheduled', 'live');

  if v_previous_bid_id is not null then
    select bidder_id into v_previous_bidder_id from public.bids where id = v_previous_bid_id;
    if v_previous_bidder_id is not null and v_previous_bidder_id <> new.bidder_id then
      perform public.notify_user(
        v_previous_bidder_id, 'outbid', 'You''ve been outbid',
        format('Someone placed a higher bid of %s.', public.format_eur(round(new.amount_cents / 100.0, 2))),
        jsonb_build_object('href', '/marketplace/' || v_listing_id, 'listingId', v_listing_id, 'auctionId', new.auction_id),
        'bid:' || new.id || ':outbid:' || v_previous_bidder_id
      );
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.apply_new_bid() from public, anon, authenticated;

-- ============ auctions: sweep — ending-soon + close/won/lost ============
-- See design decision 6. No pg_cron dependency (0031's own precedent) —
-- called opportunistically from app code (runAuctionSweeps(), src/app/
-- marketplace/[id]/actions.ts), same "lazy correctness, eventual persisted
-- cleanup" shape 0048 established for offers.
create or replace function public.run_auction_sweeps()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ending record;
  v_closing record;
  v_winner_id uuid;
  v_winning_amount_cents integer;
  v_reserve_met boolean;
  v_bidder record;
begin
  -- Ending soon: any still-live auction within 2 hours of its own end,
  -- notify the CURRENT highest bidder once (dedup key makes this safe to
  -- call as often as any page load triggers it).
  for v_ending in
    select a.id, a.listing_id, a.winning_bid_id, a.ends_at, l.title
    from public.auctions a
    join public.listings l on l.id = a.listing_id
    where a.status = 'live'
      and a.ends_at > now()
      and a.ends_at <= now() + interval '2 hours'
      and a.winning_bid_id is not null
  loop
    select bidder_id into v_winner_id from public.bids where id = v_ending.winning_bid_id;
    if v_winner_id is not null then
      perform public.notify_user(
        v_winner_id, 'auction_ending_soon', 'Auction ending soon',
        format('The auction for "%s" ends soon — you''re currently the highest bidder.', v_ending.title),
        jsonb_build_object('href', '/marketplace/' || v_ending.listing_id, 'listingId', v_ending.listing_id, 'auctionId', v_ending.id),
        'auction:' || v_ending.id || ':ending_soon'
      );
    end if;
  end loop;

  -- Close + won/lost: any scheduled/live auction past its own end time.
  for v_closing in
    select a.id, a.listing_id, a.winning_bid_id, a.reserve_price_cents, l.title, l.seller_id
    from public.auctions a
    join public.listings l on l.id = a.listing_id
    where a.status in ('scheduled', 'live')
      and a.ends_at <= now()
    for update of a
  loop
    v_winner_id := null;
    v_reserve_met := false;

    if v_closing.winning_bid_id is not null then
      select bidder_id, amount_cents into v_winner_id, v_winning_amount_cents
        from public.bids where id = v_closing.winning_bid_id;
      v_reserve_met := (v_closing.reserve_price_cents is null or v_winning_amount_cents >= v_closing.reserve_price_cents);
    end if;

    update public.auctions set status = 'ended' where id = v_closing.id;

    if v_winner_id is not null and v_reserve_met then
      perform public.notify_user(
        v_winner_id, 'auction_won', 'You won the auction!',
        format('Congratulations - you won the auction for "%s".', v_closing.title),
        jsonb_build_object('href', '/marketplace/' || v_closing.listing_id, 'listingId', v_closing.listing_id, 'auctionId', v_closing.id),
        'auction:' || v_closing.id || ':won'
      );
      perform public.notify_user(
        v_closing.seller_id, 'auction_ended', 'Your auction ended - sold',
        format('Your auction for "%s" ended with a winning bid.', v_closing.title),
        jsonb_build_object('href', '/marketplace/' || v_closing.listing_id, 'listingId', v_closing.listing_id, 'auctionId', v_closing.id),
        'auction:' || v_closing.id || ':ended:seller'
      );
    else
      perform public.notify_user(
        v_closing.seller_id, 'auction_ended', 'Your auction ended - no sale',
        format('Your auction for "%s" ended without a qualifying winning bid.', v_closing.title),
        jsonb_build_object('href', '/marketplace/' || v_closing.listing_id, 'listingId', v_closing.listing_id, 'auctionId', v_closing.id),
        'auction:' || v_closing.id || ':ended:seller'
      );
    end if;

    -- Every other distinct bidder (excluding the actual winner, if any)
    -- gets a "you didn't win" notification once.
    for v_bidder in
      select distinct bidder_id from public.bids
      where auction_id = v_closing.id
        and bidder_id is distinct from v_winner_id
    loop
      perform public.notify_user(
        v_bidder.bidder_id, 'auction_lost', 'Auction ended',
        format('The auction for "%s" has ended - you did not win.', v_closing.title),
        jsonb_build_object('href', '/marketplace/' || v_closing.listing_id, 'listingId', v_closing.listing_id, 'auctionId', v_closing.id),
        'auction:' || v_closing.id || ':lost:' || v_bidder.bidder_id
      );
    end loop;
  end loop;
end;
$$;

revoke execute on function public.run_auction_sweeps() from public, anon, authenticated;

-- ============ reviews: moderation without deletion ============
alter table public.reviews add column if not exists hidden_at timestamptz;
alter table public.reviews add column if not exists hidden_by uuid references auth.users (id);
alter table public.reviews add column if not exists hidden_reason text check (char_length(hidden_reason) <= 4000);

-- The original 0041 policy is named in lower case ("reviews are publicly
-- readable") — dropping only a differently-cased "Reviews are publicly
-- readable" here would silently leave that original, fully-permissive
-- using(true) policy in place alongside the new one below. Since Postgres
-- OR-combines multiple permissive SELECT policies on the same table, an
-- un-dropped old policy would fully defeat the new hidden-review
-- restriction for every caller, staff or not — so both exact spellings are
-- dropped here, belt-and-braces.
-- A SECURITY DEFINER wrapper, same shape as listing_is_visible() (0045):
-- `is_staff()` is deliberately not granted to `anon` (0008_staff_roles_fix_
-- is_staff_grants.sql), so a `to public` policy that called it directly
-- would raise "permission denied for function is_staff" for an anonymous
-- caller reading a HIDDEN review (the only case where evaluating that
-- branch is reached at all — a non-hidden review's `hidden_at is null`
-- clause short-circuits before it). Wrapping it in a SECURITY DEFINER
-- function granted execute to both anon and authenticated runs the inner
-- is_staff() call as the function owner rather than the caller, exactly
-- the way listing_is_visible() already solves this same problem for
-- listings' own public SELECT policy.
create or replace function public.review_is_visible(
  p_hidden_at timestamptz,
  p_reviewer_id uuid,
  p_reviewee_id uuid
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select p_hidden_at is null
    or (select auth.uid()) in (p_reviewer_id, p_reviewee_id)
    or public.is_staff();
$$;

revoke all on function public.review_is_visible(timestamptz, uuid, uuid) from public;
grant execute on function public.review_is_visible(timestamptz, uuid, uuid) to anon, authenticated;

-- The original 0041 policy is named in lower case ("reviews are publicly
-- readable") — dropping only a differently-cased "Reviews are publicly
-- readable" here would silently leave that original, fully-permissive
-- using(true) policy in place alongside the new one below. Since Postgres
-- OR-combines multiple permissive SELECT policies on the same table, an
-- un-dropped old policy would fully defeat the new hidden-review
-- restriction for every caller, staff or not — so both exact spellings are
-- dropped here, belt-and-braces.
drop policy if exists "reviews are publicly readable" on public.reviews;
drop policy if exists "Reviews are publicly readable" on public.reviews;
drop policy if exists "Reviews are publicly readable unless hidden" on public.reviews;
create policy "Reviews are publicly readable unless hidden"
  on public.reviews for select
  to public
  using (public.review_is_visible(hidden_at, reviewer_id, reviewee_id));

-- See design decision 7 — reviews, unlike messages, still have a real
-- authenticated UPDATE policy (the reviewer editing their own rating/body),
-- so hidden_at/hidden_by/hidden_reason need their own tampering guard.
create or replace function public.prevent_review_moderation_tampering()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_staff() then
    return new;
  end if;

  if new.hidden_at is distinct from old.hidden_at
    or new.hidden_by is distinct from old.hidden_by
    or new.hidden_reason is distinct from old.hidden_reason then
    raise exception 'Review moderation fields can only be changed by staff';
  end if;

  return new;
end;
$$;

revoke execute on function public.prevent_review_moderation_tampering() from public, anon, authenticated;

drop trigger if exists reviews_prevent_moderation_tampering on public.reviews;
create trigger reviews_prevent_moderation_tampering
  before update on public.reviews
  for each row
  execute function public.prevent_review_moderation_tampering();

-- ============ reports: 'review' target type ============
alter table public.reports drop constraint if exists reports_target_type_check;
alter table public.reports add constraint reports_target_type_check
  check (target_type in ('user', 'listing', 'tee_time_invite', 'message', 'conversation', 'order', 'review'));

-- ============ efficient rating summaries ============
-- Plain view, SECURITY INVOKER by default — a caller only ever sees rows
-- their own RLS already lets them see (so a hidden review a moderator/
-- reviewer/reviewee can still individually read never leaks into someone
-- ELSE's aggregate; the explicit `hidden_at is null` below additionally
-- guards against a hidden review skewing anyone's summary regardless of
-- who's asking). One aggregation pass in Postgres, not N rows fetched and
-- reduced in the app for every seller card rendered.
create or replace view public.seller_rating_summaries as
select
  reviewee_id as user_id,
  round(avg(rating)::numeric, 1) as average_rating,
  count(*) as review_count
from public.reviews
where hidden_at is null
group by reviewee_id;

grant select on public.seller_rating_summaries to anon, authenticated;
