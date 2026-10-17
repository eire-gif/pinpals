# Who reacted, share counts and sharing to your feed (17 Oct 2026)

From the approved mock-ups "PinPals Reactions & Share" (five phone screens):
see who reacted to a post, Facebook-style, and share a post inside PinPals
(several chats at once, or to your own feed) and outside (WhatsApp,
Messages, Email, Facebook, X, More).

## What members see

**Post card** — under the photo, a new row: the top reactions as discs and
"Seán Byrne and 11 others" (`reaction-summary.ts`: "You, Aoife Kelly and 3
others", "You", or just the number when nobody can be named); on the right
"4 comments · 2 shares". The discs moved here from the action row. Share now
shows its count. A repost shows the shared post as a quoted card
(`components/quoted-post.tsx`) under the sharer's words.

**Who reacted** (`app/reactions/[id].tsx`, modal) — Reactions · Comments ·
Shares. Chips: All, then each reaction in use with its count. Rows: face with
the reaction on it, name, handicap (if shared), club; Message for PinPals,
Add PinPal for anyone else (Requested / Respond for pending). Shares lists
who shared it to their feed — the only shares with names.

**Share sheet** (`app/share/[id].tsx`, rebuilt) — the link card; Send in
PinPals as a row of faces (recent chats, then PinPals; Search for anyone):
tap several, add a message, Send to N. Share to your feed. Save. Share
outside PinPals: WhatsApp, Messages, Email, Facebook, X open with the link
ready (`shareAddress()`), More is the phone's sheet (Instagram, Copy…).

**Share to your feed** (`app/share-to-feed/[id].tsx`) — your words over the
post, audience, Share. A few words are required for now (website
`validatePostDraft`): app builds from before 0166 don't draw the shared post
and would show an empty card. The database allows none — relax the website
rule once those builds are gone. The original's author gets an in-app alert
(`post_shared`, like a reaction: never push or email), only when they may see
the share (all members, or they're the sharer's connection).

## Database — `0166_post_shares_and_reposts.sql`

- `posts.share_count` kept by a trigger on `post_shares`.
- `post_shares (post_id, user_id, channel)` primary key = one per member per
  channel, so tapping WhatsApp five times counts once. **Private**: each
  member reads only their own rows. Written only by `record_post_share()`
  (post must be visible to the caller; not 'feed') and the repost trigger.
  Age guard (0159) attached.
- `posts.shared_post_id` + `is_repost`. `posts_check_repost()` (before
  insert): a share of a share points at the original; only a post the
  member can see, shared with all members, not hidden; a plain post (no
  kind/details). No UPDATE grant. A repost records a 'feed' share; deleting
  it removes that (unless they have another repost of it). Deleting the
  original leaves `is_repost` true and `shared_post_id` null → "no longer
  available".
- `posts_check_repost()` checks `can_view_post` on the named post *before*
  following it to an original, and gives one error for missing and unseen.
- `post_likes` read policy: no reactions across a block, either direction
  (the who-reacted sheet names people). Your own always readable.
- RLS tests: `post-shares.test.ts` (10); function grants updated.

## Independent review (17 Oct) — fixed

Blocked members in who-reacted lists (now hidden by policy); a repost made
through a post the member couldn't see; the share alert leaking a
connections-only caption; caption-less reposts showing blank on old builds;
quoted posts loading reactors and share info they don't show. Accepted as
is: an outside share is counted when the app opens, even if then cancelled
(at most once per member per app).

## Old builds and databases

The app and website read 0166's columns in a separate query, so either one
ahead of the migration still loads every post (no counts, nothing shared).
Old app builds never send `shared_post_id`.

## Not verified

- Not yet seen on a phone: the who-reacted row on a busy post, the sheet's
  face row with many chats, WhatsApp/Messages opening on iOS and Android,
  and a repost of a photo post.
- A real Copy link button and Instagram Stories need a native module
  (store build); More covers both meanwhile.
