# Phase 23 — Marketplace workspaces: buyer/seller dashboard hubs

**Branch:** `marketplace-workspaces` (delivered as a patch — `git push` is blocked in this sandbox by the git proxy, same as every prior phase)
**Checkpoint commit message:** `marketplace-workspaces`
**Status:** Implemented, verified.

## What this phase does

Two new pages on the existing dashboard shell — there is no `dashboard/layout.tsx` to extend; every page under `src/app/dashboard/` is its own freestanding Server Component with its own auth guard, and these two follow that same pattern:

- **`/dashboard/buying`** — purchases by status, active offers and bids, saved items, messages, and delivery/collection details with review actions.
- **`/dashboard/selling`** — listings and listing performance, incoming offers and live auctions, orders requiring action, sales history, available/pending balance and payout history, and account/payout readiness.

Each is one page with a `?tab=` bar (`WorkspaceTabs`, generalized from `dashboard/listings`' existing inline tab bar) over five focused, independently-paginated Server Components. Both are linked from two new cards on the dashboard hub (`src/app/dashboard/page.tsx`'s `QUICK_LINKS`).

## Design decisions worth recording

- **Reuse over rebuild.** `/dashboard/orders`'s order-row markup, `/dashboard/listings`' tab-bar styling, `OffersList` (the seller's existing accept/decline/counter UI, called once per listing group rather than modified to take a multi-listing shape), `FavouriteButton`, `formatTimeRemaining`/`formatPrice`/`formatPriceCents`, `isOfferActionable`, and every existing `*_LABELS`/`*_STYLES` status map are reused as-is. Messages tab is a thin summary linking into the real `/conversations` inbox, not a second messaging UI. Listings performance links to `/dashboard/listings` for actual management; balance/payouts links to `/dashboard/payouts` for onboarding actions. Nothing here recomputes a price, fee, or status — every figure is read straight off a row the DB already computed, or via an existing pure display helper.
- **"Orders requiring action" (seller) is honestly scoped to what the schema can actually answer.** This app has no shipment/fulfilment-tracking column — `orders.status` only ever reaches `pending → completed/cancelled` or `→ refunded` (`validate_order_status_transition()`, 0050). There is no "mark as shipped" step. Rather than inventing one (out of scope for a views-only checkpoint) or silently treating every paid order as forever-pending, the new `isSellerOrderAwaitingFulfilment()`/`sellerFulfilmentLabel()` helpers (`src/lib/orders.ts`) define the queue as every currently paid-and-completed order, oldest first, with the tab's own copy stating plainly that this can't shrink as items ship — an honest queue, not a fabricated state machine.
- **`buyerOrderNextAction()`** (`src/lib/orders.ts`) mirrors the existing `canPay`/`checkoutDeadlinePassed` derivation already inline in `dashboard/orders/[id]/page.tsx` exactly (same conditions, same destination hrefs), so the new purchases list never disagrees with the order detail page it links into. Pure read, no new state-machine mirror — consistent with that file's own header comment on why order-status transitions have no TS-side copy.
- **Two real, additive gaps closed, both narrowly:**
  1. `src/lib/types.ts`'s `Order` type never had `delivery_method`/`delivery_fee_cents`/`delivery_detail` even though the DB has carried them since 0034/0050 — added, additive only.
  2. `Review` had no TS type at all despite `reviews` existing since 0041 — added, additive only.
  3. `payouts` (0024) had only ever had a staff-only SELECT policy. The new balance/payouts tab needs a seller to read their own payout history, so migration `0054_payouts_member_select_policy.sql` adds one own-row SELECT policy — no existing policy, grant, or the table's write-lockdown changes.
- **Live Stripe balance is the one deliberate exception to "read from a DB mirror."** `src/lib/stripe/balance.ts`'s `getConnectAccountBalance()` calls `stripe.balance.retrieve()` live (never cached) since a balance is money in flux — every other Stripe-derived read in this app (`stripe_connected_accounts`, `payouts`) is a DB mirror for exactly the opposite reason. Fails open (`null` on any error) with a "balance unavailable right now" fallback so a live-data hiccup never breaks the page around it. `summarizeBalance()` is split out pure/Stripe-client-free specifically so it's unit-testable without mocking the SDK.
- **Reviews got their first real write path.** `reviews` (0041) already had full RLS/trigger enforcement (`validate_review()`: order must be completed, reviewer/reviewee must be the real participants) but no UI anywhere ever wrote to it. The new `submitReview()` action (`src/app/dashboard/buying/actions.ts`) is a plain regular-client insert with zero re-implemented eligibility checks — the DB's own constraint/trigger is what's trusted, same discipline as every other write in this schema.
- **Pagination is real, not cosmetic.** Every list uses `.range()` + `count: "exact"` (the admin ledger's own established pattern) with a shared `Pagination` component reading/writing a `page` search param. The one exception is a buyer's own "active bids" list (deduped to one row per auction, buyer's own best bid), which is paginated in-memory over a capped 200-row fetch — documented in that file's own comment as a deliberate, bounded exception, not silent behavior.
- **Do not duplicate finance logic — held to literally.** No amount, fee, or total is ever recomputed; every one is read from an existing row or an existing pure formatter. Status vocabulary reuses existing DB-column-driven label/style maps (`ORDER_STATUS_LABELS`, `PAYMENT_STATUS_LABELS`, `SELLER_LISTING_STATUS_LABELS`, `PAYOUT_ROW_STATUS_LABELS`) rather than inventing new ones, with two small new local maps only where no shared one existed for a *display voice* (buyer-perspective offer wording, matching `my-offer-status.tsx`'s own existing unexported map).

## Changed / new files

Migration:
- `supabase/migrations/0054_payouts_member_select_policy.sql` — additive member-facing SELECT policy on `payouts`.

Types:
- `src/lib/types.ts` — added `Order.delivery_method`/`delivery_fee_cents`/`delivery_detail` (existing DB columns, previously untyped) and a new `Review` type (existing table, previously untyped).

Lib:
- `src/lib/orders.ts` — `buyerOrderNextAction()`, `isSellerOrderAwaitingFulfilment()`, `sellerFulfilmentLabel()`.
- `src/lib/stripe/balance.ts` — new, `summarizeBalance()`/`getConnectAccountBalance()`.

Shared dashboard components:
- `src/components/dashboard/pagination.tsx`, `workspace-tabs.tsx`, `next-action-badge.tsx` — new.

Buyer workspace (`src/app/dashboard/buying/`):
- `page.tsx`, `purchases-tab.tsx`, `offers-bids-tab.tsx`, `saved-tab.tsx`, `messages-tab.tsx`, `delivery-reviews-tab.tsx`, `leave-review-form.tsx`, `actions.ts` — all new.

Seller workspace (`src/app/dashboard/selling/`):
- `page.tsx`, `listings-performance-tab.tsx`, `offers-auctions-tab.tsx`, `orders-action-tab.tsx`, `sales-history-tab.tsx`, `balance-payouts-tab.tsx` — all new.

Edited:
- `src/app/dashboard/page.tsx` — two new quick-link cards ("My buying", "My selling").
- `supabase/tests/rls/replay-migrations.sh` — appended `0054`.
- `supabase/tests/rls/admin-only-tables.test.ts` — added the new `payouts` own-row-read coverage (own row readable, another member's row still not, still not writable).
- `src/lib/orders.test.ts` — added coverage for the three new helpers.

Tests:
- `src/lib/stripe/balance.test.ts` — new, `summarizeBalance()`.

## Verification

- `npm run typecheck` — clean, 0 errors.
- `npm run lint` — 0 errors, 9 pre-existing warnings (unrelated files).
- `npm test` — **318/318 unit tests passing** (24 files, up from 305).
- `npm run test:rls:replay` then `npm run test:rls` — **285/285 RLS tests passing** (14 files, up from 282) against a full replay through `0054`.
- `npm run build` — fails only on the known pre-existing sandbox limitation (no network access to Google Fonts at build time); no compile/type errors of this phase's own.

## Deferred / explicitly out of scope

- **A real "mark as shipped/collected" seller action** — would make the "orders requiring action" queue genuinely shrink as items are handled, but means a new order-side tracking column and a new mutation, which is state-machine/workflow scope beyond this checkpoint's "views" framing. Documented as the natural next step in `sellerFulfilmentLabel()`'s own comment.
- **A true DB-level `.range()` pagination for a buyer's active bids** — deduping "one row per auction, my best bid" isn't expressible as a single indexed range query without a window function; the in-memory approach is bounded (200-row fetch cap) and documented rather than silently approximate.
