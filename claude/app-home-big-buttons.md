# App Home — big buttons and "today" card (18 Oct 2026)

Built from the approved mock-ups on the "PinPals Home Page Ideas" design
canvas (boards marked ★: chosen layout, society outing today, friends' group
round today).

## What changed on Home (`mobile/src/app/(tabs)/index.tsx`)

Over the hero photograph, top to bottom:

1. **Watch live** — only when a member or connection has shared a live card
   with you (`loadFollowing()`, first item whose state is `live`). Opens
   `/live/follow/[id]`.
2. **Date and greeting** — "Sunday 18 October / Evening, Geoff." with the
   invite QR button beside it (was beside "Find your next fourball").
3. **Today / Up next** — `HomeToday` in `components/home-top.tsx`.
   - The soonest of your next tee time (`summary.nextRound`) and your next
     group event (`summary.nextEvent`, society_outings you're entered in,
     within 7 days). An event wins a tie.
   - On the day: a dark card with gold edge and **Start your round here**
     (becomes **Continue your round** when `myOpenGame()` finds an open game).
     - Tee time: role, time, "in 42 min", the fourball's faces → `/live/new?teeTime=…`
     - Event: crew / society / trip label, Paid ✓ or Pay entry, tiles
       (shotgun + your start hole, or first tee + your tee, and how many
       playing), your tee group → the event's match day if it has one,
       otherwise `/live/new`.
   - Within a week: a slim Up next strip (day, time, what, and a tag:
     requests waiting / Pay entry / You're in).
   - Nothing in the week: nothing shown.
4. **Four big buttons** — the live hub's `RaisedCard`, all titles the same
   size (`wrapTitle`): Find Golfers (claret → Tee Times), Start a Round (navy
   → the Score it together hub, `/live`), Groups & Societies (green →
   `/groups`), Marketplace (new **bronze** tone → Marketplace tab).

Below the photo: **Explore how PinPals works** (→ the how-to guides), any
group invitation waiting, then everything that was there from "Your round"
down, unchanged. **How was golf today?** moved down, just above From the
clubhouse. The "You're hosting" card is skipped on the day it is already the
top card.

Removed from the hero: "Ireland · UK · Spain · Portugal", "Find your next
fourball", the club count, the gold Find PinPals button and the four glass
tiles. Members are still reached from PinPals near you → See all and the menu.

## Data (`mobile/src/lib/home.ts`)

- `nextEvent()` reads your own `society_outing_entries` joined to
  `society_outings` (open, plays today … +7 days), then the group, the field
  and your payment in parallel.
- `todayPlayers` — host + confirmed players, read only when the next tee
  time is today.
- Every read is caught: a failure hides that part, never the screen.

## Guides

`mobile/src/lib/guide.ts` steps updated (Start a group, Post a tee time,
Find a game, Score a game live, Bring your fourball, Sell your gear) and a
GUIDE_CHANGES line added.
