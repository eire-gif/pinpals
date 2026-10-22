# Watch v2 — Apple Watch and Wear OS (Oct 2026)

**Status: built on branch `claude/watch-v2` (PR #333), untested on a real
watch. Needs migration 0185 applied, the PR merged (Vercel deploys the two new
routes), then new store builds — `eas build -p ios` and `eas build -p android`
plus the `wear-production` profile. None of it reaches members with `eas update`.**

Mock-ups: the Design canvas "PinPals — watch v2" (three boards). Builds on v1
(`claude/apple-watch.md`, `claude/wear-os.md`).

**Wear OS v1 had never reached `main`.** PR #250 was merged into the
`claude/apple-watch` branch after #249 had already merged, so the Wear OS app,
its CI workflow (`.github/workflows/watch-apps.yml`) and the Android half of
the phone module were stranded. This PR brings them across (cherry-picked
with their history) along with v2.

## As built — what's different from the plan below

- **Plays like is wind only**, as on the phone's hole map (`wind.ts`). The
  phone has no height data, so no elevation migration: the watch never shows
  a guessed slope number. On by default; a Plays like switch on the card page
  turns it off on that watch.
- **Hazards show one distance each** (to the hazard's mapped point). The
  course data has one point per hazard, not a near and far edge, so "reach /
  carry" from the mock-up would have been invented. Ones behind you drop off;
  markers and doglegs are left out, as on the phone.
- **Start round from the wrist was left out.** A round needs its format, tees
  and players chosen; that stays on the phone, which then puts it on the watch.
- **Wear OS keeps the GPS going wrist-down with a foreground location service
  shown as an Ongoing Activity** (PinPals icon on the face, one tap back), not
  Health Services: no workout is saved to Health Connect on Android. Apple
  Watch runs the round as a golf workout (saved to Health).
- **Birdie taps are for your own group** (from the scores the phone already
  has), not society-wide lead changes.
- **Secret leaderboards:** the Home Screen widgets were showing every group's
  scores on a secret-leaderboard day — the widget route reads with the service
  client and never checked `leaderboard_hidden`. `widget-data.ts` now shows a
  non-organiser only their own group (0174's `live_day_organiser` decides who
  organises), which the watch's leaderboard reuses.

## Setup before release

- **Supabase:** apply `0185_watch_group_scores.sql`.
- **Apple:** the first `eas build -p ios` registers two new things — the
  complications extension `ie.pinpals.app.watchkitapp.complications`, and the
  HealthKit and App Group capabilities on the watch app. Accept EAS's prompts.
- **Google Cloud (Wear OS map):** in the project that holds the Map Tiles key,
  enable **Maps SDK for Android**, create an API key restricted to Android
  apps with package `ie.pinpals.app` and the SHA-1 of the upload key and of
  Play's app signing key, and save it as the EAS secret `WEAR_MAPS_API_KEY`.
  Without it the Wear OS map page says "Map coming soon" (everything else works).
- **Google Play:** the watch build now declares a foreground location service;
  Play asks for a short declaration (and a video) of why. Answer: live golf
  round distances with the screen off, stops when the round ends.

## What's where

| Piece | Files |
|---|---|
| Group scores from a watch | `supabase/migrations/0185_watch_group_scores.sql` (`live_round_set_scores_as`, service role only, the app's `can_score_live_round` rule for a passed-in member), `src/app/api/widget/live/scores/route.ts`, `src/lib/watch-scores.ts` (+ test), `supabase/tests/rls/watch-group-scores.test.ts` |
| Leaderboard | `src/app/api/widget/live/board/route.ts` (LiveScore key) → `widget-data.ts` |
| Phone → watch | `mobile/src/lib/lock-screen-rules.ts` (`lockScreenSpots` adds front/back/hazards; `watchGroup`, `watchNames`; + tests), `mobile/src/lib/lock-screen.ts` (the `watch` key: group, competition, wind, Premium, board), the round screen passes the group and `gate("gps_yardages")`; `PinPalsWatchLink.swift` / the Android module keep `watch` |
| Apple Watch | `targets/watch/WatchPagesV2.swift` (pages), `WatchRound.swift` (data, distances, plays like), `WatchRoundModel.swift` (group, leaderboard, birdie tap), `WatchSending.swift` (group queue), `WatchWorkout.swift`, `WatchGlance.swift`; `targets/watch-widget/` (complications + Smart Stack) |
| Wear OS | `mobile/wear/.../PagesV2.kt`, `Round.kt`, `RoundModel.kt`, `Sending.kt`, `RoundService.kt`, `Glance.kt`, `PinPalsTileService.kt`, `PinPalsComplicationService.kt` |

The golf maths (net par, points) and now plays like are copied in Swift and
Kotlin from `live-scoring.ts` / `wind.ts`. Change them together.

---

## The plan (as specced, 22 Oct)

## Screens (pages swiped left→right, Crown/bezel steps between them)

| # | Page | Apple Watch | Wear OS | Data |
|---|---|---|---|---|
| 1 | Distances | Back / **Centre** (gold, 62pt) / Front; "Plays N" + wind chip | Same, stacked on the centre line | `green_front/centre/back` from `course_layout_points` |
| 2 | Hole map | SwiftUI `Map` `.imagery` (watchOS 10+), hole rotated tee-up, tap/drag target, Crown zoom | Maps SDK for Android on Wear, `MAP_TYPE_SATELLITE`, bezel zoom | tee + green points; arithmetic as `hole-geo.ts` |
| 3 | Hazards | Reach / carry rows; ones behind the player drop off | (same list, round insets) | `green_bunker`, `fairway_bunker`, `water`, `marker_*` |
| 4 | Group scores | Four rows, tap → Crown sets; − / Save all / + | Tap → bezel; Save all only | new endpoint (below) |
| 5 | Leaderboard | Live board, member's row highlighted | Member's row kept centred | `GET /api/widget/live` (`widget-board.ts`) |
| 6 | Competition mode | "COMP" pill; plays-like and wind hidden | chip reads COMP | `rules.competition` flag in payload |
| — | Card | v1 card page unchanged | v1 unchanged | — |

Glances: Apple complications (circular hole+distance, points, rectangular
standing), Smart Stack widget, Wear OS Tile + ranged-value complication,
birdie double-tap, "Start round" for today's booked round.

## Rules carried from the app

- **One live game per tee time.** Start round on the watch calls the same
  start path as the phone; if the round is open it joins, never creates.
- **Competition mode (Rule 4.3):** on whenever the round is a society
  competition, a Compete fixture, or the organiser ticks it. Hides
  plays-like, wind and elevation everywhere on the watch (and the
  complication). Distance only. Casual rounds keep everything.
- **Hidden leaderboard events:** page 5 shows only the member's own line; no
  birdie/lead alerts.
- **Group scoring** follows the phone's permissions: the member can enter
  for players they're allowed to mark in the app. Foursomes/greensomes and
  scramble enter one team score (row per team, not per player).
- Junior members (13–17): live scoring and sharing as now; no change.
- Large type throughout (on-course readability): nothing below 12pt except
  map attribution.

## Data changes

### 1. Richer geometry to the watch (no DB change)
`lock-screen.ts → setGeometry` sends only `green_centre` today. Extend the
spot per hole to:

```json
{ "hole": 7, "tee": {"lat":..,"lng":..},
  "green": {"front":{..},"centre":{..},"back":{..}},
  "hazards": [{"kind":"water","label":"Water R","front":{..},"back":{..}}] }
```
Hazard "reach" = distance to the hazard's near point, "carry" = far point; for
single-point hazards show one number. Keep the old `greens` field for the
lock-screen card (it reads centre only). Send once per round, as now.

### 2. Plays-like
`playsLike = distance + elevationDelta·1.0 + windAdjust` where
`windAdjust = distance × 0.01 × headwindKmh·k` (k ≈ 0.6 head, 0.35 tail; tune
from `weather-rules.ts` which already holds wind). Elevation: add
`elevation_m` to `course_layout_points` (migration, nullable) filled from the
golfapi.io data where present, else Open-Meteo elevation API at import. If
either is missing, show plain distance and no "Plays" line — never a guess.
Put the formula in `mobile/src/lib/plays-like.ts` (+ test) and port to Swift
and Kotlin like the golf maths (fourth copy — keep them in step).

### 3. Group scores endpoint
`POST /api/widget/live/scores` (header `LiveScore <key>`):
`{ hole, scores: [{ player_id, strokes|null }] }` → `{ ok, saved: [player_id] }`.
New RPC `live_round_set_scores(p_member, p_round_id, p_hole, p_scores jsonb)`
that applies the **same marker check the app uses** for each player and skips
(not fails) anyone the member can't mark. Same status codes as `/score`. The
watch queue (`WatchSending.swift`, `Sending.kt`) gets a second item type; v1
own-score items keep using `/score`.

### 4. Payload additions (`PinPalsWatchLink` / Android module)
`players: [{id, name, short, shots, is_me}]`, `format`, `teams` (for team
formats), `rules: {competition, hiddenBoard}`, `boardUrl` (the round's
`/api/widget/live` id). Additive keys — v1 watches ignore them.

## Native work

**Apple Watch (`mobile/targets/watch/`)**
- `HoleMapView.swift`: `Map(position:)` with `.mapStyle(.imagery)`,
  camera heading = bearing tee→green so the hole is upright,
  `MapReader` for tap → target, `digitalCrownRotation` for camera distance.
- `DistancesView.swift`, `HazardsView.swift`, `GroupScoreView.swift`,
  `LeaderboardView.swift`; `TabView(.verticalPage)` order as the table.
- **Workout session:** `HKWorkoutSession(activityType: .golf)` started with
  the round so GPS keeps going wrist-down; ended on Finish. Needs HealthKit
  entitlement + `NSHealthShareUsageDescription`/`UpdateUsageDescription` in
  `expo-target.config.js`; ask only when the member starts a round.
- **Complications:** a WidgetKit extension target (`type: "widget"` with
  watchOS families: `.accessoryCircular`, `.accessoryCorner`,
  `.accessoryRectangular`, `.accessoryInline`) reading the round from the
  watch's App Group; reload on each save/new hole. Smart Stack uses
  `.accessoryRectangular` with `relevance` during a live round.
- Birdie tap: `WKInterfaceDevice.current().play(.success)` twice, from the
  leaderboard poll (every 60s while open; pushed via application context
  when the phone sees it).

**Wear OS (`mobile/wear/`)**
- `HoleMapScreen.kt`: `com.google.maps.android:maps-compose` on Wear,
  `MapType.SATELLITE`, ambient mode → hide map, show distances.
  Same Google Cloud project as the phone's Map Tiles key; add the Maps SDK
  for Android and restrict the key to `ie.pinpals.app` + both SHA-1s.
- Pager: `HorizontalPager` + `rotaryScrollable`.
- **Exercise:** Health Services `ExerciseClient`, `ExerciseType.GOLF`, keeps
  location in the background (`FOREGROUND_SERVICE_HEALTH`).
- **Tile:** `TileService` (ProtoLayout) — hole, distance, standing, "Score hole".
- **Complication:** `ComplicationDataSourceService`, `RANGED_VALUE`
  (tee→green progress) + `SHORT_TEXT`.

## Build order

1. Geometry payload + Distances + Hazards (no backend change). **Smallest
   useful release.**
2. Hole map (both platforms) + workout/exercise session.
3. Competition flag + plays-like (migration for elevation).
4. Group scores endpoint + page 4.
5. Leaderboard page + birdie taps.
6. Complications, Smart Stack, Tile, Start round.

## Testing (no watch on hand)

watchOS Simulator (Mac + Xcode) supports **Features → Location → City Run /
custom GPX** — build a GPX walking a mapped Portmarnock hole to check
distances and hazard drop-off. Wear OS emulator: Extended controls → Location
→ load the same GPX as a route. Before release, one real watch of each for GPS
accuracy, battery over 4 hours, and wrist-down tracking.

## Same change, when built

Per AGENTS.md: add watch steps to the live-scoring / hole-map guides in
`mobile/src/lib/guide.ts` (+ a dated `GUIDE_CHANGES` line) and run
`guide.test.ts`. Update `claude/apple-watch.md` and `claude/wear-os.md`
"Not in v1" lists as each phase lands.

## Decisions (22 Oct 2026)

- **Plays-like is on by default** in casual rounds (a Settings switch can
  turn it off). Competition mode still hides it automatically.
- **Group scoring: anyone the app already lets score the group** — not
  limited to a designated marker. `live_round_set_scores` uses the app's
  existing check, unchanged.
- **Hole map and plays-like are Premium features, free for now.** Gate them
  behind the existing paid-tiers switch (`claude/memberships.md`), which
  stays off for everyone, so every member gets them until paid plans go
  live. Distances, hazards, scoring and the leaderboard stay free. When the
  switch is on and a member isn't Premium, the map page shows a one-line
  "Premium" card (no price, no link — App Store rule 3.1.1) and the Plays
  line is simply not shown.
