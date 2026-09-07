-- Listing creation workflow: the fields and guardrails the full create/edit
-- flow (src/app/marketplace/new/, src/app/marketplace/[id]/edit/) needs on
-- top of what 0003/0035/0036/0039 already store.
--
-- Note on Storage: 0003_marketplace.sql already provisions the
-- "listing-images" bucket (public read, 5MB file_size_limit,
-- allowed_mime_types restricted to jpeg/png/webp) and ownership-scoped
-- INSERT/UPDATE/DELETE policies keyed on the `${auth.uid()}/...` upload-path
-- convention — this migration does NOT need to (re)create any of that. The
-- image-limit trigger below is the one genuinely new Storage-adjacent piece:
-- 0003's policies bound WHO can write an object, not HOW MANY a listing may
-- have.
--
-- Rollback:
--   drop trigger if exists listing_images_enforce_limit on public.listing_images;
--   drop function if exists public.enforce_listing_image_limit();
--   drop trigger if exists listings_prevent_edit_during_live_auction on public.listings;
--   drop function if exists public.prevent_listing_edit_during_live_auction();
--   drop trigger if exists auctions_prevent_edit_after_first_bid on public.auctions;
--   drop function if exists public.prevent_auction_edit_after_first_bid();
--   create or replace function public.validate_bid() ... -- restore 0039's version
--   alter table public.auctions drop column if exists min_increment_cents;
--   alter table public.listings drop constraint if exists listings_price_required_for_non_auction_check;
--   alter table public.listings drop column if exists collection_notes;
--   alter table public.listings drop column if exists delivery_options;
--   alter table public.listings drop column if exists currency;
--   alter table public.listings drop column if exists price_cents;
--   alter table public.listings drop column if exists subcategory;
--   update public.listings set price_eur = 0 where price_eur is null; alter table public.listings alter column price_eur set not null;

-- ============ listings: new creation-flow fields ============
-- price_cents/currency are ADDITIVE, not a replacement for price_eur
-- (0003) — every existing reader (offers, orders' computeOfferTotal(),
-- listing cards, formatPrice()) stays on price_eur unchanged; this phase's
-- create/edit actions keep both in sync (price_eur = price_cents / 100.0)
-- so nothing downstream has to change. New auction listings leave both
-- null — an auction's price lives on its own `auctions` row instead (see
-- below), never duplicated onto `listings`.
--
-- price_eur was `not null` since 0003 (every listing pre-dating auctions was
-- necessarily fixed_price/offers_allowed, so it always had a price). Auction
-- listings break that assumption, so the column has to allow null now too —
-- the existing `check (price_eur >= 0)` already tolerates null on its own
-- (a null comparison is neither true nor false, so the CHECK still passes),
-- it's only the NOT NULL that has to go.
alter table public.listings alter column price_eur drop not null;
alter table public.listings add column if not exists subcategory text;
alter table public.listings add column if not exists price_cents integer;
alter table public.listings add column if not exists currency text not null default 'eur';
alter table public.listings add column if not exists delivery_options text[] not null default '{}';
alter table public.listings add column if not exists collection_notes text;

-- Backfill price_cents for every pre-existing row from price_eur, so the
-- "required for non-auction listings" check below can be added without
-- breaking any row created before this migration (every listing before now
-- was necessarily fixed_price/offers_allowed — auctions didn't exist as a
-- selectable sale_type in any UI until this phase).
update public.listings
  set price_cents = round(price_eur * 100)::integer
  where price_cents is null;

alter table public.listings drop constraint if exists listings_price_cents_check;
alter table public.listings add constraint listings_price_cents_check
  check (price_cents is null or price_cents > 0);

alter table public.listings drop constraint if exists listings_currency_check;
alter table public.listings add constraint listings_currency_check
  check (currency = 'eur');

alter table public.listings drop constraint if exists listings_delivery_options_check;
alter table public.listings add constraint listings_delivery_options_check
  check (delivery_options <@ array['post', 'collection']);

alter table public.listings drop constraint if exists listings_collection_notes_length_check;
alter table public.listings add constraint listings_collection_notes_length_check
  check (collection_notes is null or char_length(collection_notes) <= 500);

-- A fixed-price/offers-allowed listing must carry a price_eur (the
-- pre-existing invariant from 0003, just now spelled out explicitly since
-- the column itself is nullable going forward); an auction listing must
-- carry neither price column (its price lives on `auctions` — see header
-- comment). price_cents itself is intentionally NOT required here for
-- non-auction listings — it's the new create/edit flow's field going
-- forward (kept in sync with price_eur by that flow), but plenty of
-- legitimate non-auction writes (existing fixtures/seed data, any future
-- direct write) still only set price_eur, and there's no correctness reason
-- to force every such write to also compute price_cents. App-layer
-- validation (src/lib/validation/listing.ts) enforces the fuller "both are
-- required together" rule for the new form; this is the defense-in-depth
-- copy of the one invariant that's actually load-bearing at the DB layer —
-- an auction never carries a listing-level price.
alter table public.listings drop constraint if exists listings_price_required_for_non_auction_check;
alter table public.listings add constraint listings_price_required_for_non_auction_check
  check (
    (sale_type in ('auction', 'auction_with_buy_now') and price_cents is null and price_eur is null)
    or (sale_type not in ('auction', 'auction_with_buy_now') and price_eur is not null)
  );

-- ============ auctions: minimum bid increment ============
-- Bare presence of this column doesn't enforce anything by itself —
-- validate_bid() below is what actually rejects an under-increment bid; a
-- column any bidder could otherwise ignore would be exactly the kind of
-- "UI-only rule" this schema avoids everywhere else.
alter table public.auctions add column if not exists min_increment_cents integer not null default 100;

alter table public.auctions drop constraint if exists auctions_min_increment_cents_check;
alter table public.auctions add constraint auctions_min_increment_cents_check
  check (min_increment_cents > 0);

-- Re-run validate_bid() (0039) with one addition: a bid over an existing
-- high bid must now clear it by at least min_increment_cents, not just
-- exceed it by any amount. The very first bid on an auction is unaffected —
-- it only ever has to clear starting_price_cents, same as before.
create or replace function public.validate_bid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_ends_at timestamptz;
  v_starting_price_cents integer;
  v_min_increment_cents integer;
  v_listing_seller_id uuid;
  v_current_high integer;
begin
  select a.status, a.ends_at, a.starting_price_cents, a.min_increment_cents, l.seller_id
    into v_status, v_ends_at, v_starting_price_cents, v_min_increment_cents, v_listing_seller_id
    from public.auctions a
    join public.listings l on l.id = a.listing_id
    where a.id = new.auction_id
    for update of a;

  if not found then
    raise exception 'Auction % not found', new.auction_id;
  end if;

  if v_listing_seller_id = new.bidder_id then
    raise exception 'Sellers cannot bid on their own listing';
  end if;

  if v_status not in ('scheduled', 'live') then
    raise exception 'Auction % is not open for bidding (status: %)', new.auction_id, v_status;
  end if;

  if now() > v_ends_at then
    raise exception 'Auction % has already ended', new.auction_id;
  end if;

  select max(amount_cents) into v_current_high
    from public.bids
    where auction_id = new.auction_id;

  if v_current_high is null then
    if new.amount_cents < v_starting_price_cents then
      raise exception 'Bid must be at least the starting price (% cents)', v_starting_price_cents;
    end if;
  elsif new.amount_cents < v_current_high + v_min_increment_cents then
    raise exception 'Bid must be at least % cents above the current highest bid (% cents)',
      v_min_increment_cents, v_current_high;
  end if;

  return new;
end;
$$;

revoke execute on function public.validate_bid() from public, anon, authenticated;

-- ============ Prevent edits that would invalidate a live auction ============
-- "Live" here means the same thing apply_new_bid() (0039) already uses to
-- flip status away from 'scheduled' on the first accepted bid — status <>
-- 'scheduled' is exactly "has this auction received its first bid", no new
-- flag needed. Both triggers below let a privileged caller (no end-user JWT
-- — the service-role client every admin action already uses — or staff)
-- through unconditionally, same "who is actually privileged" test as
-- 0045's validate_listing_status_transition()/prevent_notification_tampering().
--
-- Note that neither `auctions` nor `bids` has any UPDATE policy granted to
-- `authenticated` at all (0039 revoked it outright) — so an ordinary seller
-- already has no RLS path to update their own auction row, full stop. The
-- app's editAuction()-equivalent server action necessarily goes through the
-- service-role client and re-checks status = 'scheduled' itself before
-- writing (mirroring src/app/marketplace/[id]/actions.ts's publishListing());
-- this trigger is the defense-in-depth backstop for that re-check, not the
-- only thing enforcing it.
create or replace function public.prevent_auction_edit_after_first_bid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_staff() then
    return new;
  end if;

  if old.status <> 'scheduled' and (
    new.starting_price_cents is distinct from old.starting_price_cents
    or new.reserve_price_cents is distinct from old.reserve_price_cents
    or new.buy_now_price_cents is distinct from old.buy_now_price_cents
    or new.min_increment_cents is distinct from old.min_increment_cents
    or new.starts_at is distinct from old.starts_at
    or new.ends_at is distinct from old.ends_at
  ) then
    raise exception 'This auction has already received a bid and can no longer be changed';
  end if;

  return new;
end;
$$;

revoke execute on function public.prevent_auction_edit_after_first_bid() from public, anon, authenticated;

drop trigger if exists auctions_prevent_edit_after_first_bid on public.auctions;
create trigger auctions_prevent_edit_after_first_bid
  before update on public.auctions
  for each row
  execute function public.prevent_auction_edit_after_first_bid();

-- Mirrors the trigger above for the LISTING row itself: once its auction has
-- a first bid, the core "what is this bid actually for" fields can no longer
-- change either — title/description/category/subcategory/condition/
-- price_cents/currency/sale_type. Everything else (delivery_options,
-- collection_notes, county) stays editable, since none of it changes what a
-- bidder already bid on.
create or replace function public.prevent_listing_edit_during_live_auction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has_live_auction boolean;
begin
  if auth.uid() is null or public.is_staff() then
    return new;
  end if;

  if new.title is distinct from old.title
    or new.description is distinct from old.description
    or new.category is distinct from old.category
    or new.subcategory is distinct from old.subcategory
    or new.condition is distinct from old.condition
    or new.price_cents is distinct from old.price_cents
    or new.currency is distinct from old.currency
    or new.sale_type is distinct from old.sale_type
  then
    select exists (
      select 1 from public.auctions a
      where a.listing_id = old.id and a.status <> 'scheduled'
    ) into v_has_live_auction;

    if v_has_live_auction then
      raise exception 'This listing''s auction has already received a bid — these fields can no longer be changed';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.prevent_listing_edit_during_live_auction() from public, anon, authenticated;

drop trigger if exists listings_prevent_edit_during_live_auction on public.listings;
create trigger listings_prevent_edit_during_live_auction
  before update on public.listings
  for each row
  execute function public.prevent_listing_edit_during_live_auction();

-- ============ listing_images: enforce the agreed image limit ============
-- MAX_LISTING_IMAGES in src/lib/marketplace.ts is the app-facing constant —
-- kept equal to the literal 8 here by convention (documented in both
-- places), same "app validation duplicates the DB check for usability, DB
-- check is what's actually trusted" split as everywhere else in this phase.
create or replace function public.enforce_listing_image_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.listing_images where listing_id = new.listing_id) >= 8 then
    raise exception 'A listing may have at most 8 images';
  end if;
  return new;
end;
$$;

revoke execute on function public.enforce_listing_image_limit() from public, anon, authenticated;

drop trigger if exists listing_images_enforce_limit on public.listing_images;
create trigger listing_images_enforce_limit
  before insert on public.listing_images
  for each row
  execute function public.enforce_listing_image_limit();

