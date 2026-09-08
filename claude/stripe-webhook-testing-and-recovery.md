# Stripe webhook: local testing and failure recovery

How to exercise Pinpals' one Stripe webhook endpoint (`src/app/api/webhooks/stripe/route.ts`) locally, and what to do when a delivery ends up in `/admin/webhook-events` as `failed`. Written alongside the "marketplace-payments" checkpoint — read `src/lib/stripe/payments.ts`'s own header comment first for how event routing/idempotency actually works; this doc is the operational half.

## Local webhook testing

Pinpals doesn't use `stripe-mock` or committed JSON fixture files — Stripe's own CLI, forwarding real (test-mode) events from a real test-mode Stripe account into your local server, is the established way to exercise this endpoint end to end, signature verification included. This is deliberate: a hand-built fake `Stripe.Event` object can drift from what Stripe actually sends over time, and it would skip the one part of this endpoint that's hardest to get right by hand — signature verification against the raw body.

1. **Install the Stripe CLI** (`brew install stripe/stripe-cli/stripe` or see [stripe.com/docs/stripe-cli](https://stripe.com/docs/stripe-cli)), then `stripe login` against your **test-mode** account. Never do any of this against a live-mode account.

2. **Forward events to your local server.** With `npm run dev` running (default `localhost:3000`):

   ```
   stripe listen --forward-to localhost:3000/api/webhooks/stripe
   ```

   The CLI prints a webhook signing secret (`whsec_...`) the moment it starts — copy that into your local `.env.local` as `STRIPE_WEBHOOK_SECRET` and restart `npm run dev`. This secret is **per `stripe listen` session** and different from whatever's configured on a real Dashboard-registered endpoint (local vs. staging vs. production each have their own).

3. **Trigger a specific event** in another terminal, without needing to actually run a full checkout:

   ```
   stripe trigger payment_intent.succeeded
   stripe trigger payment_intent.payment_failed
   stripe trigger charge.refunded
   stripe trigger charge.dispute.created
   ```

   `stripe trigger` synthesizes a *plausible* event of that type against a throwaway test charge — useful for confirming the endpoint itself is reachable, signature verification passes, and routing doesn't throw, but the synthesized PaymentIntent won't match any real Pinpals order (so it will land in `webhook_events` as `failed`, "No order found with payment_reference ..." — that's the *expected*, correct outcome for a trigger with no matching order, not a bug).

4. **Exercise the real order-linked path** by actually running checkout against a real test order: create a test listing, buy it (or accept an offer) with a second test account, go through `/dashboard/orders/[id]`'s "Pay now" using one of [Stripe's test cards](https://stripe.com/docs/testing) (`4242 4242 4242 4242`, any future expiry, any CVC), and watch `stripe listen`'s own terminal output as the real `payment_intent.succeeded` (and `charge.succeeded`, which carries the Connect transfer id) arrive and get forwarded. This is the only way to see the full loop — PaymentIntent creation → confirmation → webhook → `orders`/`listings` state — actually connect.

5. **Test Connect account events** (`account.updated`, `payout.*`) require "Listen to events on Connected accounts" enabled on whichever endpoint you're forwarding from — for `stripe listen` this is on by default; for a real Dashboard-registered endpoint it's a checkbox on the endpoint's settings page (see `claude/phase-9-stripe-connect-summary.md` / `claude/phase-12-payout-reconciliation-summary.md` for why this matters — those events arrive with `event.account` set, and nothing dispatches them here without it).

6. **Test cancellation** specifically (`payment_intent.canceled` — see this checkpoint's own addition) by starting checkout, then either abandoning the PaymentElement without confirming until the PaymentIntent's own expiry, or cancelling it directly via `stripe payment_intents cancel pi_...` against the test PaymentIntent id shown in the Stripe Dashboard/CLI output.

7. **Replaying a redelivery** on purpose (to check idempotency by hand rather than trusting the automated suite) — the Stripe CLI's own event log (`stripe events resend evt_...`, or the "Resend" button on an event in the test-mode Dashboard) redelivers the exact same event id. It should always come back `{"received": true}` with no visible side effect the second time.

Never point any of the above at a live-mode key or a production `STRIPE_WEBHOOK_SECRET` — `getStripeClient()` (`src/lib/stripe/client.ts`) picks whichever `STRIPE_SECRET_KEY` is in the environment with no separate "are we in test mode" guard of its own, so environment separation is entirely on which `.env` file is loaded.

## Automated tests

- `src/lib/stripe/payments.test.ts` — the pure TS helpers in front of the DB layer (`centsFromEur`, `truncateErrorMessage`, `reconcilePaymentIntentAmount` — the amount/currency reconciliation check, tested directly rather than through a mocked Stripe call).
- `supabase/tests/rls/payments-webhook.test.ts` — the actual state machine: `claim_webhook_event()` idempotency/redelivery, `apply_order_payment_succeeded()` (including the listing `sold` transition and its idempotency/guard behavior), `apply_order_payment_failed()` (including out-of-order-delivery safety — a late `failed` for an order a `succeeded` already settled must change nothing), `apply_order_payment_refunded()` (partial/cumulative refund amounts, `refunded_at` set once), and `create_refund_request()`/`mark_refund_outcome_by_stripe_id()` (multiple refund rows per order, guarded against regressing an already-terminal refund). Run with `npm run test:rls:replay && npm run test:rls`.

This follows the same split every other DB-backed feature in this codebase uses: pure TS logic gets ordinary Vitest unit tests; anything that actually has to prove a Postgres function/trigger/RLS policy behaves correctly gets a test in `supabase/tests/rls/` against a real (local, throwaway) Postgres database, not a mocked Supabase client. No Stripe test-fixture library or `stripe-mock` dependency was introduced — `stripe trigger`/`stripe listen` (above) cover the "does this actually work against Stripe" question; the RLS suite covers "is the state machine itself correct," including scenarios (out-of-order delivery, duplicate delivery) that are awkward to reproduce on demand through Stripe's own CLI.

## Failure recovery

Every verified webhook delivery is claimed in `webhook_events` (`supabase/migrations/0021_payments.sql`) before anything else runs. A delivery this app couldn't route — no matching order, an amount/currency mismatch, a payout for an unknown connected account — is recorded as `failed`, not thrown away, and Stripe is told `200 OK` regardless (see `processStripeEvent()`'s own header comment in `src/lib/stripe/payments.ts` for why: retrying a delivery that will never resolve itself just wastes both sides' time — the fix has to be a human looking at it, or a code/data fix followed by a manual retry).

1. **Find it.** `/admin/webhook-events` (finance-role staff only) lists every delivery, filterable by status and event type. A `failed` row's own detail page (`/admin/webhook-events/[id]`) shows the event type, the stored (already signature-verified) payload, `last_error`, and a link to the related order when one was found.

2. **Diagnose.** The two realistic failure shapes:
   - **"No order found with payment_reference ..."** — the PaymentIntent id on the event doesn't match any `orders.payment_reference`. Usually either a `stripe trigger`-synthesized event (expected, not a real problem — see above), or a genuine data issue worth investigating (was the PaymentIntent actually created through `createOrderPaymentIntent()`? did an order get deleted?).
   - **An amount/currency mismatch** (`reconcilePaymentIntentAmount()`) — Stripe's own reported PaymentIntent amount/currency doesn't match `orders.total_eur`. This should never happen by construction (the PaymentIntent is always created FROM the order's own total), so this is a "something is actually wrong, don't just retry" signal — check whether the order was somehow re-priced after the PaymentIntent was created, or whether this is a stale/replayed test event from a different environment's data.

3. **Fix, then retry.** Once the underlying cause is addressed (or determined to be a harmless synthetic test event not worth acting on), the failed row's own page has a **Retry** button (`retryFailedWebhookEvent()`, `src/app/admin/webhook-events/[id]/actions.ts`). This re-runs the exact same routing logic (`retryWebhookEvent()` → `processStripeEvent()`) against the event's own already-stored, already-signature-verified payload — it never calls Stripe again, so retrying is safe to do any number of times and never re-validates a signature that could have since rotated. Every retry is itself audited (`admin_audit_log`, action `webhook_event.retried`), logging only the event type and outcome, never the payload.

4. **A genuine 5xx (infrastructure failure, not a routing failure)** — the database itself unreachable, or a downstream write throwing in a way `processStripeEvent()` couldn't itself record — is NOT surfaced in `/admin/webhook-events` at all, since the event was never successfully claimed. Stripe's own retry schedule (exponential backoff over the following hours, visible on the event's own page in the Stripe Dashboard) handles this automatically; nothing in this app needs to intervene unless Stripe's own dashboard shows the delivery still failing after its full retry window, at which point the fix is almost always "the app was down" or "the database was unreachable," not a business-logic bug, and the CLI's `stripe events resend evt_...` (or the Dashboard's own "Resend") is what re-delivers it once the underlying outage is fixed.

5. **Never fabricate an order's paid state by hand** in the database to work around a stuck webhook — every path that marks an order paid (`apply_order_payment_succeeded()`) also flips the listing to `sold` and clears `payment_last_error` in the same transaction; a manual `UPDATE` bypasses that and desyncs `orders`/`listings`/`webhook_events` from each other and from Stripe's own record. If a payment genuinely succeeded on Stripe's side but the webhook is stuck, retry the ledger row (step 3) — retrying re-runs the real function, not a shortcut.
