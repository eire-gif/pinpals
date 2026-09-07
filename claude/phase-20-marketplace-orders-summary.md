# Phase 20 — Buy Now / accepted-offer checkout (no charging yet)

Implements the checkout step for both marketplace purchase paths — Buy Now
and an accepted private offer — as an atomic, trusted server transaction
that snapshots an immutable order and reserves the listing for a payment
window, plus the checkout page that collects delivery choice and address
before the (already-shipped, unchanged) payment step. No money moves in this
phase. Checkpoint commit: `marketplace-orders`.

## Schema (`supabase/migrations/0050_marketplace_checkout.sql`)

- **`addresses`** — a buyer's saved delivery addresses. Deliberately not on
  `profiles`, whose own SELECT policy is "readable by every signed-in
  member" (0001_init.sql, backing the member directory) — exactly wrong for
  a home address. Instead this replicates the RLS *shape* already
  established for other sensitive per-user rows (`stripe_connected_accounts`,
  0020): own-row + staff read, no anon access at all — that shape is what
  this phase's task means by "the existing secure profile pattern", not the
  `profiles` table itself. Unlike `stripe_connected_accounts`
  (service-role-write-only), a member manages their own addresses directly,
  so ordinary own-row insert/update/delete policies are included too.
- **`orders.checkout_completed_at`** — new nullable marker distinguishing
  "this pending order still needs a delivery choice" from "checkout is
  finalized, only payment is left". The two entry points aren't symmetric in
  when the order is created: a Buy Now purchase has no order until the
  checkout page submits (`create_purchase_order()` creates it already
  carrying the delivery choice, so this is set at INSERT time); an
  accepted-offer purchase already has a `'pending'` order the instant the
  seller accepts (`offer_action()`, 0048 — unchanged by this migration), with
  no delivery info yet, so it needs a second explicit step
  (`finalize_offer_checkout()`) before this flips. The app layer
  (`my-offer-status.tsx`, `dashboard/orders/[id]/page.tsx`) branches on this
  column, not `delivery_method` alone, to decide whether to send a buyer to
  the checkout page first or straight to Pay.
- **Order status transitions, centralized and enforced.** Every status write
  this app has ever performed, across every phase, is exactly one of: a
  fresh row defaulting to `'pending'`; `'pending' -> 'completed'`
  (`apply_order_payment_succeeded`, 0021); `'pending' -> 'cancelled'`
  (`release_expired_offer_reservations`, 0048); or any status
  `-> 'refunded'` (`apply_order_payment_refunded`, 0021).
  `validate_order_status_transition()` is a single BEFORE UPDATE trigger
  enumerating exactly those edges (plus same-value no-ops) and raising on
  anything else — the "one server-side module" the task asked for.
  Deliberately **unconditional**, unlike this schema's other tampering
  guards (`prevent_conversation_tampering`, `prevent_notification_tampering`,
  0045/0049): those bypass trusted writers because their tables have a real
  authenticated-user UPDATE path RLS otherwise allows. `orders` has no
  authenticated/anon UPDATE path at all (0019 revokes it outright), so every
  caller this trigger will ever see is already a trusted SECURITY DEFINER
  function or the service-role client — the only thing worth guarding
  against is a bug in one of those, and a bypass would defeat that entirely.
  Scoped `when (new.status is distinct from old.status)` so it's a no-op for
  the many existing writes that touch other columns (`payment_reference`,
  `payout_status`, the new `delivery_*` columns) — regression-tested against
  orders.test.ts's pre-existing "service-role can update payout_status" case.
- **`create_purchase_order(p_caller_id, p_listing_id, p_delivery_method,
  p_address_id, p_reservation_minutes)`** — the Buy Now transaction, one
  SECURITY DEFINER call (so there's no multi-statement window for a crash to
  leave a half-done purchase). Re-verifies eligibility from scratch (never
  trusts the caller): locks the listing (and, for a Buy-It-Now purchase, the
  auction) with `for update` before checking anything, so two buyers racing
  the same button can't both succeed; rejects self-purchase, a non-active
  listing, and a delivery method the listing doesn't offer; for `'post'`,
  locks the caller's own address row and builds an immutable
  `delivery_detail` snapshot text (never a live FK into `addresses`); derives
  the agreed price from the just-locked listing/auction row, the 7% platform
  fee, and the flat delivery fee — never a client-supplied amount; **no tax
  line** — a considered "not applicable" (peer-to-peer sale between members,
  not Pinpals selling retail stock), not an oversight; inserts the order
  (every column a snapshot from this instant on) and reserves the listing;
  returns only the new order id.
- **`finalize_offer_checkout(p_caller_id, p_order_id, p_delivery_method,
  p_address_id)`** — the accepted-offer counterpart, for the one real
  asymmetry between the two paths: `offer_action()` (0048) already creates
  and reserves the order atomically at accept time, with no notion of
  delivery — deliberately **not** folded into that already-shipped, tested
  function (would mean asking a buyer to pick delivery/an address at the
  exact moment they click "Accept counter", before any checkout page).
  Re-verifies the caller is the order's buyer, the order is still
  genuinely checkout-able (`'pending'`, reservation not lapsed, not already
  paid — the same guards `release_expired_offer_reservations()` and
  `createOrderPaymentIntent()` already apply, re-checked independently), then
  sets `delivery_method`/`delivery_fee_cents`/`delivery_detail` and
  recomputes `total_eur` — the only columns it ever touches, notably never
  `status`, so the transition trigger never even fires for this write. Can
  be called more than once for the same order (a buyer changing their mind
  about delivery before paying).
- **Bug fixed in the same migration**: `orders.delivery_method`'s check
  constraint (0034) still said `in ('collection', 'delivery')` — a
  vocabulary that was never reconciled with the one 0046 actually settled on
  for the rest of the app (`listings.delivery_options`'s own constraint, and
  the `DeliveryOption = "post" | "collection"` TS type). Nothing had ever
  written a real delivery choice onto an order before this phase, so the
  mismatch was latent; `create_purchase_order()`/`finalize_offer_checkout()`
  are the first writers of a real buyer choice here, and the checkout RLS
  tests below caught it immediately (`orders_delivery_method_check`
  violation on any `'post'` purchase). Fixed in place: the constraint now
  reads `in ('collection', 'post')`.
- **Buy Now reservation expiry, previously missing entirely**: the old
  `buyNow()` never set `reservation_expires_at`, so a Buy Now reservation
  never expired via the existing sweep. `create_purchase_order()` now
  populates it (same column/mechanism 0048 introduced for the offer path),
  so `release_expired_offer_reservations()` (unchanged) already covers a Buy
  Now reservation too.

## App layer

- **`src/lib/orders.ts`** (new) — client-side mirrors only, never trusted:
  `DELIVERY_FEE_EUR`/`TAX_TREATMENT` constants, `computeCheckoutTotal()`
  (same arithmetic as the SQL, for live on-screen feedback),
  `ADDRESS_FIELD_LIMITS` (mirrors the migration's check constraints),
  `formatAddress()` (mirrors the SQL's own concatenation exactly, so what a
  buyer sees while picking an address on the checkout page is what lands in
  the order's `delivery_detail`). Order status transitions have **no** TS
  mirror at all, by design — there is no client-writable path to
  `orders.status` for a duplicated copy of that graph to usefully pre-check
  against; the SQL trigger is the sole source of truth.
- **`src/app/checkout/`** (new, shared by both entry points) — `actions.ts`
  (`createAddress()`/`deleteAddress()`, RLS-scoped, rate-limited) and
  `checkout-form.tsx` (`CheckoutForm`): item/seller summary, a
  delivery-method choice scoped to what the listing actually offers, an
  address picker with an inline "add a new one" mini-form (a manual
  `useTransition` handler, not `useActionState` — avoids a synchronous
  `setState` inside `useEffect`, which trips the `react-hooks/
  set-state-in-effect` ESLint rule), a live line-item breakdown via
  `computeCheckoutTotal()`, a buyer-protection/terms checkbox gating submit,
  and a duplicate-submit-proof, recoverable-on-failure submit button
  (disabled while pending, re-enabled with the error still shown on
  failure).
- **`src/app/marketplace/[id]/checkout/`** (new) — Buy Now entry point:
  `page.tsx` auth-gates, re-derives the price server-side (handling
  `auction_with_buy_now` specially), redirects back to the listing for any
  ineligible state, and renders `CheckoutForm`; `actions.ts`'s
  `submitBuyNowCheckout()` calls `create_purchase_order()` via the
  service-role client, snippet-matches known rejection messages into a
  friendly error, best-effort links the conversation to the new order, and
  redirects to `/dashboard/orders/[id]`.
- **`src/app/dashboard/orders/[id]/checkout/`** (new) — accepted-offer entry
  point: `page.tsx` fetches the existing order (must belong to the caller as
  buyer), redirects to the plain order page if not eligible (already paid,
  already checkout-completed, reservation lapsed, or not `'pending'`), and
  renders `CheckoutForm` with `submitLabel="Confirm delivery"`; `actions.ts`'s
  `submitOfferCheckout()` calls `finalize_offer_checkout()` the same way,
  under its own rate-limit bucket.
- **`buy-now-button.tsx`** rewritten from a client component that called a
  Server Action directly into a plain `<Link>` to the new checkout page — the
  old `buyNow()` function (and its rate-limit constants) removed entirely
  from `marketplace/[id]/actions.ts`.
- **`my-offer-status.tsx`** / **`dashboard/orders/[id]/page.tsx`**: the
  buyer's "Complete checkout" / order-detail links now branch on
  `checkout_completed_at` — straight to Pay once delivery is finalized,
  to the new checkout page first otherwise.

## Testing

- `supabase/tests/rls/checkout.test.ts` (new): 35 tests. `addresses` RLS
  (own-row insert/select/update/delete, staff read, a disabled staff member
  has no bypass, anon gets a hard permission-denied — this table revokes
  *all* anon table privileges, stricter than most tables in this schema, so
  that's asserted directly rather than via RLS-filtered zero rows); the
  transition trigger (`pending -> completed`, `pending -> cancelled`, any
  `-> refunded`, every other edge rejected, same-value writes are a no-op,
  the pre-existing `payout_status` write path is unaffected, staff/buyer/
  seller still have no direct write path at all); `create_purchase_order()`
  (collection and post happy paths incl. the exact `delivery_detail` string,
  wrong/missing delivery method, self-purchase, inactive listing, missing/
  foreign address, an unauthenticated caller, an `auction_with_buy_now`
  Buy-It-Now claim that ends the auction, no anon/authenticated direct call,
  two concurrent Buy Now attempts on the same listing — exactly one wins);
  `finalize_offer_checkout()` (collection/post happy paths, callable twice,
  wrong buyer, wrong status, lapsed reservation, already paid, unsupported
  delivery method, a dangling `listing_id` falls back rather than blocking
  checkout, no anon/authenticated direct call). Follows
  offer-workflow-race.test.ts's own pattern of fresh, throwaway,
  directly-committed fixtures for scenarios `withRole()`'s always-rollback
  transaction can't cleanly express (genuine two-party concurrency; a
  multi-step transition sequence that needs an expected rejection followed
  by further assertions on the same row). `npm run test:rls:replay && npm
  run test:rls`: 257 passing (up from 222) across 12 files, zero
  regressions.
- `src/lib/orders.test.ts` (new): 12 tests for `computeCheckoutTotal()`
  (collection vs. post, float-rounding, a zero-price edge case, and a
  round-number case cross-checked against the SQL fixtures above),
  `TAX_TREATMENT`, `formatAddress()` (every field-presence combination,
  including the exact string `finalize_offer_checkout()`'s own fixture
  produces server-side), and `ADDRESS_FIELD_LIMITS`. `npm run test`: 302
  passing (up from 290).
- `npm run typecheck` / `npm run lint`: clean (lint: only the same
  pre-existing `_prev`/`_formData` placeholder warnings elsewhere in the
  codebase).
- `npm run build`: fails only on the same pre-existing sandbox limitation
  every prior phase has hit (no egress to Google Fonts from this
  environment) — confirmed unrelated to this phase's changes.

## Deliberately out of scope / accepted gaps

- No payment collection in this phase — `PayForm`/`createOrderPaymentIntent()`
  (phase 10) are unchanged; this phase only gets an order to the point where
  that existing Pay button becomes available.
- `create_purchase_order()`'s "no Buy Now price" guard has no reachable test
  case — `listings_price_required_for_non_auction_check` (0046) already
  guarantees every non-auction listing carries a price, so the DB itself can
  never produce the row that branch would need. Left in as defense-in-depth
  against that invariant loosening later, not exercised.
- Delivery fee stays a flat, platform-wide `€6.00` (mirrors the existing
  `DELIVERY_FEE_EUR` convention) — nothing in this schema models a seller's
  own per-listing postage cost yet.
- A buyer can change their delivery choice on an accepted-offer order any
  number of times before paying (`finalize_offer_checkout()` is not
  single-use) but cannot change it after `checkout_completed_at` is set on a
  Buy Now order — Buy Now's delivery choice is finalized at purchase time,
  matching how the checkout page frames that flow as one step, not two.
