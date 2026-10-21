# Live day on the website (/society/[id]/live) — 21 Oct 2026

**Asked (Eire, 21 Oct 2026):** full management of a live event for society
organisers on the website — starting the game, choosing the club and the
players, a live scoreboard and preparing the results — the same functions as
the app, in a clear, colourful interface. Mock-ups approved: canvas
*Society Live Day Console* (5 boards: set up, players & groups, start, live
control room, cards in & results).

## What an organiser does

1. **Society admin → Live day** (new menu item, events area), or **Live day**
   on an event. Today's and upcoming days out, and recently played ones.
2. **Set up & start** (`/live/<event>`), on the day of the event:
   - Tees from the club's cards on file (`course_cards_for_club`), or type a
     card; rating and slope; the card's par and stroke index per hole
     (editable for this round; every index needed).
   - Format: Stableford or stroke play (95%), foursomes or greensomes pairs
     (seats 1 & 2, 3 & 4; Stableford or stroke), or a scramble (each tee
     group a team of 2 or 4).
   - Start: tee times from the published draw, or a shotgun (one time; start
     holes by `shotgunStarts`, written back to the event's draw).
   - Keep the leaderboard secret (0174).
   - Preview: every group with each player's index → course handicap →
     playing handicap (or the pair's / team's). Problems listed (no draw,
     a missing handicap, a bad card).
   - **Start the round** → the same calls as the app's From a group:
     `live_fourball_day_create` / `live_scramble_day_create`,
     `link_outing_match_day`, `set_day_leaderboard_hidden`; players notified
     (`notifyMatchDayPlayers`).
3. **Live control room** (same page once started, refreshes every 20 s):
   totals (on the course, holes scored, birdies, groups in, needs you); the
   leaderboard in the TV board's colours with an 18-cell hole-by-hole strip
   per card (net of shots); which group is on each hole; **Needs you** (a
   group quiet 25 min, a group 20 min past its tee time with no score, an odd
   score, missing stroke indexes); group progress cards; the birdie feed;
   secret leaderboard on/off; **Open the TV board** / connect a TV by its
   code; message the players.
4. **A group's card** (`/live/<event>/card/<round>`): every hole with shots
   and points; whoever started the day can correct scores while it's live
   (`live_round_set_score`).
5. **Cards in & results** (`/live/<event>/results`): a chip per card
   (certified, waiting, amended, not in, NR, DQ); podium and table per
   division with countbacks and tie breakdowns; prizes; the checks; for the
   organiser — tie rule, divisions, best gross, guests, side prizes,
   amendments (always with a reason) — Save, **Publish the results** / the
   update, Take down. Results are on the society's page (set_group) and
   everyone in the day is told (`notifyResults`).

## How it's safe

- No migration and no new privileges. Pages use `requireConsole(area:
  "events")`; every action runs through `consoleAction` and then the app's
  own database functions with the member's OWN client.
- Nothing posted becomes a player, a handicap or a group: `startRound`
  reads the draw and the society's handicaps again and plans the day in
  `live-day.ts`. Results are worked out on the server from the cards in the
  database (`live-results.ts`), never taken from the browser.
- As in the app, only whoever **started** the day can correct scores and
  save/publish results (0104 / 0137); other officers see the control room
  (0174 `live_day_organiser`) and a provisional results view.
- Service role only as the app routes use it: notifications after a start
  or a publish, and pairing a TV code (organiser checked with
  `live_day_is_organiser`, rate-limited as `/api/app/live/tv`).

## Code

- `src/lib/society-console/live-day.ts` (+ test): `planDay`, `cardProblems`,
  `controlRoom`.
- `src/lib/society-console/live-results.ts` (+ test): entrants with the app's
  keys, `workOut`, `settingsFrom`.
- `src/lib/society-console/live-day-data.ts`: cards, the draw as groups, the
  live day; `src/lib/tv-data.ts` now exposes `loadTvGames`.
- `src/app/society/[id]/live/**`, `src/components/society-console/live-ui.tsx`.
- Guide: *Run your society → Run it from a computer* mentions Live day.

## Not yet

- Mixed tees (each player off their own tees) and match days (Blues v
  Golds) still start in the app; their boards show here once started.
- Divisions and side prizes are set on the results, not before the start.
