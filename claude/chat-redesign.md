# Chat redesign — reactions, replies, delete, ticks, typing (Oct 2026)

Messages and alerts got the same polish as the rest of the app, with the
WhatsApp features members expect. Same functionality and options as before
(search, filters, swipe to hide/delete, photos, Mark all read, leave group,
listing context, shared posts, emoji tray).

## What members see

**Inbox** — navy header running into a navy summary: two tiles, *Chats* and
*Alerts*, each with its unread count (tap = filter, tap again = All), and
search on the navy. Under *All*, the five most recent chats come first with
"See all chats (N)", then alerts by day. My own last message shows ✓ (sent)
or green ✓✓ (everyone has read it) instead of "You:". Deleted messages
preview as *This message was deleted*.

**Chat** — navy header with avatar (or gold group badge), name, and a subtitle
that becomes "Seán is typing…". Day dividers as pills (Today / Yesterday /
weekday / date, by the phone's calendar). Bubbles grouped by sender run with
tighter corners inside a run, avatar on the last of a run in groups, sender
names in a stable colour per member. Time and ✓ / ✓✓ (gold on green) inside
each bubble. Composer is a rounded pill (emoji · text · camera) with a round
send button; a reply bar sits above it while replying.

**Long-press a message** → reaction bar (👍 ❤️ 😂 ⛳ 🔥 👏 and + for the full
emoji tray), the message, then: Reply · Reply privately (groups, others'
messages) · Copy (opens the share sheet — Copy is its first option; a real
clipboard needs a native module, so that waits for a store build) · Info (my
messages: Read by / Not read yet, with times) · Report (others' messages;
reasons as an alert) · Delete (for everyone — mine, within 48 hours — or for
me). **Swipe a message right** to reply. Tap a quote to jump to the original
(if it's loaded). Tap a reaction chip to add/remove that reaction.

## Database — `0130_chat_reactions_replies.sql`

- `messages.reply_to_id`, `reply_snapshot` (jsonb), `deleted_at`.
  `message_reply_snapshot()` BEFORE INSERT writes the quote from the real
  message (`{sender_id, body ≤280, photo, group}`) and nulls anything the
  client sent for `reply_snapshot` / `deleted_at`. Cross-conversation quotes
  only for "Reply privately": source must be a group the sender is in, by
  someone else, into a direct thread between the two of them. One error text
  for every refusal (no probing which ids exist).
- `message_scrub_quotes()` — a moderator hiding a message turns quotes of it
  into `{removed: true}` (not undone by Restore).
- `message_reactions` (one per member per message; select = conversation
  members; writes only via `react_to_message(id, emoji)` — same emoji again
  or null removes; refuses non-members, blocked threads, hidden/deleted
  messages, and text that isn't emoji: ASCII, Latin/Greek/Cyrillic/… and CJK
  ranges are rejected, ZWJ sequences pass).
- `message_hides` + `hide_message_for_me(id)` — delete for me.
- `delete_message_for_everyone(id)` — sender only, 48 h; body becomes
  "This message was deleted" (which is also what old app versions and the
  website show), image_path cleared, reactions removed, quotes of it become
  `{deleted: true}`; original archived in `message_deletions` (service role
  only). Called through `POST /api/app/messages/[id]/delete`, which moves the
  photo to `deleted/<path>` (members' storage policy can't read it) and
  deletes the `new_message` notifications that quoted the words.
- `start_private_reply(message_id)` — finds or opens the direct thread for
  Reply privately. **can_message() is deliberately NOT widened**: it also
  gates adding people to groups, so "shares a group" would chain through
  group invitations to strangers (caught in review).
- `mark_conversation_read(id)` — read cursor on the server clock (✓✓ compares
  against server `created_at`; a slow phone clock used to stall it). App
  falls back to the old direct update if the function is missing.
- Realtime: `react_to_message`, `delete_message_for_everyone` ping
  `conversation-<id>` with `message_changed {message_id, what}`; a read
  cursor moving pings `read {member_id, last_read_at}`. Typing travels on
  `typing-<id>` — the only topic members may publish on (insert + select
  policies for conversation members). The payload's member_id is
  client-supplied, so a member could fake another member's typing dot in the
  same thread; nothing else.

Tests: `supabase/tests/rls/chat-reactions-replies.test.ts` (18), grants
register updated. RLS suite 762.

## Code

- Website: `sendMessageTo()` takes `replyToId`; `/api/app/messages` and
  `/api/app/messages/photo` accept `reply_to_id`; new
  `/api/app/messages/report`; website thread shows quotes and deleted
  messages; moderators see the original of a deleted message
  (`getConversationAccessWindow`) with a "Deleted by sender" tag.
- App: `lib/chat-look.ts` (+test — colours, ticks, read-by, chips, quotes,
  typing line), `lib/messages.ts` (reactions, hides, deletes, report,
  startPrivateReply, markRead RPC), `lib/realtime.ts`
  (`subscribeToConversation` handlers, `subscribeToTyping`),
  `components/chat-bits.tsx` (action sheet, info sheet, QuoteBlock),
  `app/conversation/[id].tsx`, `app/(tabs)/inbox.tsx`, inbox header in
  `(tabs)/_layout.tsx`.

## Known gaps

- Inbox preview still shows a message you deleted for yourself; the website
  ignores delete-for-me.
- Jump-to-quote only works for messages already loaded.
- No one-tap clipboard Copy until a store build adds expo-clipboard.
- Read receipts can't be turned off.
