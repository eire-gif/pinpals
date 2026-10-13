# Filling an open place: invite a PinPal or send a link (Oct 2026, migration 0132)

## Decisions (Eire, 13 Oct 2026)
- **Who:** the host and anyone with a confirmed place can fill an open place.
- **Saying yes:** unchanged — the invited golfer taps I'm interested and the host confirms. An invite never offers the place by itself.

## What a member does
- On a round they host or are playing in, each **Open place** reads "Invite a PinPal or send a link". Tapping it opens **Fill a place**:
  - **Send a link** — WhatsApp, Text or More, to anyone. The message: course, day, time, and the link.
  - **Your PinPals / Find PinPals** — tick members, **Send invitations**. Each gets a "X invited you to play" alert.
- Everyone else still sees "Open place · Waiting for a golfer".

## What the person invited sees
- **On PinPals, in the app:** the alert or link opens the round (even a connections-only round), where they tap I'm interested.
- **Not signed in, in the app:** the round's web page with Join PinPals / Log in; the link is remembered and the round opens once they're in.
- **On the web:** `pinpals.ie/t/<token>` — course, day, time, places left, first names. Signed in, it has the I'm interested button; signed out, Join PinPals / Log in. Not indexed, and never shows notes, the handicap limit or who else is playing.
- A link stops working when the round fills, is played or cancelled, or the sharer is no longer in it.

## Database (0132_tee_time_invitations.sql)
- `tee_time_invitations` (round, member, invited_by, via member/link) — seen by the invited, the inviter and the host.
- `invite_to_tee_time(round, members[])` — host or confirmed only; skips the host, anyone in or asking, blocked pairs; returns who was newly invited.
- `tee_time_link_claim(round, sharer, member)` — service role only, called by the website after checking the link's signature.
- The round's read policy and the "express interest" policy now also allow an invited member.

## Website
- `src/lib/tee-time-links.ts` — signed `/t/<token>` links (domain-separated from post and scorecard links).
- `POST /api/app/tee-times/invites/[id]/share` → `{ url }`; `POST …/invite` → `{ invited }` (+ `tee_time_invited` alerts); `POST /api/app/tee-times/link` → `{ invite_id }`.
- `src/app/t/[token]/page.tsx` — the public page. `/t/*` added to the app's universal links (iOS). Android opens the web page until a native build adds the path.

## App
- `app/invite/[id].tsx` — tappable open places; `app/round-invite.tsx` — Fill a place; `app/tee-link.tsx` — where `/t/` links land; `lib/tee-time-sharing.ts`.
- Guide: **Fill a place in your round**.
