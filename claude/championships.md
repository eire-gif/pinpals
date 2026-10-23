# Multi-day championships (Oct 2026, migration 0187)

**Asked (Eire, 23 Oct 2026):** a leaderboard over 2, 3 or 4 days, a different
course each day, PGA style, showing whether each player is up or down on the
previous day; as many formats as possible; no cut. For societies, trips and
Golf Buddies, and on the widgets. Mock-ups approved: canvas *PinPals —
multi-round leaderboard* (5 boards).

## How the days add up (decided by Eire, 23 Oct)

- Every day scored the same way (all points, or all net strokes) → **scores
  added up**: total points, or strokes to par over all the days.
- Days that mix points and strokes → **places points each day**: 25, 20, 16,
  13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, then 1 for everyone else who
  finishes. Team and pair days give every player on the side the side's
  points. Ties split them (three level for 2nd share 2nd–4th).
- The organiser can choose places points instead when the days all match.
- A day's order comes from its **published results** when there's one
  division (so countbacks count); otherwise from the scores, ties shared.
- **Movement** = place now against the end of the previous day (as the PGA
  shows it all day while a round is live).
- **Level at the end** (every day final): the better final day wins, then the
  day before; still level, shared.
- Strokes to par: a player with no score on a finished day isn't ranked
  ("missed R2"). In points, a missed day simply adds nothing.
- Matchplay days (a match day, or a trip round on matchplay) are played as
  usual but don't count.

The rules: `src/lib/championship.ts`, byte-identical in
`mobile/src/lib/championship.ts` (drift test in `championship.test.ts`).

## Model

- `group_championships` (title, rule `auto` | `places`, `trip_outing_id`, status).
- A championship's days are **ordinary day outs** — `society_outings` with
  `championship_id`, `championship_round` (1–4) and `championship_format`
  (the app's Start a Round format ids). Each keeps its own entries, draw,
  live set-up, start, card and published results.
- A **trip** championship takes its days from the trip's round items, which
  now remember their live day: `society_outing_items.match_day_id`, set by
  `link_outing_item_match_day` when the round is started from the itinerary
  (closes the gap in `outing-itineraries.md` "Next 1").
- Functions: `save_championship` (2–4 days in date order within 3 weeks;
  each day through `save_outing`; days played/started left alone; fewer days
  cancels the dropped ones), `cancel_championship`, `set_championship_entry`
  (join/leave every open day via `set_outing_entry`; days that can't change
  are skipped), `set_trip_championship`, `link_outing_item_match_day`.
- RLS: group members read; no direct writes. Tests:
  `supabase/tests/rls/championships.test.ts`; grants snapshot updated.

## Data

`src/lib/championship-data.ts` → `championshipFor(memberClient, admin, id, viewer)`:
the championship row with the member's own client (RLS), then each day's
live rounds via `loadTvGames`, scored with `live-scoring` (`scoreDay`):
points or net to par, team sides on one ball. Published results take over a
finished day (`applyPublished`: amended scores, places, DQ/NR dropped). A
secret leaderboard (0174) shows no scores to non-organisers until published.

- App: `GET /api/app/championships/[id]` returns the payload; the app adds it
  up for any "after day N" tab without another request.
- Website: `/championships/[id]` (members; `?tv=1` full screen, refreshes
  every 20 s while live) and `/society/[id]/events/championship/*` (new,
  manage, edit) in society admin. Day outs for a championship start the
  website Live day on the day's planned format.
- Widgets: `src/lib/championship-widget.ts` swaps a championship day's widget
  payload for the overall board (rows carry `move`) and your overall place.

## App

- Events → New event → **Multi-day championship** (`group/[id]/championship/new.tsx`).
- Events shows one navy card per championship; each day is labelled DAY n.
- Leaderboard: `group/[id]/championship/[cid].tsx` — R1–R4 tabs, ▲▼, you
  highlighted, biggest movers, the days, Join all days, Share the TV link.
- Itinerary: officers get **Run a leaderboard across the trip**; everyone then
  sees **Trip leaderboard**.
- A championship day's outing page links to the overall leaderboard.
- Guide: *Run a multi-day championship* (`guide.ts`, id `championship`).

## To ship

1. Apply `0187_championships.sql` (new table and columns; no drops).
2. Merge; Vercel deploys the website.
3. `git pull origin main`, then `cd mobile && eas update --branch production --platform ios`
   (no native change in this PR).
4. The widget's ▲▼ arrows are a Swift change, kept in its own PR for the next
   native build. Until then the widget shows the overall board without arrows.

## Not done

- The website's trip page has no leaderboard switch yet (the app has it).
- The clubhouse TV pairing (`/tv`) shows one day; the championship board has
  its own full-screen link instead.
- Android widgets don't exist yet.
