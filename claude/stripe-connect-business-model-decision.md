# Stripe Connect business/legal model — decision required before further payments work

Written in response to a task to "integrate Stripe Connect using current official
Stripe guidance and the business/legal model selected for Pinpals." **No such
model has been formally selected or documented anywhere in this project** —
this doc is the report the task asked for, produced before any
model-dependent code was written. It should go to Pinpals' owner, and to
legal/accounting for sign-off, before the flagged decisions below are locked
in. Citations are Stripe's own current documentation (fetched September 2026).

## Resolved (owner sign-off obtained, September 2026)

The owner answered the three decisions below that had a real fork in the
road. Recorded here so this doc isn't left looking like the questions are
still open — the "Decisions to flag" section below keeps the full reasoning
for each, now with its outcome noted inline.

1. **Charge type — confirmed: destination charges.** No change from what's
   shipped; this was a confirmation of the Stripe-recommended, already-live
   model, not a change.
2. **Merchant of record / `on_behalf_of` — deferred, not implemented.** The
   owner has not yet decided whether Pinpals is merchant of record or a
   pure facilitator, and explicitly chose **not** to implement `on_behalf_of`
   until legal weighs in. Statement descriptor and settlement country stay
   Pinpals' own for now. This decision is still open and should stay on
   legal's list — nothing in this phase closes it.
3. **Chargeback/negative-balance recovery policy toward a seller — still
   open.** Not asked as part of this sign-off round; Pinpals is structurally
   debited first for every dispute regardless (see below), but what happens
   when a clawback from the seller fails or isn't attempted (write off,
   invoice, suspend, threshold) remains undecided and unimplemented.
4. **Refund/fee allocation — confirmed: claw back the seller's share, keep
   Pinpals' commission.** `reverse_transfer: true` (reverse the transfer to
   the seller proportionally to the refunded amount), `refund_application_fee`
   left unset/false (Pinpals does **not** refund its own commission). Implemented
   in this phase — see `src/app/admin/orders/[id]/actions.ts`. This
   introduces a new possible Stripe failure (`balance_insufficient`, when the
   seller's own balance can't cover the clawback), given a specific
   admin-facing message by `refundFailureMessage()`
   (`src/lib/stripe/refunds.ts`) rather than a generic one.

## What already exists (phases 9–12, shipped and live)

Pinpals already has a working Stripe Connect integration:

- **Connected accounts**: one Stripe **Express** account per seller
  (`stripe.accounts.create({ type: "express", ... })`,
  `src/app/dashboard/payouts/actions.ts`), one row per seller in
  `stripe_connected_accounts` (`unique(user_id)`, migration `0020`).
- **Onboarding & account management**: Stripe-hosted Account Links for
  onboarding, and Stripe Express Dashboard login links
  (`stripe.accounts.createLoginLink()`) for sellers to manage their own
  payout details — Pinpals never collects or stores bank/card details itself.
- **Charge type**: **destination charges**. `createOrderPaymentIntent()`
  (`src/app/dashboard/orders/[id]/actions.ts`) creates the PaymentIntent on
  Pinpals' own platform account with `transfer_data.destination` set to the
  seller's connected account id and `application_fee_amount` set to the
  order's snapshotted platform fee. `on_behalf_of` is **not** set.
- **Readiness gating**: listing publish is gated on
  `isSellerPaymentReady(sellerOnboardingStatus(...))` (checks
  `charges_enabled`, `payouts_enabled`, and outstanding requirements), but
  the charge-time check in `createOrderPaymentIntent()` only checks
  `charges_enabled` — narrower than the publish gate.
- **Refunds**: `stripe.refunds.create()` (`src/app/admin/orders/[id]/actions.ts`)
  refunds the buyer but does **not** set `reverse_transfer` or
  `refund_application_fee` — today, a refund is debited entirely from
  Pinpals' own Stripe balance; the seller keeps whatever was already
  transferred to them, and Pinpals does not recover its own commission
  either. Nothing decides this on purpose — it's simply what
  `stripe.refunds.create()` does with no extra parameters.
- **Idempotency**: used for refunds, **not** used for PaymentIntent creation
  (there's a "reuse an existing PaymentIntent" check first, which reduces
  but doesn't eliminate duplicate-creation risk).
- **Fee rate**: `0.07` (7%) is a literal, duplicated independently in three
  places — `src/lib/marketplace.ts`'s `PLATFORM_FEE_RATE`, and inline in two
  SQL functions (`offer_action()`, `create_purchase_order()`) — rather than
  one server-side source of truth.
- **Keys**: `STRIPE_SECRET_KEY` (server-only), `STRIPE_WEBHOOK_SECRET`
  (server-only), `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (client-safe) — correct
  separation already in place. The secret key is a standard secret key
  (`sk_test_...`), not a scoped Stripe **Restricted Key**.

## Current official Stripe guidance (fetched from docs.stripe.com, Sept 2026)

**Charge type.** Stripe's own charge-type comparison
([Understand how charges work in a Connect integration](https://docs.stripe.com/connect/charges))
puts destination charges squarely in Pinpals' shape: "Customers transact with
your platform for products or services provided by your connected accounts…
each transaction involves a single connected account and a single customer" —
exactly one buyer, one seller, one listing, no split payouts. Separate
charges and transfers is explicitly for one-to-many/many-to-one splits,
charges created before the destination account is known, or transfers made
before/independent of the charge settling — none of which describes a
Pinpals sale. Stripe also states plainly that **direct charges aren't
recommended for legacy Express accounts** at all — so given Pinpals already
committed to Express accounts, destination charges isn't just preferred,
it's close to the only sane option of the three. [Recommended Connect
integrations and charge types](https://docs.stripe.com/connect/integration-recommendations)
confirms the same pairing (Express/Custom dashboards ↔ destination or
separate charges) and explicitly recommends, for that pairing, that
**negative-balance liability sit with the platform**, not Stripe — which is
structural anyway for this charge type, not really an optional toggle (see
below). **Conclusion: destination charges is the Stripe-recommended, and
already-implemented, model for Pinpals. I'm not recommending a change here**
— but this is still listed as a decision below because the task asked for
explicit confirmation rather than an assumption.

**Disputes and negative balances.**
[Disputes on Connect platforms](https://docs.stripe.com/connect/disputes) is
unambiguous: "For destination charges and separate charges and transfers,
**with or without `on_behalf_of`**, Stripe debits dispute amounts and fees
from your platform account." Pinpals — not the seller, not Stripe — is
debited first, every time, for every chargeback. Pinpals can *attempt* to
recover the seller's share via a transfer reversal, but that can fail (seller
balance insufficient, or cross-border transfer-reversal restrictions), and if
it fails there is no automatic fallback — Stripe's own guidance for that
case is "wait to recover disputed cross-border payment transfers... until
after a dispute is lost," i.e. manual follow-up. The same "platform is
always responsible for its own negative balances" logic applies to refunds.
**This is structural to destination charges, not a configuration choice** —
choosing this charge type means choosing this liability shape.

**Merchant of record.** Stripe has no literal "merchant of record" field;
it's a legal/contractual role, but two technical facts bear directly on it:
because `on_behalf_of` isn't set, (a) the charge uses **Pinpals'** payment
method configuration and statement descriptor — the buyer's card statement
shows Pinpals, not the seller — and (b) settlement happens in Pinpals'
country. Setting `on_behalf_of` to the seller's connected account id would
flip both of those to the seller's identity (and use the seller's
country-specific fee schedule) while **leaving dispute/refund liability on
the platform exactly as it is now** (per the quote above — "with or without
`on_behalf_of`"). So `on_behalf_of` is a branding/settlement decision, not a
liability one, and it's entangled with how Pinpals describes itself in its
own Terms of Service (a payments facilitator connecting two members, vs. the
selling party). Nothing today states which one Pinpals is.

## Decisions to flag for owner/legal/accounting — not guessed, not implemented

1. **Charge type: confirm destination charges.** Recommended above on
   Stripe's own guidance and already what's shipped in phases 9–10. Low risk
   to confirm as-is; flagged for explicit sign-off per the task's own
   instruction, not because there's a live alternative worth choosing here.

2. **Merchant of record & `on_behalf_of`.** Is Pinpals, contractually, the
   merchant of record for a sale (selling the item, with the member as its
   supplier), or a technology/payments facilitator connecting two members
   directly (the member is the merchant of record)? This decides (a)
   whether `on_behalf_of` should be set, (b) the Terms of Service language
   describing Pinpals' role, and has knock-on consequences for consumer-
   protection duties and how Pinpals' own VAT position on its commission is
   framed. **No code change is gated on this that isn't already covered by
   decision 1** — `on_behalf_of` is a small, isolated change I can make once
   this is answered, but I have not made it.

3. **Chargeback/negative-balance liability.** Confirm Pinpals accepts that
   it is debited first for every dispute and refund (structural to
   destination charges, described above), and decide the **recovery policy**
   toward a seller when Pinpals can't claw back the transferred amount —
   write it off, invoice the seller separately, suspend their account,
   some combination, or a euro threshold under which it's not worth
   pursuing. Nothing in the app enforces or displays this today.

4. **Refund/fee allocation policy.** When an order is refunded, should
   Pinpals: reverse the seller's transfer (claw back their share) —
   `reverse_transfer: true`; refund its own commission back to the buyer —
   `refund_application_fee: true`; both; or neither (today's actual
   behavior, which is very likely accidental rather than a chosen policy —
   it means every refund currently costs Pinpals the full amount while the
   seller keeps their payout). This plausibly differs for a genuine
   seller-agreed return vs. a card-network dispute Pinpals can't influence.
   **This directly gates a real code change** (the `stripe.refunds.create()`
   call in `src/app/admin/orders/[id]/actions.ts`) that I have deliberately
   left untouched pending this decision.

## What was implemented (post owner sign-off)

Generic hardening that held regardless of how the decisions landed, plus the
one item unblocked by decision 4's confirmation:

- Hardened the charge-time seller-readiness check to also verify
  `payouts_enabled` and outstanding requirements (not just `charges_enabled`),
  reusing the same `isSellerPaymentReady()`/`sellerOnboardingStatus()` helpers
  the publish gate already trusts. (`src/app/dashboard/orders/[id]/actions.ts`)
- Centralized the 7% platform fee rate into one server-side source of truth,
  `public.platform_fee_rate()` (migration `0051_platform_fee_configuration.sql`),
  replacing the three independent literals.
- Added an idempotency key to PaymentIntent creation (refunds already had
  one). (`src/app/dashboard/orders/[id]/actions.ts`)
- `reverse_transfer: true` added to refund creation per decision 4, with a
  dedicated friendly error message for the `balance_insufficient` failure
  mode it introduces. (`src/app/admin/orders/[id]/actions.ts`,
  `src/lib/stripe/refunds.ts`)
- Metadata, client-secret exposure, and key separation confirmed already
  correct; still recommend — but can't do from here — rotating to a scoped
  Stripe **Restricted Key** for production instead of the current full
  secret key.

**Still held, pending further decisions:** any change to `on_behalf_of`
(decision 2, deferred to legal), and any policy or code for the seller-side
recovery process when a refund clawback fails (decision 3, not yet asked).
Test mode only throughout this phase; no real money moved.
