# Phase 19 — Marketplace conversations and messages

Wires the marketplace up to the existing member-to-member messaging system
(0025_messaging.sql, extended with a listing link by
0043_conversations_marketplace_context.sql that nothing had actually used
yet) rather than building a second one, per the task's own instruction.
Checkpoint commit: `marketplace-messaging`.

## Schema (`supabase/migrations/0049_marketplace_messaging.sql`)

- **One conversation per buyer/seller/listing context.** 0025's uniqueness
  rule was unconditionally one conversation per unordered user pair — a real
  gap for marketplace use, since the same buyer/seller messaging about two
  different listings would have collided into one thread. Replaced with two
  partial unique indexes: one per pair with no listing (the existing
  connections/tee-time case) and one per (pair, listing) (marketplace
  threads) — the same pair can now have a fresh conversation per listing
  they talk about, plus at most one listing-less conversation for everything
  else.
- **Order link after purchase**: `conversations.order_id` (nullable, `on
  delete set null`), populated best-effort by `linkConversationToOrder()`
  (`src/lib/conversations-server.ts`) from `buyNow()` and `offerAction()`'s
  accept branch — never blocking a purchase if the link write fails, and
  never inventing a conversation that didn't already exist.
- **Read receipts / archiving**: `user_a_last_read_at`/`user_b_last_read_at`
  and `user_a_archived_at`/`user_b_archived_at` — same two-column-per-side
  shape as `user_a_id`/`user_b_id` itself, rather than a `conversation_reads`
  join table that would only ever hold two rows per conversation. A new
  UPDATE policy lets a participant write, but `prevent_conversation_tampering()`
  (mirroring 0045's `prevent_notification_tampering()`) restricts it to only
  their own side's two columns — verified with RLS tests that a participant
  cannot touch the other side's read/archive state, and a non-participant
  can't update the row at all.
- **Blocking** (new — this app had no block concept before): a small
  directional `blocked_users` table, a SECURITY DEFINER `is_blocked()`
  (same reasoning as `can_message()`: called from inside policies with two
  arbitrary ids, only ever returns a boolean), folded into `can_message()`
  itself (blocks new conversations) and into `messages`' own INSERT policy
  (blocks new messages in an *existing* thread once either side blocks the
  other — `can_message()` alone wouldn't catch that).
- **"Never send card, bank or identity-verification data through
  messages"**: `validate_message_content()`, a BEFORE INSERT trigger —
  heuristic and deliberately conservative (a 13-19 digit run, an IBAN-shaped
  token, or a verification word near a number, all documented as
  intentionally over-triggering rather than under-triggering). Mirrored in
  JS (`containsSensitiveData()`, `src/lib/messaging.ts`) for instant
  client-side feedback before the round-trip.
- **Unread counts, one query for the whole inbox**: `conversation_unread_counts()`,
  SECURITY INVOKER (not definer — it only ever aggregates over rows the
  caller's own RLS already lets them read), one correlated subquery per
  conversation planned as a single statement against the existing
  `messages_conversation_created_idx`.
- **Report-message** needed no schema change — `reports.target_type` has
  included `'message'` since 0016_admin_reports.sql, anticipating this.

`supabase/realtime/0001_messaging_broadcast_authorization.sql` is a
**separate, non-numbered file** — RLS policies on `realtime.messages`
(Realtime Authorization for the two broadcast topics below) can't be
replayed against the local/CI Postgres container used by
`supabase/tests/rls/replay-migrations.sh`, which has no `realtime` schema at
all (that's Supabase-managed on the hosted project, not something a plain
`postgres:16` container provisions). This file documents and must be applied
directly against the live project (SQL editor or `supabase db execute`) —
its own header explains why it isn't in the numbered sequence.

## Realtime (display-only, Postgres stays authoritative)

`src/lib/realtime.ts` (server) broadcasts over Supabase's HTTP Broadcast
endpoint (not a websocket — this fires from Server Actions, which have no
business holding a persistent Realtime connection open) to exactly **two**
topic shapes, never one per row:

- `conversation-<id>` — every new message in that one thread, subscribed to
  only while that thread is open.
- `inbox-<userId>` — one subscription for a member's *entire* inbox
  regardless of how many conversations they have; a lightweight ping
  ("something changed"), not data to render directly — the inbox list
  reacts by calling `router.refresh()`, re-running the same server query
  rather than maintaining a second parallel client-side copy of the list.

`src/lib/realtime-client.ts`'s `useBroadcastChannel()` hook is the one place
either page subscribes — `ThreadView` uses it once (thread), `InboxClient`
uses it once (inbox). Both channels are `private: true`, authorized via the
`realtime.messages` RLS policies above; sending only ever goes through the
service-role key, so a client can receive but never spoof a broadcast.

## App layer

- `src/app/conversations/actions.ts`: `startConversation()` now takes an
  optional `listingId`; `sendMessage()` adds the blocked-user and
  sensitive-content pre-checks (friendly errors ahead of the DB's own
  enforcement) and broadcasts after a successful insert; new
  `markConversationRead()`, `archiveConversation()`/`unarchiveConversation()`,
  `blockUser()`/`unblockUser()`, `reportMessage()`. Rate limits added on
  every write surface that's actually abuse-prone (send, report, start,
  block) — read/archive toggles are left unlimited, routine UI state RLS
  already scopes to the caller's own conversations.
- `src/app/conversations/page.tsx` + `inbox-client.tsx`: Buying/Selling/
  Archived/All tabs (`matchesInboxFilter()`/`conversationRole()`,
  `src/lib/messaging.ts`), unread badges, per-row archive toggle, one inbox
  realtime subscription.
- `src/app/conversations/[id]/page.tsx` + `thread-view.tsx` +
  `listing-context-card.tsx` + `block-control.tsx`: listing snapshot + order
  status + a link to whichever is more relevant right now (the listing, or
  the order once one exists); mark-as-read on view; one thread realtime
  subscription; optimistic sending with retry (`ThreadView` owns pending
  sends as local state — a failed send surfaces Retry/Discard, a successful
  one is dropped from local state once the server's own revalidated data
  reflects it, so there's exactly one source of truth for a confirmed
  message); block/unblock; per-message Report alongside the existing
  report-conversation.
- `src/app/marketplace/[id]/message-seller-button.tsx` /`seller-card.tsx`/
  `page.tsx`: now pass `listingId` through, so a marketplace "Message
  seller" click actually produces a listing-scoped conversation instead of
  silently falling back to the old listing-less behaviour.

## Testing

- `supabase/tests/rls/messaging.test.ts`: 20 new tests (33 total in this
  file) — listing-scoped uniqueness (same pair, different listing succeeds;
  same pair/listing collides; at most one listing-less conversation),
  blocking (insert/read/impersonation guards, an unrelated logged-in user
  — `buyer2`/`seller1` — cannot see someone else's block list even as the
  block's own target, `is_blocked()` both directions, blocking closes both
  new-conversation and existing-thread paths), the read/archive tampering
  guard (own side only, identity/listing/order columns untouchable by
  anyone, a non-participant gets zero rows not an error, the system touch
  trigger still works), the sensitive-content guard (card/IBAN/verification,
  each isolated from the others' regex so a false rejection reason doesn't
  mask a real one), and `conversation_unread_counts()` (correct count,
  scoped to the caller's own conversations only). `npm run test:rls:replay
  && npm run test:rls`: 222 passing (up from 202).
- `src/lib/messaging.test.ts`: 16 new tests for the new pure helpers
  (`myLastReadAt`/`isConversationUnread`/`isConversationArchived`/
  `conversationRole`/`matchesInboxFilter`/`containsSensitiveData`).
  `npm run test`: 290 passing.
- `npm run typecheck` / `npm run lint`: clean (lint: only pre-existing
  `_prev`/`_formData` placeholder warnings elsewhere in the codebase).
- `npm run build`: fails only on the same pre-existing sandbox limitation
  every prior phase has hit (no egress to Google Fonts from this
  environment) — confirmed unrelated to this phase's changes.

## Deliberately out of scope / accepted gaps

- Realtime Authorization (`supabase/realtime/0001_...sql`) needs a manual
  apply against the live project — flagged above, not yet verified against
  the actual hosted Supabase Realtime infrastructure from this sandbox.
- No group conversations — everything stays strictly two-party, consistent
  with 0025's own original design choice.
- No message editing/deletion (unchanged from 0025 — moderation only ever
  sets `hidden_at`/`hidden_by`/`hidden_reason`, never rewrites `body`).
- The sensitive-content guard is a heuristic and documented as such — it can
  over-trigger on an unrelated long, unbroken number (e.g. a tracking
  number); a rejected sender can rephrase.
