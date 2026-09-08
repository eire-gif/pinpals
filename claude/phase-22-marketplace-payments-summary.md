# Phase 22 — Marketplace payments: reconciliation, listing-sold, and test/doc coverage

**Branch:** `marketplace-payments` (delivered as a patch — `git push` is blocked in this sandbox by the git proxy, same as every prior phase)
**Checkpoint commit message:** `marketplace-payments`
**Status:** Implemented, verified, documented. Every item in the task's checklist is now either confirmed-already-correct (with the reasoning recorded here) or closed by this phase's changes.

## What this phase does

The task specified a detailed checklist for "the approved Stripe payment flow for marketplace orders." Phases 8–12 and the Stripe Connect hardening checkpoint had already built almost all of it — this phase started with a full audit against the checklist rather than assuming a rebuild was needed, found two real gaps and one test/documentation gap, and closed all three.

## Checklist, item by item

1. **"Create/reuse a PaymentIntent only after revalidating the order server-side."** Already correct, unchanged. `createOrderPaymentIntent()` (`src/app/dashboard/orders/[id]/actions.ts`) re-fetches the order by id (RLS-scoped to the caller's own), re-checks `buyer_id`/`status`/`payment_status`, re-derives the seller's Connect readiness server-side, and reuses an existing still-open PaymentIntent via a live `stripe.paymentIntents.retrieve()` before ever creating a new one — nothing here is trusted from the request beyond which order id to act on.

2. **"Verify webhook signatures from the raw request body."** Already correct, unchanged. `request.text()` (never a parsed body) into `stripe.webhooks.constructEventAsync()`.

3. **"Store each Stripe event ID and process it once; repeated deliveries must be safe."** Already correct, unchanged. `webhook_events` (`0021_payments.sql`), unique on `(provider, event_id)`, `claim_webhook_event()` reports `is_new`/current `status` so a redelivery of an already-`processed` event short-circuits in `processStripeEvent()` before any effect runs.

4. **"Reconcile payment_intent succeeded/failed/cancelled events and relevant Connect account updates."** `succeeded`/`failed`/`account.updated` were already handled. **`payment_intent.canceled` was not — this phase adds it** (`handlePaymentIntentCanceled()`, `src/lib/stripe/payments.ts`), routed onto the same order-side outcome as a failed attempt (there's no separate `canceled` value in `orders.payment_status`; a canceled PaymentIntent needs exactly the same thing a declined one does — the buyer retries).

5. **"Update payment, order and listing state in a database transaction."** Payment+order were already atomic (one Postgres function body = one transaction). **Listing state was the real gap**: nothing anywhere had ever written `listings.status = 'sold'` — `0048_marketplace_offer_workflow.sql`'s own header comment flagged this explicitly at the time ("touching that already-shipped webhook function is out of scope here"). This phase's migration `0053_marketplace_payments_reconciliation.sql` extends `apply_order_payment_succeeded()` to flip the order's listing to `sold` (guarded to `active`/`reserved` only, and only when the order update itself just fired — never re-touching an already-`sold` or moderator-`removed` listing) inside the exact same function/transaction as the order and ledger update.

6. **"Never mark an order paid based on the browser redirect alone."** Already correct, unchanged. `pay-form.tsx`'s `stripe.confirmPayment()` only ever returns control to the browser on an immediate pre-redirect failure; a successful confirmation navigates away entirely. The order detail page renders `orders.payment_status` fresh from the database on every load and never reads `redirect_status`/`payment_intent` from the return URL's query string (verified — no code in `src/app/dashboard/orders/` or `src/app/marketplace/` reads either). The webhook is the only writer of `payment_status = 'paid'`.

7. **"Handle out-of-order events by comparing authoritative Stripe/payment state."** Already correct, unchanged, now with direct test coverage. Every "apply" function re-derives the order's *current* `payment_status` as its own guard (`apply_order_payment_succeeded`/`apply_order_payment_failed` both check `payment_status <> 'paid'`) rather than trusting anything about delivery order — a late `failed`/`canceled` for an order a `succeeded` already settled is a correct no-op; a `failed` followed by a later genuine `succeeded` (a buyer retrying with a different card on the same PaymentIntent) still correctly lands as paid. `apply_order_payment_refunded()` deliberately has no such guard — a refund is only ever caused by a prior successful charge, so "refund before paid" isn't a real delivery-order case Stripe produces, only a theoretical one; reasoned through and left as-is rather than adding speculative guarding.

8. **"Add refund and partial-refund records; never overwrite the original payment record."** Already correct, unchanged. `refunds` (`0023_refunds_and_disputes.sql`) is one row per refund *attempt*, `order_id` is not unique (many refund rows per order — partial refunds are just more rows), and no function anywhere writes to `orders.payment_reference` from a refund path. Newly test-covered this phase (see below) — this was true but entirely untested before now.

9. **"Log safe operational identifiers, never secrets or sensitive payment data."** The webhook route previously logged nothing at all on either failure path (signature failure, infra failure) — safe, but not useful for on-call debugging. This phase adds one `console.error` line to each: a bare "signature verification failed" marker (no signature value, no body) on a bad signature, and `event.id`/`event.type` (Stripe's own opaque, non-secret identifiers — enough to find the delivery in `/admin/webhook-events` or the Stripe Dashboard) on a genuine infrastructure failure. Every other identifier this app already "logs" is the durable, queryable `webhook_events`/`refunds`/`disputes`/`admin_audit_log` rows, which never store a payload beyond what Stripe itself sends (no full card numbers, ever) and are gated to finance-role staff — treated as the actual operational log for this system, console output is now a thin supplement for the cases nothing else would otherwise capture.

10. **"Add automated tests using Stripe fixtures or the repository's established test strategy."** This was the other real gap: `claim_webhook_event()`, `apply_order_payment_succeeded()`, `apply_order_payment_failed()`, `apply_order_payment_refunded()`, `create_refund_request()`, and `mark_refund_outcome_by_stripe_id()` had **zero** test coverage anywhere — not the RLS suite, not a unit test — despite being the core of the payment state machine. New file `supabase/tests/rls/payments-webhook.test.ts` (20 tests) closes this, following the established split in this codebase: pure TS logic (`src/lib/stripe/payments.test.ts`, unchanged, already covered `centsFromEur`/`truncateErrorMessage`/`reconcilePaymentIntentAmount`) gets ordinary Vitest tests; DB state-machine correctness gets a real-Postgres RLS-suite test, never a mocked Supabase client. No `stripe-mock`/fixture-library dependency was introduced — `stripe trigger`/`stripe listen` (documented below) cover "does this work against real Stripe"; the new SQL-level tests cover scenarios that are awkward to reproduce on demand through the CLI (idempotent redelivery, out-of-order delivery, the listing-sold transition and its guards).

11. **"Document local webhook testing and failure recovery."** New doc: `claude/stripe-webhook-testing-and-recovery.md` — Stripe CLI setup (`stripe listen`/`stripe trigger`/`stripe events resend`), test cards, what each event type actually exercises, and the `/admin/webhook-events` failure-recovery workflow (find → diagnose the two realistic failure shapes → retry via the existing admin action → Stripe's own retry schedule for genuine 5xx failures → why a stuck webhook is never worked around with a manual database edit).

## Changed / new files (7)

Migration:
- `supabase/migrations/0053_marketplace_payments_reconciliation.sql` — `apply_order_payment_succeeded()` extended to flip the order's listing to `sold`.

App code:
- `src/lib/stripe/payments.ts` — new `handlePaymentIntentCanceled()`; new `payment_intent.canceled` case in `processStripeEvent()`'s switch.
- `src/app/api/webhooks/stripe/route.ts` — safe-identifier logging on both failure paths; header comment updated to mention `payment_intent.canceled`.

Tests:
- `supabase/tests/rls/payments-webhook.test.ts` — new, 20 tests (see checklist item 10).
- `supabase/tests/rls/replay-migrations.sh` — appended `0053` to the replay list.

Docs (Projects):
- `claude/stripe-webhook-testing-and-recovery.md` — new.

## Verification

- `npm run typecheck` — clean, 0 errors.
- `npm run lint` — 0 errors, 9 pre-existing warnings (unrelated files, not touched this phase).
- `npm test` — **305/305 unit tests passing** (23 files) — unchanged count; no new TS-level tests were needed since the new behavior is either DB-level (covered in the RLS suite) or a straightforward routing addition exercised the same way the existing `payment_intent.payment_failed` case already is.
- `npm run test:rls:replay` then `npm run test:rls` — **282/282 RLS tests passing** (14 files, up from 262) against a fresh replay of all migrations through `0053`, including the 20 new `payments-webhook.test.ts` cases.
- `npm run build` — fails only on the known pre-existing sandbox limitation (no network access to Google Fonts at build time); unrelated to this phase's changes.

## Deferred / explicitly out of scope

- **Releasing a listing back to `active` on `payment_intent.canceled`/`.payment_failed`** — deliberately not done; the reservation-window design (`reservation_expires_at` + `release_expired_offer_reservations()`, `0048`) already lets a buyer retry the same order after a failed attempt, and releasing immediately would pull the listing out from under a buyer mid-retry. Documented in `0053`'s own header comment.
- **A `stripe-mock`/committed-fixture test dependency** — not introduced; the existing split (TS unit tests for pure logic, real-Postgres RLS tests for state-machine correctness, `stripe trigger`/`stripe listen` for genuine end-to-end local verification) already covers this without one, and matches how every other DB-backed feature in this codebase is tested.
- **Refund-before-paid out-of-order guarding on `apply_order_payment_refunded()`** — considered and deliberately left unguarded; a refund is only possible after a real Stripe charge succeeded, so Stripe cannot actually produce this ordering, only a synthetic test could — see checklist item 7.

## Manual test steps

See `claude/stripe-webhook-testing-and-recovery.md` in full. Short version: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`, copy the printed `whsec_...` into `STRIPE_WEBHOOK_SECRET`, then either `stripe trigger payment_intent.succeeded` (checks the endpoint/signature/routing work, will land as `failed`/no-matching-order — expected) or run a real test checkout with card `4242 4242 4242 4242` (checks the full loop, including the new listing-`sold` transition — confirm the listing shows as sold immediately after payment, not just the order).
