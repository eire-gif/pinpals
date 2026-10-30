# Ryder Cup mode for trips (30 Oct 2026, migration 0200)

**Asked (Eire, 30 Oct 2026):** "Ryder Cup mode for trips — two teams, mixed
formats across days, and a running points total." Mock-ups approved on the
canvas *PinPals Ryder Cup Mode* (5 boards), then "build it".

**Status:** PR #363 (branch `ryder-cup-mode`). Migration 0200 is additive (no drops) and was **applied to production 30 Oct 2026** (checked: RLS on all four tables, signed-in read only on three, lineups unreadable directly, no anon access, the ten functions signed-in only).
App only (Expo, `eas update`; no native module). Feature flag `tripCup`.

## How it works

- A **Cup** belongs to an overnight or abroad trip (`society_outings`), set
  up from the trip's Itinerary: **Play it as a Ryder Cup**. Two team names,
  who holds it (keeps it on a tie), how teams are picked (captains pick /
  balanced by handicap / random), and whether lineups are secret.
- **Teams:** whoever runs the trip puts players on teams (by hand, Balance by
  handicap, Random draw) and stars a captain for each. In a captains' pick the
  captains then pick in turn on their own phones — team 1 when level,
  otherwise the smaller team.
- **Sessions:** one per round on the itinerary (fourballs, foursomes,
  greensomes, singles), plus an optional afternoon session on a 36-hole day.
  Matches per session = what the smaller team fills. Every match is a point,
  halved ½ each.
- **Lineups:** each captain orders their team (match 1 first, pairs for
  fourballs/foursomes) and sends it. Secret pairings: each side sees only its
  own until both are in — not even the organiser sees the other side's.
- **Start the session** (organiser) opens Groups & Societies with the
  session's format and the Cup's team names locked, everyone on a team
  ticked, and the matches made from the two lineups (or each team in order),
  team 1 always side 1. A draw that puts a player on the wrong side is
  refused ("swap players within a team"). The match day is linked to the
  session (and, for a morning session, to the itinerary round).
- **Scoring:** a session IS a Match Day Fun day; nothing new is stored.
  `loadCupPage` loads each session's day and adds the totals
  (`trip-cup-rules.ts` `cupState`): to win = half + ½; holders keep it on
  half; decided as soon as it can't be caught. The scoreboard updates live
  through each live day's broadcast channel.

## Files

- `supabase/migrations/0200_trip_cups.sql` — `trip_cups`, `trip_cup_players`,
  `trip_cup_sessions`, `trip_cup_lineups` (each with an identity PK — see
  0199); RPCs `trip_cup_save`, `_cancel`, `_set_teams`, `_pick`,
  `_save_sessions`, `_submit_lineup`, `_lineups` (the secret-aware read),
  `_link_session`; helpers `trip_cup_member`, `trip_cup_officer`.
- `supabase/tests/rls/trip-cups.test.ts` (6 tests); grants register updated.
- `mobile/src/lib/trip-cup-rules.ts` (+ tests), `mobile/src/lib/trip-cup.ts`,
  `mobile/src/components/cup-bits.tsx`.
- Screens: `app/group/[id]/cup/[outingId].tsx` (scoreboard, setup, finish),
  `cup/teams/[outingId].tsx`, `cup/sessions/[outingId].tsx`,
  `cup/session/[sessionId].tsx`; Cup card on the itinerary; cup mode in
  `app/(tabs)/live/day/group.tsx` (params `cup`, `session`).
- Guide: new **Play the trip as a Ryder Cup**; `guide.test.ts` lets "captain"
  through for this guide only (team captains, not a society office).

## Not done

- No push notifications for "your pick" / "lineups are in" yet.
- No website pages or TV view for the Cup (the session's day has its own TV link).
- No shareable picture — Share sends the result as text.
- Guests (non-members) can't be on a Cup team.
