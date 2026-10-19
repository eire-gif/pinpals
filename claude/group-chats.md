# Group chats for Golf Buddies and trips (19 Oct 2026, migration 0181)

Every Golf Buddies group (kind `crew`) and golf trip has its own chat from
the moment it's created. It's the same conversation system as Messages
(0087/0130): one thread, reachable from the group's page and from the Inbox.
Decisions (Eire, 19 Oct): new members see the whole chat from the start;
"Rounds & @me" is the default alert setting for big trips.

## What members see

- **Group page** (`app/group/[id]/index.tsx`): the name in a green bar with
  a gold line under it ("Golf Buddies · 8 members", "Golf trip · 199 days to
  go"). The navy chat card is first on the page for members: last two
  messages, unread count, and a reply box that sends without leaving the
  page (`components/group-chat-card.tsx`). The old Chat button and "starts
  once three of you are in" hint are gone. Just created: "Your group/trip
  chat is ready". Invited or able to join: "Joining gives you" — the chat
  from the start, and events / the itinerary. Not shown to under 18s.
- **Inbox** (`app/(tabs)/inbox.tsx`): a **Groups** filter chip. Group rows
  show a navy plane (trip) or green people (Golf Buddies) badge, a TRIP /
  BUDDIES tag, a muted icon, and a context line — the trip's countdown or
  "Next: Sat 24 Oct · 08:40 · Portmarnock".
- **The chat** (`app/conversation/[id].tsx`): title and gold caps line tap
  through to the group's page; ••• opens Chat settings. The next open event
  is pinned under the bar with I'm in. The group's events appear among the
  messages as cards (posted by, when, who's in, fee, I'm in / Open). They're
  read live from `society_outings`, not stored as messages, so counts and
  cancellations are always current. **+** opens a sheet: Photo, Rounds &
  events, Next round / Itinerary; organisers (owner/admin) also get Post a
  round / Plan a trip day and Ask for money (opens the event's payment
  details). No tab bar on the chat itself (conversations are in the tab
  bar's FULL_SCREEN list, as before).
- **Chat settings** (`app/chat-settings/[id].tsx`, any group chat):
  Everything / Rounds & @me / Muted, who's in it, photos and events shared,
  and Leave — which for a group's chat leaves the group (owner must hand
  over first).

## Database — `0181_group_chat_everywhere.sql`

- `group_sync_chat()` opens the chat at 1 member (was 3), still ≤ 20 and
  never for societies. Under-18s are **left out** of the chat rather than
  refused — 0159's age guard raised on their conversation_members insert,
  which would have failed a junior's join to any crew with a chat.
- `conversation_members.alerts` ('all' | 'key' | 'none'). Members update
  their own row directly — 0087's tampering trigger only freezes
  conversation_id, member_id, role and joined_at.
- Trips with 8+ golfers start new chat members on 'key'. The organiser and
  early joiners keep 'all'.
- Backfill: every crew/trip with chat on and no conversation gets one.
- Message history was never limited by join time, so "see everything" needed
  no change.

Tests: `supabase/tests/rls/group-chat-everywhere.test.ts` (8), and
`groups.test.ts` updated. RLS suite 1053 passing.

## Website

`sendMessageTo()` (`src/lib/messaging-server.ts`) reads each member's
`alerts` and only pushes/emails: 'all' always; 'key' when the message
@mentions their first name or replies to them; 'none' never. Realtime inbox
updates still go to everyone. If the column isn't there yet it falls back to
alerting everyone, so the site can deploy before the migration. Rule and
tests: `chatAlertWanted()` / `mentionsFirstName()` in `src/lib/messaging.ts`.

## App files

`lib/group-chat-rules.ts` (+test: countdown, words, timeline merge),
`lib/group-chat.ts` (reads), `components/group-chat-card.tsx`,
`components/group-chat-bits.tsx` (NextUpStrip, EventCard, ChatAddSheet),
`app/chat-settings/[id].tsx`, `lib/inbox.ts` (Groups filter). Guides
updated: Invite your golfers, Find your way around, Chat with your PinPals.

## Known limits

- Polls and scorecards aren't in the + sheet yet (no poll screens exist).
- The chat card refreshes when the page comes back into view, not live: the
  open chat holds the conversation's realtime channel.
- Mentions are plain "@Firstname" text — no autocomplete list yet.
- Not yet seen on a phone.
