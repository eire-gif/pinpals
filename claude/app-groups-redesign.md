# App Groups & societies — four big buttons, My Groups, Golf Buddies (18 Oct 2026)

Built from the approved mock-ups on the "PinPals Home Page Ideas" canvas
(boards G1, G2, G3, G5).

## Groups & societies (`mobile/src/app/groups/index.tsx`)

A course-photo header (`components/groups-hero.tsx`: "Groups & *societies.*"
and a line — groups, members, next outing), then the live hub's raised
buttons (`RaisedCard`, all titles the same size):

- **My Groups & Societies** (bronze) — only once you're in, invited to or
  waiting on a group; a red badge counts invitations. Opens
  `/groups/mine`.
- **Golf Buddies** (navy), **Plan a Golf Trip** (claret), **Run a Society**
  (green) — open `/groups/new` with the kind already picked (`?kind=`).
- **Find a society to join**, then **How groups work**.

Age rules unchanged: under 18s don't see the start buttons; under 16s don't
see Find a society.

## My Groups & Societies (`mobile/src/app/groups/mine.tsx`)

Invitations (Join / Decline) → filter chips by kind → your groups →
Waiting to hear back (with Withdraw).

- **Up to 5 groups (G1):** big cards — cover photo (or the kind's colour),
  badge overlapping, your role (office, "You run it", "Admin"), the next
  event ("Plan one →" for organisers when there's none), quick links:
  Events, Results (societies), Chat (if it has one), Members.
- **6 or more (G2):** a "Coming up" strip of events across your groups, then
  compact rows with role and next event.
- `RICH_UP_TO` in mine.tsx is the switch-over number.

Next events come from `loadNextOutings()` in `lib/groups-data.ts` — one read
of `society_outings` for all your groups, soonest open event each.

## Golf Buddies

The `crew` kind is shown as **Golf Buddies** (label in both copies of
`groups.ts`, kept identical), "Buddies" on chips and Home's "Buddies round"
card. The data still says `crew`. Mid-sentence it reads "group" (invite
messages and notifications), and the create button says "Create group".

## Guides

Set up a society (three ways), Join a group, and every path through "Your
group" now go via My Groups & Societies. GUIDE_CHANGES line added.
