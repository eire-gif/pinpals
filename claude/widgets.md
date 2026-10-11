# Home Screen widgets (Oct 2026)

iPhone Home Screen widgets showing a member's live game, in the three sizes from the approved mock-up (project file `widgets.png`):

| Size | Shows |
|---|---|
| Small | Your match ("2 UP · Blues · thru 11") or your place ("2nd · Net −6 · thru 12", with the leader) |
| Medium | Match day: team score + up to 3 matches, your match highlighted. Otherwise the top 3 of the leaderboard |
| Large | Every match of a match day (up to 7), or the leaderboard (up to 7 rows) with "Updated … ago" |

Tapping a widget opens that game in the app (`pinpals://live/day/<id>` or `pinpals://live/round/<id>`). With no game on it says "No game in play"; signed out, "Open PinPals and sign in".

## How it works

- **Website** — `GET /api/widget/live` with header `Authorization: Widget <token>` returns the finished strings (`src/lib/widget-board.ts`, built from the same `live-scoring.ts` engine as the app). `src/lib/widget-data.ts` picks the game: the newest live one the member is playing in, else one finished today (Irish date), else none. Service-role read, member scoped by the token.
- **Widget key** — `POST /api/app/widget/token` (signed in) returns an HMAC-signed key valid 180 days (`src/lib/widget-token.ts`, same secret as share links). Not stored server-side.
- **App** — `mobile/src/lib/widgets.ts` puts the key and API address in the App Group `group.ie.pinpals.app` after sign-in (renewed when under 30 days left, or a different member), clears it on any sign-out, and asks the widget to refetch (at most every 15 s) whenever a round or match day screen reloads.
- **Widget** — SwiftUI/WidgetKit in `mobile/targets/widget/PinPalsWidgets.swift`, built by `@bacons/apple-targets` (target `PinPalsWidgets`, bundle `ie.pinpals.app.widgets`, iOS 17+). Timeline: every 5 min while live, 30 min otherwise (iOS spaces these out). Keeps the last scoreboard for when there's no signal.

## Shipping

Native change: needs `eas build` + `eas submit`, not just `eas update`. Because the runtime fingerprint changes, OTA updates published after this merges only reach the new build — testers must install it from TestFlight. EAS registers the extension's bundle ID and the App Group on the Apple account during the build (managed credentials).

Not covered: Android widgets; the Lock Screen Live Activity (needs an Apple push key — separate piece).
