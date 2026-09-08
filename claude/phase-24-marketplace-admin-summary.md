# Phase 24 — marketplace-admin: consolidated `/admin/marketplace` console

Checkpoint commit: `marketplace-admin`, branched from `main` at `2a9415c` (marketplace-workspaces merged).

## What this phase does

Adds `/admin/marketplace`, a tabbed console (`overview`, `listings`, `sellers`, `orders`, `payments`,
`offers`, `disputes`, `messages`, `audit`) reusing the existing admin role/audit system throughout.
Before writing any code, a research pass mapped the entire existing `/admin` surface (`src/app/admin/**`,
2,500+ lines of `src/lib/admin/queries.ts`) to find out what was already built across prior phases, so this
phase adds only what's missing rather than re-implementing anything.

**Result: almost everything the task asked for already existed** — listings moderation, orders + refunds +
timeline, seller Connect onboarding readiness, the payout ledger, reports (including a fully-built
reason-gated, audited reveal flow for reported messages/conversations), support cases, staff management, and
the audit log itself. `/admin/marketplace`'s job for all of those is to surface a curated "needs attention"
slice and link straight into the existing dedicated page — never a second implementation of the same query
or the same mutation.

Two genuine gaps existed and are what this phase actually builds new:

1. **Offers & auctions had no admin view anywhere** — not even nested inside another page beyond a
   listing's own offer list. New read-only history (`listOffers()`, `listAuctions()` in `queries.ts`).
2. **Disputes had no admin-wide queue** — only per-order visibility, explicitly deferred in
   `claude/phase-11-refunds-disputes-summary.md`. New read-only queue (`listDisputes()`), still just a
   Stripe dashboard link for actually working one — never a second dispute-response UI.

## The one new mutation: force-closing a stuck auction

Investigating the auctions/bids schema (`0039_auctions_and_bids.sql`) surfaced a real gap: an auction only
ever closes *lazily*, the moment someone tries to bid on or buy-now a listing whose auction has already
ended (`apply_new_bid()`, and the Buy-Now path in `0050_marketplace_checkout.sql`). There is no scheduled
sweep that closes an auction the instant its clock runs out — so a real auction can sit indefinitely in
`live`/`scheduled` status after its own end time, with its winning bidder unable to check out.

`forceCloseAuction()` (`src/app/admin/marketplace/actions.ts`) is the fix — the one mutation this checkpoint
adds, and every task requirement maps onto it directly:

- **Role gate**: `FINANCE_ROLES` (a transaction-blocking state, not a content-moderation one).
- **Never trusts client state**: re-fetches the auction by id, re-validates
  `auctionEligibleForForceClose()` (a pure, unit-tested predicate in `src/lib/admin/marketplace.ts`) server-side.
- **Reason required**, same 4000-char bound as `requestOrderRefund()`.
- **Confirmation**: reuses `ModerationForm` (required-reason-textarea-plus-submit) — the same pattern every
  other status-changing admin action in this app already uses as its confirmation step. No admin action
  anywhere in this codebase uses a JS `confirm()` dialog, so this doesn't introduce a second pattern.
- **Safe retry**: the guarded `UPDATE ... WHERE status IN (...) AND ends_at <= now()` makes a second
  submit of the same click return a friendly "already closed" success, not an error.
- **Audit event**: `auction.force_closed` (new `ADMIN_ACTIONS` entry) / `auction` (new
  `AUDIT_TARGET_TYPES` entry) — both pure TypeScript const-array additions, no DB migration needed.

## No new migration

Every read in this phase goes through the existing service-role admin client, which already bypasses RLS
by design (see `queries.ts`'s own file-header comment) — no new table, no new RLS policy. The one mutation
(`forceCloseAuction`) is a guarded `UPDATE` through that same service-role client. `ADMIN_ACTIONS` /
`AUDIT_TARGET_TYPES` have no DB-level check constraint (confirmed via `audit.ts`'s own comment), so adding
`auction.force_closed` / `auction` is a TypeScript-only change. This keeps the whole checkpoint's diff to 4
modified files + 14 new files — no migration to replay, nothing for the RLS suite to newly cover.

## Design decisions worth recording

1. **Reuse over rebuild, enforced structurally**: every tab that shows data another admin page already
   fully owns (listings, sellers, orders, payments/refunds context) calls that *exact same* query function
   from `queries.ts` with a curated filter, never a parallel implementation. `listOrders({status:"pending",
   paymentStatus:"failed"})` is the same function `/admin/orders` itself calls.
2. **Reported messages stay behind their existing access model, on purpose**: the messages tab shows report
   *rows* only (reporter, category, timestamp) and links into `/admin/reports/[id]`'s existing
   `ConversationAccessPanel` — the reason-gated, audited, bounded reveal flow built in an earlier phase. This
   tab adds zero new ways to see message content; building a second content-viewing surface would have
   undermined the whole point of that access model.
3. **Offers stay read-only, deliberately**: `offer_action()` already owns that state machine end-to-end
   server-side (single-round negotiation, enforced transitions) — no gap was found there, so no admin
   override exists for offers, only for the one place (auctions) where a genuine gap was confirmed.
4. **Pure, testable predicates for anything with a "should this be flagged" decision**:
   `auctionEligibleForForceClose()` and `buildMarketplaceAlerts()` are both pure, DB-free, and unit-tested
   (`marketplace.test.ts`) — the same split every other admin lib file in this app already follows
   (`roles.ts`/`moderation.ts`/`overview.ts`).
5. **No raw financial/identity data surfaced**: the sellers tab shows only status flags and a *count* of
   past-due requirement codes, never their values; the payments/disputes tabs show amount/status/dates and
   link to Stripe for anything beyond that — matching every existing admin financial page's own discipline.
6. **Test coverage follows this codebase's own established pattern**: `requireStaff()`/`canAccess()` are
   tested once, generically, in `authorization.test.ts`/`roles.test.ts` — no admin page or action anywhere
   in this app has its own per-page access test (confirmed by inspection before writing anything). This
   phase's new pages and the one new action follow the same discipline: every tab and the new action calls
   `requireStaff({ roles })` directly (not just relying on the layout), and the new pure logic
   (`auctionEligibleForForceClose`, `buildMarketplaceAlerts`) gets its own unit tests.

## Files

**New:**
- `src/app/admin/marketplace/page.tsx` — tab dispatcher (`?tab=`), `src/app/admin/marketplace/actions.ts` — `forceCloseAuction()`
- `overview-tab.tsx`, `listings-tab.tsx`, `sellers-tab.tsx`, `orders-tab.tsx`, `payments-tab.tsx`, `offers-tab.tsx`, `disputes-tab.tsx`, `messages-tab.tsx`, `audit-tab.tsx`
- `src/lib/admin/marketplace.ts` (+ `.test.ts`) — `auctionEligibleForForceClose()`, `buildMarketplaceAlerts()`
- `src/components/admin/pagination.tsx` — shared pagination, same shape as `src/components/dashboard/pagination.tsx`

**Modified:**
- `src/lib/admin/queries.ts` — `getMarketplaceOverviewMetrics()`, `listRefunds()`, `listDisputes()`, `listOffers()`, `listAuctions()`
- `src/lib/admin/audit.ts` — `auction.force_closed` / `auction` added to the existing const arrays
- `src/lib/admin/format.ts` — `AUCTION_STATUS_LABELS`/`STYLES`
- `src/app/admin/layout.tsx` — one new nav entry

## Verification

Typecheck clean, lint clean (same 9 pre-existing warnings, nothing new), 327/327 unit tests (up from 318 —
9 new in `marketplace.test.ts`), 285/285 RLS tests unchanged (no migration in this phase), build fails only
on the known pre-existing font-network limitation (confirmed unrelated — same failure predates this phase).

## Deferred / out of scope

- No admin override for offers (see design decision 3) — flag if a real need for one surfaces.
- No "reopen" action for a force-closed auction — closing is one-directional in this phase; a wrongly-closed
  auction needs a support/engineering follow-up, not a self-service undo, given it can affect a real
  in-flight sale.
- The messages tab's "open" filter mirrors the listings tab's own simplification (unclaimed only) — claimed
  message reports are still fully visible via `/admin/reports?targetType=message`, just not duplicated here.
