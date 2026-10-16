# Follow my round (Oct 2026)

**Status: built on branch `follow-my-round`. Needs migration 0158 applied, the
PR merged (Vercel deploys the website), then `eas update`. No native build:
nothing here adds a native module.**

A player shares their live scorecard with someone who isn't playing — a
parent at home following a junior, a friend at work. Two ways, from **Share
live** on the scoring screen:

| | Who | What they get |
|---|---|---|
| **Share a link** | anyone, no app or account | `pinpals.ie/follow#<secret>` — a phone page that updates every 15s, flashes a birdie, can be added to the Home Screen |
| **Send to PinPals** | accepted PinPals | Live scoring → **Following**, the follow screen, their Home Screen widget, and alerts for the start, birdies or better, and the finish |

## What a follower sees

One card: the shared player's holes (gross marked like a paper card, the
format's value — points, net, or W/L/½), running total, Out/In, the hole
they're on, and their place as **"2nd of 4"**. Never anyone else's name or
score, never a location. Scramble/foursomes: the side's one ball, under the
player's name and team. Built once, server-side, by `src/lib/follow-card.ts`
so the web page, the app and the widget all say the same thing.

## Who may share / stop

- Your **own** card. If you started the round (or organise its match day),
  a **guest's** card too — PinPals is 18+, so a junior plays as a guest and
  the adult who set up the round sends the parent the link.
- Never another member's card. If a guest later claims their seat, other
  people's shares of it stop at once (trigger).
- Stop: whoever shared it, the member whose card it is (they always see
  every share of their card in Who's watching), or the follower.
- Everything lapses **18 hours** after it was shared. Deleting the round
  removes its shares.
- PinPal shares are re-checked on every read: a block either way (with the
  sharer or the golfer), an unfriending or a deleted account ends it at once.

## Security notes

- The link's secret is 32 random bytes; only its SHA-256 is stored. It sits
  after the `#`, so browsers never send it to a server (not in Vercel logs,
  not in referrers); the page sends it as `Authorization: Follow <secret>`.
  `referrer: no-referrer` on the page as well. A stopped link is final.
- Service-role reads happen only after access is proven (the link's hash,
  or the follow row read under RLS with the member's own client).

## Map

| Piece | File |
|---|---|
| Table, RLS, `live_follow_share`, `live_follow_stop`, claim trigger | `supabase/migrations/0158_live_round_follows.sql` |
| RLS tests (12) | `supabase/tests/rls/live-follows.test.ts` + function-grants register |
| What a follower sees (pure, + tests) | `src/lib/follow-card.ts`, `follow-card.test.ts` |
| Loading, link hashing, Following list, widget fallback | `src/lib/follow-data.ts`, `src/lib/live-games.ts` |
| Alerts (`live_follow_started`, `live_follow_update`) | `src/lib/follow-notifications.ts`, `live-highlights.ts`, `.../rounds/[id]/finished` |
| Share / Who's watching | `POST`/`GET /api/app/live/rounds/[id]/follow` |
| Following (app) | `GET /api/app/live/follows`, `GET /api/app/live/follows/[id]` |
| Public card | `GET /api/follow/card`, page `src/app/follow/` |
| App | `live/share/[id].tsx`, `live/follow/[id].tsx`, `components/share-live-row.tsx`, Following on the hub, `lib/live-follow.ts`, flag `liveFollow` |

Alerts are under **Tee times & matches** (app only, never email).

## To ship

1. Apply `0158_live_round_follows.sql` to production (no `drop` in it, so the
   Supabase tool takes it in one go).
2. Merge the PR; let Vercel deploy (the app needs the new routes).
3. In the Codespace: `git pull origin main`, `cd mobile`, `eas update`.
4. Test: start a round, Share live → Share a link, open it on another phone;
   score a birdie and watch it flash. Send to a PinPal; check their
   Following, their widget, and Stop from both sides.

## Not done yet

- The followed card on the follower's **lock screen** as a Live Activity
  (needs ActivityKit push from the server).
- Batching: the Following list builds each card one by one (fine for a few).
