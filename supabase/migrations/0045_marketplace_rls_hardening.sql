-- RLS hardening pass across the marketplace tables introduced/extended in
-- 0032-0044, closing gaps found while writing this phase's policy tests:
--
-- 1. `listings` (and, by extension, `listing_images`/`auctions`) were
--    readable by anyone as long as `status <> 'removed'` — meaning a
--    `draft`, `pending_review`, or `expired` listing (statuses introduced by
--    0035, after the "readable unless removed" policy was last written) was
--    publicly visible, not just `active` ones. `public.listing_is_visible()`
--    is the new single predicate for "can this caller see this listing (and
--    its images/auction)", replacing the three separate ad-hoc `exists`
--    checks that had grown out of sync with each other.
-- 2. Sellers could update or hard-delete their own listing in ANY status
--    (including `reserved`/`sold`), and could set `status` to any other
--    value with no validation at all — no enforcement of "only draft/active
--    are editable" or of a sane state machine. `listings_validate_status_
--    transition` (trigger) plus a tightened UPDATE/DELETE `using` clause
--    close this.
-- 3. `bids` had no read path for anyone except the bidder themselves or the
--    auction's seller — no way to show public bid history (amount + time)
--    without also exposing `bidder_id`. `public.auction_bid_history` is a
--    curated view for exactly that: the columns it selects are the whole
--    privacy boundary, so no RLS policy on `bids` itself needs to change.
-- 4. `notifications`' "mark as read" UPDATE policy asserted `user_id =
--    auth.uid()` in `with check`, but nothing stopped an owner from also
--    rewriting `title`/`body`/`type`/`data` on their own notification via
--    the same UPDATE (RLS is row-level, not column-level, so the policy
--    alone can't express this). `prevent_notification_tampering` (trigger)
--    closes it.
-- 5. `reviews`' INSERT policy only asserted `reviewer_id = auth.uid()` —
--    the order-completed / correct-pairing checks lived solely in the
--    `validate_review()` trigger. Tightened to match, as defense-in-depth
--    consistent with the `offers`/`bids` self-dealing pattern (0044/0039).
--
-- Nothing here loosens any existing access — every change either narrows an
-- existing policy or adds a new, additive read surface (the bid-history
-- view) that exposes strictly less than the table it's drawn from.
--
-- Rollback:
--   drop view if exists public.auction_bid_history;
--   drop trigger if exists reviews_validate on public.reviews; -- re-run 0041's version if fully reverting
--   drop trigger if exists notifications_prevent_tampering on public.notifications;
--   drop function if exists public.prevent_notification_tampering();
--   drop trigger if exists listings_validate_status_transition on public.listings;
--   drop function if exists public.validate_listing_status_transition();
--   -- then re-run the policy bodies from 0028/0036/0039/0041 to restore the
--   -- pre-0045 `using`/`with check` expressions.
--   drop function if exists public.listing_is_visible(bigint);

-- ============ public.listing_is_visible() ============
-- SECURITY DEFINER so it can be called from `listings`' own SELECT policy
-- without recursing back through that same policy (same reasoning as
-- `is_staff()` in 0007) — it reads `listings`/`offers`/`orders` directly,
-- bypassing their RLS internally, and applies its own authorization logic.
-- Granted to `anon` too (unlike `is_staff()`): the `status = 'active'`
-- branch has to work for anonymous browsing, and every other branch is
-- already a no-op for anon (auth.uid() is null, so seller/offer/order/staff
-- checks all evaluate false).
create or replace function public.listing_is_visible(target_listing_id bigint)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.listings l
    where l.id = target_listing_id
      and (
        l.status = 'active'
        or l.seller_id = auth.uid()
        or public.is_staff()
        or exists (
          select 1 from public.offers o
          where o.listing_id = l.id and o.buyer_id = auth.uid()
        )
        or exists (
          select 1 from public.orders ord
          where ord.listing_id = l.id
            and (ord.buyer_id = auth.uid() or ord.seller_id = auth.uid())
        )
      )
  );
$$;

revoke all on function public.listing_is_visible(bigint) from public;
grant execute on function public.listing_is_visible(bigint) to anon, authenticated;

-- ============ listings: SELECT ============
drop policy if exists "listings are readable unless removed" on public.listings;
create policy "listings are readable unless removed"
  on public.listings for select
  to public
  using (public.listing_is_visible(id));

-- ============ listings: UPDATE / DELETE, restricted to draft/active ============
-- Sellers may still freely edit (or self-delete) a `draft` or `active`
-- listing of their own. Once it's left that pair of statuses (reserved,
-- sold, expired, pending_review, removed), only staff can touch the row
-- through RLS — the seller's own legitimate `active -> reserved/sold/
-- expired/removed` transition is still allowed by this same clause, since
-- it's evaluated against the row's CURRENT (pre-update) status.
drop policy if exists "users can update their own listings" on public.listings;
create policy "users can update their own listings"
  on public.listings for update
  to authenticated
  using (
    ((select auth.uid()) = seller_id and status in ('draft', 'active'))
    or public.is_staff()
  )
  with check (
    (select auth.uid()) = seller_id
    or public.is_staff()
  );

drop policy if exists "users can delete their own listings" on public.listings;
create policy "users can delete their own listings"
  on public.listings for delete
  to authenticated
  using (
    ((select auth.uid()) = seller_id and status in ('draft', 'active'))
    or public.is_staff()
  );

-- ============ listings: status transition state machine ============
-- Fires for every UPDATE regardless of role (triggers are not subject to
-- RLS), so it has to recognise the trusted/service-role path itself: a
-- privileged caller is one with no end-user JWT at all (auth.uid() is null
-- — true for the service-role client every admin Server Action uses, see
-- src/app/admin/listings/[id]/actions.ts's remove/restore, and for direct
-- superuser/SQL access) or an authenticated staff member. Everyone else
-- (an ordinary seller updating through RLS) is restricted to the listed
-- transitions; anything else raises.
create or replace function public.validate_listing_status_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if auth.uid() is null or public.is_staff() then
    return new;
  end if;

  if not exists (
    select 1 from (values
      ('draft', 'pending_review'),
      ('draft', 'removed'),
      ('pending_review', 'removed'),
      ('active', 'reserved'),
      ('active', 'sold'),
      ('active', 'expired'),
      ('active', 'removed'),
      ('reserved', 'active'),
      ('reserved', 'sold'),
      ('reserved', 'removed'),
      ('expired', 'active'),
      ('expired', 'removed')
    ) as allowed(from_status, to_status)
    where allowed.from_status = old.status and allowed.to_status = new.status
  ) then
    raise exception 'Invalid listing status transition from % to %', old.status, new.status;
  end if;

  return new;
end;
$$;

revoke execute on function public.validate_listing_status_transition() from public, anon, authenticated;

drop trigger if exists listings_validate_status_transition on public.listings;
create trigger listings_validate_status_transition
  before update on public.listings
  for each row
  execute function public.validate_listing_status_transition();

-- ============ listing_images: SELECT, aligned with listing_is_visible() ============
drop policy if exists "listing images are readable unless listing removed" on public.listing_images;
create policy "listing images are readable unless listing removed"
  on public.listing_images for select
  to public
  using (public.listing_is_visible(listing_id));

-- ============ auctions: SELECT, aligned with listing_is_visible() ============
drop policy if exists "auctions are readable unless listing removed" on public.auctions;
create policy "auctions are readable unless listing removed"
  on public.auctions for select
  to public
  using (public.listing_is_visible(listing_id));

-- ============ bids: public, anonymised bid history ============
-- Deliberately broader than listing_is_visible() (that predicate hides
-- reserved/sold/expired listings from the general public, but a bid
-- history is exactly the kind of thing that stays interesting — "what did
-- this sell for" — after the auction has ended). The only gate here is
-- moderation removal, matching the platform-wide "removed means hidden
-- from everyone but the seller/staff" convention. Column list is the
-- entire privacy boundary: no bidder_id, no bid id tied back to a specific
-- user — just what the auction sold for and when.
create or replace view public.auction_bid_history as
select
  b.auction_id,
  b.amount_cents,
  b.currency,
  b.created_at
from public.bids b
join public.auctions a on a.id = b.auction_id
join public.listings l on l.id = a.listing_id
where l.status <> 'removed';

grant select on public.auction_bid_history to anon, authenticated;

-- ============ notifications: prevent content tampering via "mark read" ============
-- The existing UPDATE policy's `with check` only reasserts `user_id =
-- auth.uid()` — it can't express "and no other column changed" (RLS is
-- row-level, not column-level). This trigger is that column-level guard:
-- an ordinary user may only ever flip `read_at`; a privileged caller
-- (service role / staff, same test as the listings trigger above) is
-- unrestricted, since this table is meant to be system-populated.
create or replace function public.prevent_notification_tampering()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_staff() then
    return new;
  end if;

  if new.user_id is distinct from old.user_id
    or new.type is distinct from old.type
    or new.title is distinct from old.title
    or new.body is distinct from old.body
    or new.data is distinct from old.data
    or new.created_at is distinct from old.created_at
  then
    raise exception 'Notifications may only have read_at updated by their owner';
  end if;

  return new;
end;
$$;

revoke execute on function public.prevent_notification_tampering() from public, anon, authenticated;

drop trigger if exists notifications_prevent_tampering on public.notifications;
create trigger notifications_prevent_tampering
  before update on public.notifications
  for each row
  execute function public.prevent_notification_tampering();

-- ============ reviews: tighten INSERT to match validate_review() ============
-- Defense-in-depth alongside the existing `validate_review()` BEFORE INSERT
-- trigger (0041) — the trigger remains the source of truth (it also covers
-- UPDATE, which RLS can't easily re-derive since `order_id`/`reviewee_id`
-- are only known from the row itself), but the INSERT policy no longer
-- waves through a request that the trigger is guaranteed to reject anyway.
drop policy if exists "participants can review their completed orders" on public.reviews;
create policy "participants can review their completed orders"
  on public.reviews for insert
  to authenticated
  with check (
    (select auth.uid()) = reviewer_id
    and exists (
      select 1 from public.orders o
      where o.id = reviews.order_id
        and o.status = 'completed'
        and (
          (o.buyer_id = reviewer_id and o.seller_id = reviewee_id)
          or (o.seller_id = reviewer_id and o.buyer_id = reviewee_id)
        )
    )
  );
