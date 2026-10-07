# Live scoring

Oct 2026. **Status: migration 0103 applied to production (7 Oct 2026, in parts 0103a–h); `liveScoring` flag on in this branch, live once merged and published with `eas update`.**

A group starts a round in the app, picks a format, adds players (themselves,
their PinPals, guests by name) and scores hole by hole. Everyone in the round
sees the leaderboard move as scores go in.

## What a member does

1. **Home → Live scoring** (the card under "How was golf today?") or
   **☰ → Play → Live scoring**. The bottom tab bar stays on every screen:
   live scoring is a stack inside the tab group with `href: null`.
2. **Set up:** course from the directory; tees (a saved card if one exists,
   otherwise tee name, rating, slope, par typed from the card); 18 or 9
   holes; format; players with their **handicap index**. "Plays off" is
   worked out live as they type.
3. **Score:** one hole at a time. The number shown is par plus your shots in
   grey; tap it to confirm, − / + to change, hold to clear, "picked up" for
   NR. Points, net scores and shot dots per player.
4. **Leaderboard:** Stableford (points and pace), stroke play (gross and net
   to par) or singles matchplay (holes up, dormie, won 3&2, a W/L/½ grid).
5. **Finish round**, and **Save this card** for the course.

## The arithmetic — `src/lib/live-scoring.ts`

Pure, shared byte-for-byte with `mobile/src/lib/live-scoring.ts` (drift test).

- Course handicap = index × slope ÷ 113 + (rating − par), halves up (WHS).
  No rating or slope on file → the index is used and flagged *estimated*.
- Playing handicap = course handicap × allowance: Stableford and stroke 95%,
  singles matchplay 100% (the higher handicap receives the difference).
- Shots go by **rank of stroke index** among the holes played, hardest first;
  plus handicaps give shots back on the easiest holes. A card with any
  stroke index missing gives **no** shots rather than wrong ones, and the
  screens say so.
- Points, positions and match status are computed on every render, never
  stored.

Fourball, foursomes and scramble are listed as "coming soon" in the picker.

## Course data — the honest position

A GolfCourseAPI test (7 Oct 2026, free tier) returned course rating, slope,
par and lengths per tee for Portmarnock, Royal Dublin, Lahinch, Ballybunion,
Druids Glen and Rosslare, but **no stroke index for any hole of any of
them**, and nothing at all for Old Head or County Louth. Rosslare's own
current card for the Burrow appears to differ from the API.

So stroke indexes come from members, once per course:

- `course_cards` / `course_card_holes` (0103) hold a card per club and tee.
- The first group to play a course enters the stroke indexes on the scoring
  screen (par and SI chips; SIs already used are shown dashed), then saves the
  card. Every later round at that course and tee starts filled in.
- `source` records where a card came from (`member` today). An official
  import (Golf Ireland, a licensed provider) writes the same rows with its
  own source and `verified_at`; a verified card can't be overwritten by a
  member. No screen changes are needed when that arrives.

The API key used for the test belongs in a Supabase/Vercel secret if an
import is ever built, and should be regenerated first (it was shared in chat).

## Database — 0103_live_scoring.sql

| Table | Holds |
|---|---|
| `live_rounds` | course, tees, format, holes, rating/slope/par, allowance, status |
| `live_round_players` | up to 8; member or guest; index, course and playing handicap |
| `live_round_holes` | the round's own copy of the card (par, SI) |
| `live_round_scores` | strokes per player per hole; NULL = picked up |
| `course_cards`, `course_card_holes` | saved cards per club and tee |

- Read: whoever started the round and members playing in it
  (`can_view_live_round`). Course cards: any signed-in member.
- Write: only through `live_round_create`, `live_round_set_score`,
  `live_round_set_hole`, `live_round_finish`, `course_card_save`. No write
  policies or grants on the tables.
- Members can be added only by themselves or an accepted PinPal, never across
  a block. At most 5 live rounds per member.
- Every score/card change sends a private broadcast `live-round-<id>`
  ("go re-fetch"), authorised by a `realtime.messages` policy.
- Account deletion: a deleted member's player row stays (others' totals must
  add up) but loses its link and is renamed "Former member" by trigger.

Tested: `supabase/tests/rls/live-scoring.test.ts` (14 tests; confirmed to fail
when `can_view_live_round` is loosened) and the function-grants register.
Full RLS suite 612/612 on a fresh replay. Production checked after applying:
RLS on all six tables, the realtime policy, function grants as registered,
signed-in users read-only on the tables. Supabase's security advisor raises
nothing new beyond the expected "signed-in users can call this function".

Applying it: the Supabase tool cancels a batch that contains a `drop`
statement (it waits for a confirmation that never arrives), so it went in as
parts without the no-op `drop policy if exists`. The file is still the
single source and replays cleanly.

## To ship

1. ~~RLS tests~~ done. 2. ~~Apply 0103~~ done. 3. ~~Flag on~~ done in the branch.
4. Merge PR #132, then in the Codespace: `git pull origin main`, then
   `eas update` (check the Commit line). No native build needed: nothing here
   adds a native module.

## Map

- Screens: `mobile/src/app/(tabs)/live/` — `_layout.tsx`, `index.tsx` (hub),
  `new.tsx` (set-up), `round/[id].tsx` (score + leaderboard)
- Data: `mobile/src/lib/live-rounds.ts`
- Entry points: `components/live-scoring-card.tsx` (Home), `lib/menu.ts`
  (`feature: "liveScoring"`, filtered by `visibleMenu()`)
- Hidden tab: `Tabs.Screen name="live"` in `app/(tabs)/_layout.tsx`
