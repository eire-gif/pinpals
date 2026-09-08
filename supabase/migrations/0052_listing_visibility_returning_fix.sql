-- Fixes a production bug: every "Save as draft" (and, by the same mechanism,
-- every publish) on a new listing failed with "new row violates row-level
-- security policy for table \"listings\"", even though the seller genuinely
-- owned the row they were inserting.
--
-- Root cause: 0045_marketplace_rls_hardening.sql's `listing_is_visible(id)`
-- is the `listings` table's own SELECT policy predicate, and its body
-- re-queries `public.listings` for that same id ("select 1 from
-- public.listings l where l.id = target_listing_id and (...)").  supabase-js's
-- `.insert(...).select("id")` (src/app/marketplace/new/actions.ts) issues
-- `INSERT ... RETURNING id`, and Postgres RLS re-checks the SELECT policy
-- against every RETURNING row. For a row inserted earlier in that SAME
-- command, the function's inner query cannot see it yet — a command cannot
-- observe its own in-flight insert through a fresh sub-query the way it can
-- through the RETURNING row itself — so `listing_is_visible()` always
-- evaluated false for a brand-new listing and the whole INSERT was rejected
-- as an RLS violation, on every single listing creation. Confirmed live:
-- reproduced directly against production with `insert ... returning id`
-- (fails) vs. a plain `insert` with no RETURNING (succeeds), and confirmed
-- `listing_is_visible()` itself works correctly against any row that
-- already existed before the current statement.
--
-- This never showed up in supabase/tests/rls/listings.test.ts because that
-- suite's INSERT coverage never chained a RETURNING clause the way
-- supabase-js's `.select()` does — a gap now closed alongside this fix (see
-- listings.test.ts).
--
-- Fix: give the `listings` table's own SELECT policy a predicate that
-- decides visibility from the row's own column values directly (status,
-- seller_id — both already in hand at policy-evaluation time), instead of
-- re-deriving them by querying `listings` again. `listing_images`/`auctions`
-- keep calling the original `listing_is_visible(listing_id)` unchanged —
-- those two tables are never the row being inserted when that predicate
-- runs, so they never hit this self-visibility gap; only `listings`' own
-- policy needed to stop querying itself.
--
-- Rollback:
--   drop policy if exists "listings are readable unless removed" on public.listings;
--   create policy "listings are readable unless removed" on public.listings
--     for select to public using (public.listing_is_visible(id)); -- 0045's version
--   drop function if exists public.listing_is_visible_row(text, uuid, bigint);

create or replace function public.listing_is_visible_row(
  target_status text,
  target_seller_id uuid,
  target_listing_id bigint
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    target_status = 'active'
    or target_seller_id = auth.uid()
    or public.is_staff()
    or exists (
      select 1 from public.offers o
      where o.listing_id = target_listing_id and o.buyer_id = auth.uid()
    )
    or exists (
      select 1 from public.orders ord
      where ord.listing_id = target_listing_id
        and (ord.buyer_id = auth.uid() or ord.seller_id = auth.uid())
    );
$$;

revoke all on function public.listing_is_visible_row(text, uuid, bigint) from public;
grant execute on function public.listing_is_visible_row(text, uuid, bigint) to anon, authenticated;

drop policy if exists "listings are readable unless removed" on public.listings;
create policy "listings are readable unless removed"
  on public.listings for select
  to public
  using (public.listing_is_visible_row(status, seller_id, id));
