# Hole maps — GPS yardages and shot positions

Oct 2026. **Status: 0108 and 0109 applied to production (9 Oct 2026; the `delete` parts by hand in the SQL editor); `shotMaps` on in the branch — live once PR #150 is merged and published with `eas update`. No native build.**

A member opens any hole on satellite imagery, sees live distances to the
front, centre and back of the green and to the hazards ahead, taps anywhere
to measure to it (and on from it to the green), and — in a live round —
marks where each shot was played from, so every shot's length appears.

## Where it is in the app

- **Live round → "Hole map"** (gold pill under the hole number). Opens on
  that hole, measuring from the member, with "Mark shot" for the selected
  player.
- **Course page → "Hole by hole"**: a numbered button per mapped hole; before
  a course is mapped, one "Satellite view" row that still measures taps.
- Screen: `mobile/src/app/hole-map.tsx` (root stack, swipe-back off so a map
  pan from the left edge doesn't leave the screen).

## The screen, after Hole19 (9 Oct 2026)

Members compared it with Hole19 and found ours busy: half the screen was a
panel, and every neighbouring hole's outlines competed with the one in play.
Now:

- **The photo is the whole screen.** No header: a back button, the course
  name and the yds/m switch float at the top; recentre, outlines on/off and
  "put the aim back" down the right.
- **One sheet at the bottom**: Hole N, par, SI and length, then front /
  centre / back, then "from you" or "from the tee". **Swipe it sideways** for
  the next or previous hole (or the arrows). In a live round, Mark shot and
  undo sit on it too.
- **The aim circle.** On a hole longer than a drive, a white circle sits a
  drive out (210 m ≈ 230 yds, `defaultAim` in hole-geo.ts) on the line to
  the green, with the distance to it and from it to the green on the lines.
  **Drag it**, or tap anywhere to move it. Within reach, one line straight
  to the green with the centre distance. The page moves the lines while the
  circle is dragged; the numbers come back from the app on release, so
  every number is still worked out in one place. GPS updates arriving
  mid-drag are held, not drawn.
- **Quieter outlines**: fainter fills, and only the current hole's line of
  play. The layers button turns them off (remembered while the app is open).
- **Shots, hazards ahead, and the course's other loops** moved into a
  pull-up list (the list button on the sheet).
- Map page HTML moved to `mobile/src/components/hole-map-page.ts` so it can
  be rendered in a browser for checks (Leaflet from npm, no tiles): drag,
  a GPS tick mid-drag and the single hole line verified that way.

### Tee, aim and bunker numbers (10 Oct 2026, from the first test on the course)

- **Drag the T** to the tee box you're playing (the mapped tee is one box,
  and on OSM courses sometimes in the wrong place — Portmarnock Links 4
  started on a neighbouring green). The hole length, front / centre / back
  and the lines all re-measure from it (`withTee` in hole-geo.ts). Kept per
  loop and hole while the screen is open; the refresh button puts the tee
  and the aim back. The view doesn't move when the T does.
- **Move the aim circle and the three numbers follow it**: front / centre /
  back become distances from the circle ("From the aim circle", with
  Reset). Left alone, they're from you or the tee as before.
- **Bigger aim-to-green number** on the map (gold, 18 px).
- **Bunker and water distances** in small white numbers beside each hazard
  still ahead of you (or the tee) — from where you're measuring.
- **Fitting after turning:** the hole was fitted before the map rotated, so
  a diagonal hole could end up under the course name (the green did on
  Links 4). The page now measures the turned hole and zooms/centres it
  inside the clear area (`fitTurned`). Checked in Chromium with a 40° hole.

### Where Hole19's imagery comes from

Hole19 doesn't say publicly. Apps like it license commercial satellite
imagery (Google, Apple, Mapbox, Maxar). The free route for us, at the next
native build, is **Apple Maps satellite on iOS** (MapKit, no per-use fee)
via react-native-maps; Google Maps SDK is free on Android. That would also
settle the Esri licence question below — but it's a new store build and a
rewrite of the drawing, so it isn't in the over-the-air update.

## How it's built

| Piece | File |
|---|---|
| All the arithmetic (distances, hazards ahead, shot lengths, framing) | `mobile/src/lib/hole-geo.ts` (+ test, 14) |
| Reads/writes | `mobile/src/lib/hole-maps.ts` |
| The map (Leaflet 1.9.4 + leaflet-rotate 0.2.8 in the existing web view) | `mobile/src/components/hole-map-view.tsx` |
| Database | `supabase/migrations/0108_hole_maps.sql` (+ RLS test, 7) |
| Provider import | `supabase/functions/import-golfapi/` (+ mapper test, 11) |

- **Why a web view, not react-native-maps:** the web view is already in the
  shipped binary, so this reaches TestFlight as an OTA update. A maps SDK
  would change the fingerprint and need a store build.
- The map page only draws; every number is worked out in `hole-geo.ts` and
  passed in as text. It turns the map so tee → green points up (and checks
  it did, flipping if a plugin version rotates the other way).
- Measured **from the member** when they're within 750 m of the green,
  otherwise **from the tee** — and it says which.
- "Mark shot" waits for a GPS fix of ±30 m or better. A shot's length is the
  distance to where the next shot was marked; the last is open.
- Units: metres for Irish, Spanish and Portuguese clubs, yards for British;
  a toggle on the map, remembered while the app is open.

## Database — 0108

| Table | Holds | Access |
|---|---|---|
| `course_layouts` | a course at a club with geometry; golfapi course id | no table access; `course_layout_get(club_id)` |
| `course_layout_points` | tee/green front-centre-back/hazards per hole | as above |
| `live_round_shots` | each shot's GPS fix and accuracy | read with the round; write via `live_round_shot_add` / `_undo` |

- **One club at a time.** golfapi.io's terms require reasonable measures
  against scraping their data out of PinPals, so the layout tables have RLS
  with no policies and no grants; the app reads one club per call through a
  signed-in-only function. The RLS test fails if a select policy is added.
- Shots: whoever can score the round can mark for anyone in it; numbered per
  player per hole under a row lock; undo takes back only the last; 20 max;
  frozen when the round finishes; broadcast on `live-round-<id>`.
- **Privacy:** a shot is a GPS fix of a member. It lives only with the round,
  and a deleted member's shots are deleted (their player row survives,
  renamed, as in 0103).

## Course data — golfapi.io

Terms read 9 Oct 2026: commercial use in our own product; store and cache
indefinitely; **delivered data may still be used after a plan ends**; no
attribution; no reselling as a dataset; must protect against scraping.

Costs: course details 1 call, coordinates 1 call, searches 0.1. So a course
with its hole map is **2 calls**. Ireland + UK + Spain + Portugal (~3,500
courses) ≈ 7,000 calls ≈ two months on the 4,000 plan (€299/month), then
cancel. Plans: 50 / 500 / 2,000 / 4,000 calls a month at €29 / €99 / €199 /
€299; unlimited €399/month billed annually.

### The importer (`import-golfapi` Edge Function)

Secrets: `GOLFAPI_KEY` (Edge Function secret, entered in the Supabase
dashboard), and `golfapi_import_secret` in **Vault** (0109) — every request
must send it as `x-import-secret`, so the function runs with JWT checking
off and imports can be started from SQL with `net.http_post`, reading the
secret from Vault (example at the top of `index.ts`). Optionally
`GOLFAPI_BASE_URL` (default `https://www.golfapi.io/api/v2.3`, **unverified**).

1. `{"action":"search","club_id":N}` — candidates nearest first. 0.1 call.
2. `{"action":"inspect","golfapi_course_id":"…"}` — raw responses and what
   the mapper made of them. **Do this first on the trial**: the field names
   in `mapping.ts` come from golfapi's older docs and haven't been seen in a
   live response yet. Fix the mapper from the report before a paid pull.
3. `{"action":"import","club_id":N,"golfapi_course_ids":["…"],"max_calls":10}`
   — writes cards (source `provider`, verified, so members can't overwrite
   them) and points. A member-entered card for the same tees is kept unless
   `overwrite_member_cards`. `dry_run` maps without writing. Refuses if the
   cost would exceed `max_calls`.

Provider cards flow straight into live scoring: set-up already offers a
club's saved cards, so stroke indexes stop needing to be typed in.

## OpenStreetMap shapes (Oct 2026)

Volunteers have drawn most Irish courses in OpenStreetMap: greens,
fairways, tees, bunkers, water, and a line per hole from tee to green
(`golf=hole`, `ref=<n>`). The hole map now uses it two ways:

- **Outlines** over the satellite photo — fairway, tee, green, bunker and
  water shapes and the dashed line of each hole — like a yardage book.
- **Yardages where golfapi has none:** `osmLayoutPoints` turns the shapes
  into the same points golfapi supplies (tee, green front / centre / back,
  bunkers and water within 40 m of the line; a bunker within 45 m of the
  green centre counts as greenside). A golfapi-mapped hole always wins;
  an OSM-derived hole says "Mapped by OpenStreetMap volunteers".

Checked against golfapi at Portmarnock: OSM green centres within 1–4 m on
all 18 holes, hole lengths within a few yards. So for courses OSM covers,
golfapi is only needed for stroke indexes and ratings (1 call per course,
no GPS call).

| Piece | File |
|---|---|
| Parse Overpass, pick hole lines, derive points (pure) | `mobile/src/lib/osm-course.ts` (+ test, 9) |
| Fetch | `mobile/src/lib/osm-fetch.ts` |

- **Fetched by the phone**, not the server: the public Overpass mirrors are
  unreliable from Supabase (timeouts, 500s) and fine from a phone. One query
  per course per app session (2 km around the club), cached in memory;
  failures aren't cached. Mirrors tried in order: overpass-api.de,
  maps.mail.ru, kumi.systems. Overpass is a free shared service — only on
  opening a hole map, never on a loop.
- **27-hole clubs** have several "hole 1"s: hole 1 is the one nearest the
  club, each next hole the one whose tee is nearest the last green.
- **Licence:** ODbL. The map shows "© OpenStreetMap contributors" whenever
  outlines are drawn. We don't store OSM data in our database, so there is
  no share-alike obligation on it.
- **Accuracy varies** by how carefully a course was drawn; a course with no
  hole lines gets outlines only (if any), no OSM yardages.

## Before public launch

- **Satellite tiles:** Esri World Imagery is the development default
  (`MAP_TILE_URL` in `mobile/src/lib/config.ts`). License it for an app — an
  ArcGIS Location Platform key, or switch to Mapbox satellite — by setting
  `EXPO_PUBLIC_MAP_TILE_URL` / `EXPO_PUBLIC_MAP_ATTRIBUTION`.
- **Location wording:** the iOS permission text still says "tee times near
  you". Update it in `app.json` (`NSLocationWhenInUseUsageDescription` and
  the expo-location plugin) **with the next native build** — editing it now
  changes the runtime fingerprint and would stop OTA updates reaching
  current TestFlight builds. App Review expects the wording to cover GPS
  yardages.
- **Not yet built:** an admin screen for search/import (curl for now); a
  staff editor to place points by hand for courses golfapi doesn't cover;
  a website version of the map.

## Not verified

- OSM outlines and OSM-derived yardages haven't been seen on a phone yet;
  the parsing and geometry are tested, the drawing isn't.
- Nothing here has been run on a phone: the map page and orientation need
  a look on a device after the OTA. Distances and permissions are tested.
- ~~golfapi.io's response shape~~ verified 9 Oct 2026 on live data.

## First import — 9 Oct 2026 (trial key, 25 calls)

Base URL `https://www.golfapi.io/api/v2.3` and every field name confirmed.
Cross-check: Portmarnock 1st, back tee to green centre by GPS ≈ 412 yds;
golfapi's card says 417 (Blue).

Imported (cards verified, so members can't overwrite them; GPS on all):

| Club (id) | Course | Tee cards | Points |
|---|---|---|---|
| Portmarnock GC (605) | Championship (golfapi "Red + Blue") | 6 | 90 |
| Portmarnock Links (606) | Links | 6 | 148 |
| The Island (346) | The Island | 8 | 103 |
| Royal Dublin (308) | Royal Dublin | 9 | 90 |
| St Anne's (326) | St Anne's | 6 | 90 |
| Howth (195) | Howth | 5 | 95 |
| Sutton (336) | Sutton (9 holes; points cover both loops) | 4 | 110 |
| Forrest Little (604) | Forrest Little | 5 | 97 |

Not yet: **Malahide** and **Donabate** — golfapi lists each as nine 18-hole
combinations of three loops (likewise Portmarnock). Import the combination
members actually play, with `course_name` and, if a second one is added
later, `prefix_tees: true` so the tee cards don't collide.

Learned:
- **Rate limit:** ten requests at once got HTTP 429s. Send one at a time.
  A refused request wasn't charged.
- Hazards vary: Portmarnock, Royal Dublin and St Anne's have tees and greens
  only; Portmarnock Links has ~58 hazard points.
- 5 trial calls left after this run.

The parts of 0108 containing `delete from` (`live_round_shot_undo`,
`live_round_player_forget_shots` + trigger, and the shots broadcast on delete
— as `live_round_shots_broadcast_removed` in production) were run by hand in
the SQL editor, because the Supabase tool cancels any batch containing one.
Checked afterwards: grants as registered, triggers present.
