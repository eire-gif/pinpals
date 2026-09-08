# Phase 21 — Stripe Connect business-model sign-off & charge-time hardening

**Branch:** `feature/stripe-connect` (delivered as a patch — `git push` is blocked in this sandbox by the git proxy, same as every prior phase)
**Checkpoint commit message:** `stripe-connect`
**Status:** Business/legal decision report written and answered by the owner before any model-dependent code was touched, per the task's explicit "do not guess" instruction. Approved hardening implemented and fully verified. Test mode / test accounts only — no real money moved.

## What this phase does

The task asked for two things in sequence: first, a report on the business/legal shape of Pinpals' Stripe Connect integration — charge type, merchant of record, dispute/negative-balance liability, refund/fee allocation — flagged for owner/legal/accounting sign-off rather than assumed; second, implementation of the approved model against a specific checklist (seller→account mapping, server-side readiness checks, server-configured fee, order-id metadata, idempotency, safe client secrets, server-only restricted keys, Stripe-hosted account management).

The report is `claude/stripe-connect-business-model-decision.md`, researched directly against current Stripe documentation (`docs.stripe.com/connect/charges`, `/connect/integration-recommendations`, `/connect/disputes`, `/api/refunds/create`, `/error-codes`, fetched September 2026) rather than assumed from training data. It found that Pinpals' existing phase 9–12 integration (Express connected accounts, destination charges, no `on_behalf_of`) was already the Stripe-recommended shape for a one-buyer-one-seller-one-listing marketplace — direct charges aren't even recommended for legacy Express accounts — so nothing about charge type needed to change. It also surfaced that today's refund behavior (no `reverse_transfer`, no `refund_application_fee`) was very likely an accidental default rather than a chosen policy: every refund was silently costing Pinpals the full amount while the seller kept their payout. Four decisions were flagged; the owner answered three via explicit sign-off (see the decision doc's new "Resolved" section):

1. **Charge type — confirmed: destination charges.** No change; confirms what's shipped.
2. **Merchant of record / `on_behalf_of` — deferred, not implemented.** Left for legal. Statement descriptor and settlement country stay Pinpals' own for now.
3. **Chargeback/negative-balance recovery policy toward a seller — still open**, not part of this sign-off round. Pinpals is structurally debited first for every dispute regardless of policy (Stripe: "with or without `on_behalf_of`, Stripe debits dispute amounts and fees from your platform account") — what happens next when a clawback fails remains undecided.
4. **Refund/fee allocation — confirmed: claw back the seller's share, keep Pinpals' commission.** `reverse_transfer: true`, `refund_application_fee` left unset. Implemented this phase.

## Already correct, confirmed (no change needed)

- **Seller → connected account mapping**: one Stripe Express account per seller, one row per seller in `stripe_connected_accounts` (`unique(user_id)`).
- **Order-id metadata**: `pinpals_order_id` attached to both the PaymentIntent (checkout) and the Refund (admin refunds) — was already present for the PaymentIntent, and a `pinpals_refund_id` was already present on refunds.
- **Safe client secrets**: `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is the only Stripe value reaching the browser; card entry happens entirely inside Stripe's own Payment Element iframe (`src/app/dashboard/orders/[id]/pay-form.tsx`) — nothing to change.
- **Restricted keys server-only**: `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are read only in server-only modules (`src/lib/stripe/client.ts`, webhook route) — correct separation already in place. (The key itself is a standard secret key rather than a scoped Restricted Key — see Deferred below.)
- **Stripe-hosted account/payout management**: Account Links for onboarding, Express Dashboard login links (`stripe.accounts.createLoginLink()`) for sellers to manage their own payout details — Pinpals never collects or stores bank details itself.

## What was hardened this phase

- **Server-side readiness check widened at charge time.** `createOrderPaymentIntent()` (`src/app/dashboard/orders/[id]/actions.ts`) previously checked only `charges_enabled` before letting a buyer start paying — narrower than the publish gate. It now reuses the same `isSellerPaymentReady(sellerOnboardingStatus(...))` helpers the publish gate already trusts, which also checks `payouts_enabled` and outstanding requirements (`requirements_currently_due`/`requirements_past_due`), so a seller who can transiently accept charges but can't yet be paid out no longer lets a buyer start a payment into that sale.
- **Platform fee rate centralized.** New migration `supabase/migrations/0051_platform_fee_configuration.sql` adds `public.platform_fee_rate()` — a `SECURITY DEFINER`-callable, `revoke`d-from-`public`/`anon`/`authenticated` SQL function returning `0.07` — as the single server-side source of truth. `offer_action()` and `create_purchase_order()` (previously each inlining the `0.07` literal independently) now both call it. `src/lib/marketplace.ts`'s `PLATFORM_FEE_RATE` constant remains as a display-only mirror (its comment now explains explicitly that it is never trusted for the actual charge — the snapshotted `orders.platform_fee_eur`, derived from `platform_fee_rate()`, is what actually reaches Stripe as `application_fee_amount`), matching the existing manual-mirror discipline already used for other SQL-is-truth values in this codebase.
- **Idempotency key added to PaymentIntent creation.** `stripe.paymentIntents.create()` now passes a stable per-order key (`pinpals-order-${order.id}-create-pi`) — refunds already had this; PaymentIntent creation didn't. Closes the gap between the "reuse an existing PaymentIntent" check and the `order.payment_reference` write: two concurrent submits for the same order now get back the same PaymentIntent from Stripe instead of risking two.
- **Refund fund allocation implemented per decision 4.** `stripe.refunds.create()` (`src/app/admin/orders/[id]/actions.ts`) now passes `reverse_transfer: true`. This introduces a genuinely new failure mode that didn't exist before — Stripe's `balance_insufficient` error, when the seller's own connected-account balance can't cover the clawback. `refundFailureMessage()` (new, `src/lib/stripe/refunds.ts`) gives that specific case a specific, actionable admin-facing message ("...the seller's account can't currently cover it. Try again once their balance recovers, or process it manually from the Stripe Dashboard.") rather than folding it into the generic error; every other error shape still falls back to the existing generic message, with full detail preserved separately in the refund row and admin audit log as before.

## Changed / new files (9)

Migration:
- `supabase/migrations/0051_platform_fee_configuration.sql` — new `platform_fee_rate()` function; `offer_action()`/`create_purchase_order()` updated to call it instead of inlining `0.07`.

RLS tests:
- `supabase/tests/rls/stripe-connect.test.ts` — new: `platform_fee_rate()` returns `0.07`, is unreachable by `anon`/`authenticated` directly, and both order-creation paths still snapshot the correct 7% fee through it. (4 tests)
- `supabase/tests/rls/replay-migrations.sh` — appended `0051` to the replay list.

App code:
- `src/app/dashboard/orders/[id]/actions.ts` — widened seller-readiness check; added PaymentIntent idempotency key.
- `src/app/admin/orders/[id]/actions.ts` — added `reverse_transfer: true`; switched to `refundFailureMessage()`.
- `src/lib/stripe/refunds.ts` — new `refundFailureMessage()`.
- `src/lib/stripe/refunds.test.ts` — new tests for `refundFailureMessage()`. (3 tests)
- `src/lib/marketplace.ts` — updated `PLATFORM_FEE_RATE` comment to document `platform_fee_rate()` as the real source of truth.

Docs (Projects):
- `claude/stripe-connect-business-model-decision.md` — the pre-code decision report, now with a "Resolved" section recording the owner's three answers.

## Verification

- `npm run typecheck` — clean, 0 errors.
- `npm run lint` — 0 errors, 9 pre-existing warnings (unused `_prev`/`_formData` placeholder args in unrelated files, not touched this phase).
- `npm test` — **305/305 unit tests passing** (23 files), including the 3 new `refundFailureMessage()` cases.
- `npm run test:rls:replay` then `npm run test:rls` — **261/261 RLS tests passing** (13 files) against a fresh replay of all migrations through `0051`, including the 4 new `stripe-connect.test.ts` cases.
- `npm run build` — fails only on the known pre-existing sandbox limitation (no network access to Google Fonts at build time); unrelated to this phase's changes and consistent with every prior phase in this environment.

## Deferred / explicitly out of scope

- **`on_behalf_of`** — deliberately not implemented; decision 2 is with legal.
- **Chargeback/negative-balance recovery policy** (decision 3) — not yet asked or decided; no code enforces or displays a recovery process today (write-off, invoice, suspend, threshold).
- **Restricted Key rotation** — recommend rotating `STRIPE_SECRET_KEY` from a standard secret key to a scoped Stripe **Restricted Key** before production; not something this sandbox can do (requires Stripe Dashboard access), documentation-only recommendation.
- **Real money movement** — none in this phase; test mode and test accounts throughout, per the task's explicit instruction.

## Manual test steps

1. Apply migration `0051_platform_fee_configuration.sql` on top of `0050` (or run `npm run test:rls:replay` for the full chain).
2. As a seller with `charges_enabled: true` but `payouts_enabled: false` (or an outstanding requirement) in Stripe test mode, confirm a buyer can no longer start checkout on that seller's order — the "hasn't finished setting up payouts yet" message should now appear where it previously wouldn't have.
3. Create a PaymentIntent for an order, then submit checkout twice in quick succession (e.g. two rapid tab reloads/re-submits); confirm via the Stripe Dashboard (test mode) that only one PaymentIntent was created for that order id.
4. Trigger a refund from `/admin/orders/[id]` on a paid order; confirm in the Stripe Dashboard that the transfer to the seller's connected account was reversed and Pinpals' application fee was **not** refunded.
5. Simulate a `balance_insufficient` refund failure (e.g. a connected test account with an already-negative or zero available balance) and confirm the admin sees the specific clawback-failure message rather than the generic one.
6. Confirm the platform fee shown on a new offer-acceptance or Buy Now order still reads 7% of the agreed price, sourced now from `platform_fee_rate()` rather than an inline literal.

## Delivery note

`git push` to `origin` is blocked in this sandbox by the git proxy ("eire-gif/pinpals is not in this session's authorized repository set"). This phase is delivered as a patch file for the user to apply and push from their own machine, same as every prior phase in this session.
