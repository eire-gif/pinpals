# Phase 25 — marketplace-trust-safety: report/moderate/mute/dispute workflows

Checkpoint commit: `marketplace-trust-safety`, branched from `main` at `0b67234` (marketplace-admin merged).

## What this phase does

Implements marketplace trust & safety end-to-end: report listing/user/message/order with structured
reason and evidence references; moderator assignment/status/notes/resolution; user block/mute integrated
with messaging and offers; order issue reporting, refund requests and dispute tracking; safe suspension/
removal that preserves evidence and order history; fraud/risk flags as internal-only signals; retention/
redaction hooks; and an audit event for every admin decision — with Stripe disputes/refunds still
reconciled only through webhooks, no custom money-movement system, and defined escalation paths/permission
boundaries for support, moderation and finance staff.

A research pass (survey of 9 requirements + 3 follow-ups against the existing `/admin` surface, the
`reports`/`blocked_users`/`disputes`/`refunds`/`admin_audit_log` schema, and prior phase summaries) found
that **most of this task already existed**: the reports queue with moderator assignment/claim/status/
resolution (`0016_admin_reports.sql`, `src/lib/admin/queries.ts`), blocking wired into messaging
(`0049_marketplace_messaging.sql`), refund/dispute machinery reconciled via Stripe webhooks
(`0021`–`0023`, `phase-10`/`phase-11` summaries), soft-state suspension/removal that never deletes order
history, and the admin audit log itself. This phase adds only the genuine gaps:

1. `'order'` as a valid report target (plus `wants_refund` and order-shaped categories)
2. block enforcement extended into offers (messaging already had it)
3. member-to-member muting (new, deliberately separate from blocking)
4. fraud/risk flags (new, internal-signal-only)
5. escalation paths between support/moderation/finance/admin (new)
6. a narrow redaction hook on reports (new)
7. the member-facing UI for all of the above — report-a-user, mute, order-issue-report/refund-request,
   dispute-status display — none of which had ever been built, even though several of the underlying
   target types (`'user'`, `'message'`) had been valid on `reports` since `0016`.

## The one migration: `0055_marketplace_trust_safety.sql`

**Reports extended, not forked.** `'order'` joins `reports.target_type`; `item_not_as_described`/
`item_not_received`/`payment_issue` join `reports.category`; `wants_refund boolean` records a refund ask
without moving any money itself. The load-bearing design economy: `'order'` was already accepted by
`AUDIT_TARGET_TYPES` and every refund audit entry (`refund.requested`/`completed`/`failed`) already writes
`targetType: "order", targetId: orderId` (`src/app/admin/orders/[id]/actions.ts`). Making `'order'` valid
on `reports.target_type` means `getReportDetail()`'s existing `isAuditableTarget`/audit-log lookup and
`resolveReport()`'s existing `linked_action_id` picker **automatically** surface and let a moderator link a
refund action to an order report — zero additional code, and no parallel refund-request system, honoring
"do not create a custom money movement system" directly.

**Muting is a new table, deliberately asymmetric.** `muted_users(muter_id, muted_id)` — RLS scopes every
row to `auth.uid() = muter_id`, so only the muter can ever see it; nothing folds it into `can_message()` or
any messaging/offers check, unlike blocking. A mute is a private "don't surface to me" signal, never a veto
on the other person.

**Block enforcement extended into offers, mirroring messaging's existing belt-and-suspenders shape.** Both
the `"buyers can create offers"` RLS insert policy and `prepare_and_validate_offer()`'s trigger now call
`is_blocked()`. `offer_action()` blocks `'accept'`/`'counter'` (advancing a trade) but still allows
`'decline'`/`'withdraw'` (closing one out) — the same "closing out is always allowed, only advancing is
vetoed" rule messaging already follows.

**Fraud/risk flags are a pure signal table.** `fraud_flags` — staff-only read (`is_staff()`), no insert/
update/delete policy for anon/authenticated at all (service-role only, after `requireStaff()`), always
carries a `note`, always audited (`fraud_flag.raised`/`fraud_flag.cleared`). Nothing anywhere in this
schema or the app code that pairs with it reads a fraud flag to automatically suspend, remove, or restrict
anything — it exists for a human to see and decide, never a verdict machine.

**Escalation is three columns on `reports`, not a new table.** `escalated_to_role` (constrained to
`moderator`/`finance`/`admin`/`super_admin` — deliberately excluding `support`, since escalating to the
entry tier isn't an escalation), `escalated_at`, `escalated_by` — the same both-or-neither convention
`assigned_admin`/`claimed_at` already uses on this exact table, because an escalation is a property of an
existing report, not a new kind of record.

**Redaction is a narrow hook, not a retention-policy engine.** `redacted_at`/`redacted_by` on `reports`;
`redactReport()` (super_admin only, reason required) clears only `description`/`evidence_refs`, preserving
category/status/resolution/audit trail. Explicitly distinct from `audit.ts`'s `sanitizeMetadata()` (audit-
log hygiene, not user-data retention) — this phase's spec asked for "hooks", not a system, and this is
scoped to match.

**Member-facing dispute visibility via a narrow RPC.** `disputes` has zero RLS read access for anon/
authenticated (a one-directional, webhook-only table by design). `get_order_dispute_status(p_order_id)` is
a `SECURITY DEFINER` function, revoked from `anon`, that returns just one order's dispute status string
(or null) after an internal ownership check against `orders.buyer_id`/`seller_id = auth.uid()` — nothing
else about the dispute is exposed.

## Permission boundaries and escalation paths

- **Support**: full read access to the reports queue; can escalate any open/claimed report to moderator,
  finance, admin, or super_admin (`escalateReport()` — gated only by a bare `requireStaff()`, since
  escalating *is* support's job); cannot claim, resolve, dismiss, or redact.
- **Moderation** (`MODERATION_ROLES`): claim, change status, add internal notes, resolve/dismiss reports —
  unchanged from prior phases; now also gains the "Reports on this order" section and risk-flag panels on
  order/listing/user detail pages, and can raise/clear fraud flags.
- **Finance** (`FINANCE_ROLES`): unchanged order/refund/payout access; now also sees reports filed against
  orders they administer, and can clear an escalated fraud flag (`CLEAR_FRAUD_FLAG_ROLES = ESCALATION_ROLES`).
- **Admin/super_admin**: everything above, plus super_admin-only `redactReport()`.

## Member-facing surfaces (new)

- **Report a member**: `ReportForm`'s `ReportTarget` union gained `{ type: "user"; id: string }`; a new
  `reportUser()` action requires an existing shared conversation as its participancy check (never a bare
  profile id); wired into the conversation thread page alongside the existing "Report this conversation".
- **Evidence references**: `parseEvidenceRefs()` (pure, unit-tested — trims, drops blanks, caps 10 items ×
  300 chars) now backs an "evidence" textarea on all four member report forms (conversation, message, user,
  listing) and the new order-issue form.
- **Mute/unmute**: `MuteControl` (sibling of `BlockControl`) plus `muteUser()`/`unmuteUser()` actions, wired
  into the conversation thread header.
- **Order issue reporting + refund request**: `ReportIssueForm` on `/dashboard/orders/[id]` — category
  restricted to `ORDER_REPORT_CATEGORIES`, a "wants a refund" checkbox that sets `reports.wants_refund`, and
  the same evidence field — backed by `reportOrderIssue()`.
- **Dispute status**: `/dashboard/orders/[id]` now shows a status badge (reusing the existing
  `DISPUTE_STATUS_LABELS`/`STYLES`) when `get_order_dispute_status()` returns a non-null status, via
  `getOrderDisputeStatus()`.
- **Friendly block-rejection copy**: `"blocked"` added to `KNOWN_OFFER_CREATE_REJECTION_SNIPPETS`/
  `KNOWN_OFFER_RESPONSE_REJECTION_SNIPPETS` in `src/app/marketplace/[id]/actions.ts` so the new DB-side
  `is_blocked()` rejections surface their own message text rather than a generic fallback.

## Admin-facing surfaces (new)

- `/admin/reports` — new "Any escalation" filter (`ESCALATION_ROLES`); `/admin/reports/[id]` — new
  Escalation section (`EscalateForm`/`clearEscalation`), a redaction control (super_admin only), a
  redaction notice on the description, `wants_refund`/`escalated_to_role` badges, and a `RiskFlagsPanel`
  when the report targets a user/listing/order.
- `/admin/risk-flags` — new queue page (`listFraudFlags()`, filterable by status/target/severity).
- `RiskFlagsPanel` embedded on `/admin/users/[id]`, `/admin/listings/[id]`, and (new) a "Reports on this
  order" section plus the panel on `/admin/orders/[id]` — the first time that page has ever shown reports,
  since `'order'` just became a valid report target.

## Design decisions worth recording

1. **Reuse over rebuild, enforced structurally** (again, following phase-24's own discipline): the
   `'order'`-as-report-target economy above is the clearest instance — one constraint change makes four
   pieces of existing machinery (audit lookup, linked-action picker, `RiskFlagsPanel`, the reports queue
   itself) apply to orders with no new code in any of them.
2. **Escalation deliberately excludes `support`** as a destination — escalating *to* the entry tier isn't
   an escalation, so `ESCALATION_ROLES` starts at `moderator`.
3. **Muting and blocking stay structurally separate** — same table shape (`muter_id`/`muted_id` mirrors
   `blocker_id`/`blocked_id`) but opposite integration depth, by design: blocking is a veto on the other
   person, muting is a private signal about my own inbox.
4. **Fraud flags are read-only to any automated path** — enforced by construction (no RLS grant, no code
   path reads `fraud_flags` except for display), not by convention alone; `risk.ts`'s own header comment
   states this as the file's central invariant.
5. **`reportUser()` requires a shared conversation** rather than accepting any profile id, mirroring the
   participancy checks every other report action in this app already performs — never trust an id from the
   client alone.

## Files

**New:**
- `supabase/migrations/0055_marketplace_trust_safety.sql`
- `supabase/tests/rls/marketplace-trust-safety.test.ts` (17 tests)
- `src/lib/admin/risk.ts` (+ `.test.ts`, 5 tests) — fraud-flag vocabulary
- `src/app/admin/risk-flags/page.tsx`, `src/app/admin/risk-flags/actions.ts`
- `src/components/admin/risk-flags-panel.tsx`, `src/components/admin/raise-fraud-flag-form.tsx`
- `src/app/admin/reports/[id]/escalate-form.tsx`
- `src/app/conversations/[id]/mute-control.tsx`
- `src/app/dashboard/orders/[id]/report-issue-form.tsx`

**Modified:**
- `src/lib/admin/reports.ts` (+ `.test.ts`) — `ESCALATION_ROLES`, new categories/target type,
  `LISTING_REPORT_CATEGORIES`/`USER_REPORT_CATEGORIES`/`ORDER_REPORT_CATEGORIES`, `parseEvidenceRefs()`
- `src/lib/admin/audit.ts` — `report.escalated`/`report.redacted`/`fraud_flag.raised`/`fraud_flag.cleared`,
  `fraud_flag` target type
- `src/lib/admin/queries.ts` — order report-target resolution, escalation filter, fraud-flag queries
  (`listFraudFlags`, `listFraudFlagsForTarget`), `escalatedByStaff`/`redactedByStaff` resolution
- `src/app/admin/reports/[id]/actions.ts` — `escalateReport()`, `clearEscalation()`, `redactReport()`
- `src/app/admin/reports/[id]/page.tsx`, `src/app/admin/reports/page.tsx`
- `src/app/admin/orders/[id]/page.tsx`, `src/app/admin/listings/[id]/page.tsx`,
  `src/app/admin/users/[id]/page.tsx` — `RiskFlagsPanel` wired in
- `src/app/admin/layout.tsx` — "Risk flags" nav entry
- `src/app/conversations/actions.ts` — `reportUser()`, `muteUser()`/`unmuteUser()`, evidence_refs on
  `reportConversation()`/`reportMessage()`
- `src/app/conversations/[id]/report-form.tsx`, `src/app/conversations/[id]/page.tsx`
- `src/app/marketplace/[id]/actions.ts`, `src/app/marketplace/[id]/report-listing-form.tsx` — evidence_refs,
  `"blocked"` rejection snippets
- `src/app/dashboard/orders/[id]/actions.ts`, `src/app/dashboard/orders/[id]/page.tsx` —
  `reportOrderIssue()`, `getOrderDisputeStatus()`
- `supabase/tests/rls/replay-migrations.sh`, `fixtures.ts`, `admin-only-tables.test.ts`

## Verification

Typecheck clean throughout. Lint clean (same 9 pre-existing warnings, nothing new). Unit tests: 342/342
passing (up from ~318 before this phase — new coverage in `reports.test.ts`, `risk.test.ts`). RLS suite:
308/308 passing (up from 285 — new `marketplace-trust-safety.test.ts`, extended fixtures, `fraud_flags`
added to the staff-only-tables sweep) against a live local Postgres instance, migration replayed for real.
Build fails only on the pre-existing, unrelated font-network limitation in this sandbox (no outbound access
to fonts.googleapis.com) — confirmed unrelated by inspecting the error, which is identical to prior phases'
build runs.

## Deferred / out of scope

- No UI to browse/filter `muted_users` as a list (mute/unmute is per-conversation only, matching how block
  is exposed today).
- No automated fraud-flag → suspension pipeline — by design; see design decision 4.
- No bulk redaction or scheduled retention sweep — this phase's redaction hook is one report at a time, by
  a super_admin, with a reason; a broader retention policy engine is a distinct follow-up if the business
  need for one surfaces.
