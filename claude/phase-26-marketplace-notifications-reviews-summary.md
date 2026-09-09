# Phase 26 — marketplace-notifications-reviews: notifications, email, and review moderation

Checkpoint commit: `marketplace-notifications-reviews`, branched from `main` at `53b29e8` (marketplace-trust-safety merged).

## What this phase does

Implements marketplace notifications end-to-end — new message; offer received/countered/accepted/declined/
expiring; outbid, auction ending, auction won/lost; payment succeeded/failed; seller action required;
refund/dispute updates; review available — with an in-app record always stored, preference-aware email where
appropriate, deduplication by event key, no sensitive personal/payment detail ever reaching an email,
direct links to the relevant authenticated screen, and a transactional/optional preference split. Also
implements reviews to the task's fuller spec: participant-and-completed-order-only, one per reviewer/order/
role (already true — 0041), structured rating plus short text (already true), report/moderation without
silent deletion (new), and efficient rating summaries (new).

A research pass (an exhaustive Explore survey demanding EXISTS/PARTIAL/DOES NOT EXIST verdicts against the
`notifications` table, `notify_user()`, the `reviews` table/RLS/triggers, the reports queue, and every
"existing notification/email system" the task's own wording assumed) found a real gap between what the task
implied and what existed. The `notifications` table (0042) and a bare `notify_user()` (0048) were real, and
offer-lifecycle events already fired through them — but **no outbound email system existed anywhere in this
app**, beyond Supabase Auth's own locked, default-template password-reset email (see
`claude/password-reset-setup.md`). Dedup, preferences, and every non-offer event category (auctions, messages,
payments, refunds/disputes, reviews) were unbuilt. This phase is explicit about that gap rather than
pretending an email system was reused when one had to be built.

## The one migration: `0056_marketplace_notifications_reviews.sql`

**Dedup via a partial unique index, not an app-code check.** `notifications.dedupe_key text` +
`notifications_user_dedupe_key_idx on (user_id, dedupe_key) where dedupe_key is not null`; `notify_user()`
does `insert ... on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing`. A caller that
passes no key gets the old (pre-0056) no-dedup behaviour; every new call site passes a stable one (e.g.
`offer:<id>:accepted:buyer`, `stripe:<payment_intent_id>:payment_succeeded:buyer`).

**Preferences: the transactional/optional split is a CHECK constraint, not a runtime branch.**
`notification_preferences(user_id, category, email_enabled, updated_at)`, `category` constrained to
`'messages' | 'offers' | 'auctions' | 'reviews'` only. `payments`/`disputes_refunds` cannot have a row here
at all — always-on email for those two is guaranteed by the schema, not by an app-code check someone could
forget or bypass.

**Every existing offer-lifecycle notification retrofitted with a link and a dedupe key.**
`offer_action()`, `release_expired_offer_reservations()`, `invalidate_offers_on_listing_unavailable()`
(all `CREATE OR REPLACE`, same business logic as 0048/0055) now pass `jsonb_build_object('href', ...)` and
a stable dedupe key on every `notify_user()` call — `offer_action()` additionally captures the new order's
id so the accept-path notifications link to `/dashboard/orders/<id>`, not just the listing.

**Offer-received needed a new trigger, not a change to the existing one.** `prepare_and_validate_offer()`
is a `BEFORE INSERT` trigger — `offers.id` (identity column) doesn't exist yet inside it. A separate
`notify_seller_of_new_offer()` `AFTER INSERT` trigger (`offers_notify_on_create`) fires `offer_received` to
the seller instead.

**Outbid hooks the one place a bid is ever accepted.** `apply_new_bid()` (0039, `CREATE OR REPLACE`) now
looks up the auction's previous `winning_bid_id`'s bidder *before* updating it, and — if a different bidder
is being displaced — fires `outbid` to them.

**Auction ending/won/lost needed a brand-new sweep, since no auto-close mechanism ever existed.**
`run_auction_sweeps()` is new, called from the same opportunistic, no-`pg_cron`, "sweep on page load"
pattern 0048 already established for offer expiry (see `runOfferSweeps()` below) — no phase before this one
gave a `status='live'` auction any way to actually close once `ends_at` passed. One call does two things:
(a) for any live auction within 2 hours of ending, notifies the *current* highest bidder `auction_ending_soon`
(dedupe key `auction:<id>:ending_soon` makes repeated calls harmless); (b) for any scheduled/live auction past
`ends_at`, locks it, sets `status='ended'`, determines the winner (reserve-price-aware), and fires
`auction_won` to the winner, `auction_ended` to the seller, and `auction_lost` to every other distinct bidder.

**Reviews reuse messages' hidden_at/hidden_by/hidden_reason shape, but needed their own tampering trigger.**
Unlike `messages` (which has *no* authenticated UPDATE policy at all, making hiding a pure service-role
concern), `reviews` already had one — a reviewer editing their own rating/body. A new
`prevent_review_moderation_tampering()` `BEFORE UPDATE` trigger (mirroring `prevent_notification_tampering()`/
`prevent_conversation_tampering()`) blocks a non-staff caller from touching the three moderation columns on
their own row while still letting them edit `rating`/`body`.

**Reviews' public SELECT policy now excludes hidden reviews — and that surfaced two real, self-caught bugs
in this same migration**, both found by the RLS test suite before this branch existed anywhere but locally:

1. The new policy's own `drop policy if exists "Reviews are publicly readable" on public.reviews;` was
   spelled with a capital R. The *original* 0041 policy is named `"reviews are publicly readable"` (lower
   case) — Postgres policy names are case-sensitive, so the drop silently missed it, leaving the old,
   fully-permissive `using (true)` policy in place *alongside* the new restrictive one. Since Postgres
   OR-combines multiple permissive SELECT policies, the old policy would have completely defeated hidden-
   review moderation for every caller, staff or not — a hidden review would still have been publicly
   readable in production. Fixed by dropping both exact spellings.
2. The new policy's `USING` clause called `public.is_staff()` directly. `is_staff()` is deliberately *not*
   granted to `anon` (`0008_staff_roles_fix_is_staff_grants.sql`), so an anonymous visitor hitting the one
   branch that needs it (a hidden review, where the cheaper `hidden_at is null` clause doesn't short-circuit
   first) got a hard `permission denied for function is_staff` — i.e. the instant any review anywhere was
   ever hidden, anonymous/logged-out browsing of reviews would have broken outright. Fixed the same way
   `listing_is_visible()` (0045) already solves this exact problem for listings: a `SECURITY DEFINER` wrapper,
   `review_is_visible(hidden_at, reviewer_id, reviewee_id)`, granted execute to `anon, authenticated`, so the
   inner `is_staff()` call runs as the function owner instead of the caller.

**`reports.target_type` gains `'review'`**, via the established drop/recreate CHECK constraint pattern —
reused, not forked: a review report gets a moderator queue, assignment, and internal notes for free, the
same economy `'order'` bought in phase 25.

**`seller_rating_summaries` view, not a per-request JS reduction.** `select reviewee_id as user_id,
round(avg(rating)::numeric,1) as average_rating, count(*) as review_count from reviews where hidden_at is
null group by reviewee_id` — plain `SECURITY INVOKER` view (same shape as `auction_bid_history`, 0045,
including the `grant select ... to anon, authenticated`), replacing the two places
(`/marketplace/[id]`, `/dashboard/payouts`) that used to pull every rating row down and reduce in JS.
`summarizeRatings()` (`src/lib/marketplace.ts`) stays as a pure, unit-tested fallback shape — just no longer
the only path.

## Email infrastructure — built from scratch this phase

`src/lib/email.ts`'s `sendEmail()` posts to Resend's plain HTTP API via `fetch()` — no new npm dependency,
gated on `RESEND_API_KEY` (warns once via `console.warn` if unset, returns `{sent:false}`, never throws —
same "external hiccup must never break the feature around it" discipline as `src/lib/stripe/balance.ts`).
`renderEmailHtml()` is a small, unstyled-but-branded template (no logo, no marketing chrome — this app has
no email design-asset pipeline yet), with `escapeHtml()` on every interpolated value since a notification
body can carry another member's own free text (a listing title, a name).

`src/lib/notifications-server.ts`'s `notifyUser()` is the single TS-side dispatch choke point. It **always**
writes the in-app notification (via `admin.rpc("notify_user", ...)`, best-effort). It then conditionally
emails: resolves the category via `categoryForType()`; transactional categories always email; optional
categories check `notification_preferences` (absence of a row defaults to enabled — silence isn't opt-out);
resolves the recipient's email via `admin.auth.admin.getUserById()`; builds an absolute link from
`getSiteUrl()` + the stored route-relative `href`.

**The "never include sensitive personal/payment details in email" requirement gets its own mechanism, not
just discipline.** `notifyUser()` takes an optional `emailBody` override — the in-app notification can carry
richer content (e.g. a message preview) while the *email* gets a generic, content-free version instead.
Currently used by `sendMessage()`'s `new_message` notification: the in-app body includes the first 140
characters of the message, the email says only "you have a new message on Pinpals." Every payment/refund/
dispute notification fired from `src/lib/stripe/payments.ts` and `src/app/admin/orders/[id]/actions.ts`
uses fixed, safe phrasing (amount and listing title only) rather than any raw Stripe reason/evidence/decline
text — Stripe's own message never reaches an email body, even truncated.

`src/lib/notifications.ts` is the pure, framework-free domain model shared by both the dispatch helper and
the in-app list UI (mirrors `src/lib/admin/reports.ts`'s own "no Supabase, no Next.js" discipline) —
`NOTIFICATION_TYPES`/`NOTIFICATION_TYPE_CATEGORY` (a flat, unit-tested map so a stray typo at a call site
fails a test rather than silently producing an uncategorised notification), `categoryForType()`,
`shouldSendEmail()`, `buildDedupeKey()`, `notificationHref()` (a safe, `/`-prefixed-only fallback to
`/dashboard`, defending against an open-redirect-shaped `data.href`).

## Payment/refund/dispute notifications live in TypeScript, not SQL — a deliberate risk boundary

Every payment/refund/dispute-adjacent notification fires from the existing, already-hardened TS choke
points — `processStripeEvent()`'s handler functions in `src/lib/stripe/payments.ts`, and
`requestOrderRefund()` in `src/app/admin/orders/[id]/actions.ts` — never by touching the hardened 0021/0023
payment/refund SQL functions' own bodies. Two problems this had to solve without adding risk to money-moving
code:

- **New dispute vs. an update, with no signal from Stripe's own upsert-based sync**: a pre-upsert
  `select id from disputes where stripe_dispute_id = ...` existence check distinguishes them.
- **A refund that can settle two ways — synchronously in `requestOrderRefund()`, or later via the
  `refund.updated`/`refund.failed` webhook — must never double-notify.** Solved by relying on
  `mark_refund_outcome_by_stripe_id()`'s own pre-existing never-downgrade-a-terminal-row guard: once the
  synchronous path sets a terminal status, the async webhook path's guard makes it return no row, so
  `handleRefundReconciliation()` naturally skips firing a notification for an outcome already notified
  synchronously — no new coordination code needed.

`review_available` fires to *both* buyer and seller from `handlePaymentIntentSucceeded()`, but only on the
specific `pending -> completed` transition (never on a webhook retry of an already-completed order), linking
each to their own dashboard tab.

## A scope decision, stated plainly

**"Shipped/delivery updates" is not built.** `orders.status` is `pending | completed | cancelled | refunded`
— there is no reachable shipped/delivered state anywhere in this schema, confirmed by the same research pass
that scoped the rest of this phase. Building one would mean inventing a new order-lifecycle feature this task
never asked for. Instead, "seller action required" — an event the task *did* ask for, and one this schema
already has a real trigger for — is mapped onto the real `payment_succeeded` transition (the seller now needs
to ship/hand over the item once payment clears). If shipment tracking is added to this app later, its own
notification event slots into the same `notifications`/`notify_user()` machinery this phase built with no
further schema change.

## Member-facing surfaces (new)

- **In-app notification list** — `/notifications`: paginated (`Pagination`, same offset/`count: "exact"`
  shape as every other member-facing list), unread-first visual weight, `markNotificationRead()` fired as a
  fire-and-forget side effect on click (never gates navigation on the mutation), "Mark all as read".
- **Bell + unread count** — `site-header.tsx`/`mobile-nav.tsx`: a bell icon with a badge, fetched the same
  way the header already re-derives `user` on every load (no client-side cache to go stale).
- **Notification settings** — `/dashboard/notifications`: toggles for the four optional categories
  (`NOTIFICATION_CATEGORY_LABELS`/`DESCRIPTIONS`), one upsert per submit covering all four rows so "off"
  and "never visited this page" stay distinguishable, with a fixed note that payments/refunds/disputes are
  never optional.
- **Individual review display** — `ReviewsSection` on `/marketplace/[id]`: reviewer name, star rating, body
  text, date, per the "structured rating plus short text" requirement — the aggregate `★ 4.7 (12 reviews)`
  badge existed before this phase, but no per-review display did anywhere in the app.
- **Report a review** — `ReportReviewButton` + `reportReview()` (`src/app/dashboard/buying/actions.ts`,
  reviews' own natural home, beside `submitReview()`): same "anyone who can see the content can report it"
  shape as `reportListing()`, not the participancy-gated shape `reportUser()`/`reportMessage()` use, since a
  review — like a listing — is public content, not a private conversation.
- **Sellers can now leave reviews too** — `LeaveReviewForm`/`submitReview()` reused as-is on
  `/dashboard/selling`'s sales-history tab. `validate_review()` has always permitted either direction; only a
  buyer-facing UI ever called it before this phase. (`submitReview()` now revalidates both
  `/dashboard/buying` and `/dashboard/selling`, since the same action now backs both tabs.)

## Admin-facing surfaces (new)

- **`/admin/reviews`** — a single filterable queue (visible/hidden/all), no separate detail page (a review
  has no other admin sub-state — no notes, no assignment, no status workflow the way a report does):
  `hideReview()`/`restoreReview()` (`src/app/admin/reviews/actions.ts`) are the exact hidden_at/hidden_by/
  hidden_reason toggle `hideMessage()`/`restoreMessage()` already established, gated to `MODERATION_ROLES`,
  always reason-required, always audited (`review.hide`/`review.restore`). A reports-queue row for
  `target_type = 'review'` links here via `?reviewId=`, since there's no detail page to send that link to
  instead (`resolveTargetSummaries()`'s new `'review'` branch in `src/lib/admin/queries.ts`).
- **"Reviews" nav entry** in `/admin/layout.tsx`, unrestricted by role (same reasoning as Listings — the
  mutation itself is what `MODERATION_ROLES` gates, not the nav link).

## Design decisions worth recording

1. **Dedup is a database constraint, not an app-code discipline** — the partial unique index plus
   `ON CONFLICT DO NOTHING` means a caller literally cannot double-notify for the same `(user, dedupe_key)`
   pair, regardless of retries, races, or a future call site forgetting to check first.
2. **The transactional/optional split is structural** — `notification_preferences.category`'s CHECK
   constraint is the entire enforcement; there is no code path capable of storing a "payments: off" row to
   forget to check.
3. **Two RLS bugs this same migration introduced were caught by its own test suite before ever reaching a
   PR** — the case-sensitive policy-name miss and the ungranted `is_staff()` call. Both are the kind of bug
   that looks correct in isolation and only fails under a live-Postgres RLS test exercising the exact
   anonymous/hidden-review combination — the reason this app's "replay every migration into a live Postgres,
   then run the RLS suite for real" discipline (not just `npm test`) exists at all.
4. **Payment-adjacent notifications stay entirely in TypeScript**, deliberately keeping the hardened 0021/
   0023 SQL functions' bodies untouched — see the dedicated section above.
5. **"Shipped/delivery updates" is explicitly out of scope**, not silently dropped — see the dedicated
   section above.
6. **A notification's in-app body and its email body can diverge on purpose** (`emailBody` override) — the
   mechanism that makes "never include sensitive personal/payment details in email" enforceable per call
   site rather than a matter of every future caller remembering to write email-safe copy.

## Files

**New:**
- `supabase/migrations/0056_marketplace_notifications_reviews.sql`
- `supabase/tests/rls/marketplace-notifications-reviews.test.ts` (16 tests)
- `src/lib/notifications.ts` (+ `.test.ts`, 17 tests) — pure domain model
- `src/lib/email.ts` (+ `.test.ts`, 5 tests) — Resend HTTP client + template
- `src/lib/notifications-server.ts` — `notifyUser()`, the single TS dispatch choke point
- `src/app/notifications/page.tsx`, `notification-row.tsx`, `actions.ts` — in-app list
- `src/app/dashboard/notifications/page.tsx`, `preferences-form.tsx`, `actions.ts` — settings
- `src/app/marketplace/[id]/reviews-section.tsx`, `report-review-button.tsx`
- `src/app/admin/reviews/page.tsx`, `actions.ts`

**Modified:**
- `src/lib/types.ts` — `Review` gains `hidden_at`/`hidden_by`/`hidden_reason`; new `Notification`,
  `NotificationPreference`, `SellerRatingSummary` types
- `src/lib/admin/reports.ts` — `'review'` target type + label, `REVIEW_REPORT_CATEGORIES`
- `src/lib/admin/audit.ts` — `review.hide`/`review.restore`, `review` target type
- `src/lib/admin/queries.ts` — `listReviews()`, `'review'` branch in `resolveTargetSummaries()`
- `src/app/admin/layout.tsx` — "Reviews" nav entry
- `src/app/conversations/actions.ts` — `sendMessage()` fires `new_message`
- `src/lib/stripe/payments.ts` — every webhook handler fires its own payment/refund/dispute/review event
- `src/app/admin/orders/[id]/actions.ts` — `requestOrderRefund()` fires `refund_requested`/`succeeded`/`failed`
- `src/app/dashboard/buying/actions.ts` — `reportReview()`; `submitReview()` revalidates both dashboard tabs
- `src/app/dashboard/selling/sales-history-tab.tsx` — `LeaveReviewForm` reused for sellers
- `src/app/marketplace/[id]/actions.ts` — `runOfferSweeps()` also calls `run_auction_sweeps()`
- `src/app/marketplace/[id]/page.tsx`, `src/app/dashboard/payouts/page.tsx` — read `seller_rating_summaries`
  instead of reducing raw review rows
- `src/components/site-header.tsx`, `src/components/mobile-nav.tsx` — notification bell + unread count
- `supabase/tests/rls/replay-migrations.sh`

## Verification

Typecheck clean throughout (`npx tsc --noEmit -p .`). Lint clean (same 9 pre-existing warnings, nothing
new). Unit tests: 364/364 passing (up from 342 before this phase). RLS suite: 324/324 passing (up from 308)
against a live local Postgres instance, migration replayed for real — this run is what caught and fixed the
two review-visibility RLS bugs documented above, both in this same migration, before either reached a PR.
Build fails only on the pre-existing, unrelated font-network limitation in this sandbox (no outbound access
to `fonts.googleapis.com`) — identical to every prior phase's build output in this environment.

## Deferred / out of scope

- Shipped/delivery updates — see the dedicated scope-decision section above.
- No bulk "resend" or notification digest/batching — every event fires its own single notification/email at
  the moment it happens, matching how every existing offer-lifecycle notification already worked before this
  phase.
- No push notifications or SMS — email and in-app only, matching "using the existing notification/email
  system" as written.
- No UI to browse a review's own moderation history beyond the current hidden/visible state plus its stored
  `hidden_reason` — a full per-review audit trail is already fully covered by `admin_audit_log`'s existing
  `review.hide`/`review.restore` entries; no separate history view was built on top of it.
