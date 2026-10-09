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
