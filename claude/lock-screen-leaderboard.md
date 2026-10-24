# The leaderboard on the lock screen (Oct 2026)

A second lock-screen card (iPhone Live Activity) under the scoring card while
a member's round is live, showing their game's leaderboard. Asked for on
24 Oct 2026. Builds on `claude/lock-screen-scoring.md`.

**Needs a new iOS build** (`eas build` + `eas submit`) — new native code. No
migration and no website change: it reads the board route the watch already
uses. Kill switch: `lockScreenBoard` in `mobile/src/lib/features.ts`.

## What the member sees

```
🏆 LEADERBOARD · BIG TEST          ● LIVE 14:32  (⟳)
1st   Ciarán Byrne            14   +3
2nd   Eire · You              12   +1     ← their row lit up
T3    Ruth Daly               13    E
T3    Tom Walsh               11    E
```

- Comes up with the scoring card when the round has other players or is part
  of a match/scramble day (`others` from the round screen). Not for a round
  on your own.
- Stroke play / Stableford / scramble / foursomes: the top four, or the top
  three plus the member's row when they're lower; below the eight rows the
  website sends, a line "You 12th · 18 pts · thru 6". Multi-day
  championships show the ▲/▼ moves.
- Matches and match days: the team totals (Blues 3½ – 2½ Golds) and up to
  three matches with who's up, the member's among them.
- The time is when the website worked the board out; LIVE greys if it's not
  refreshed for 10 minutes. ⟳ refreshes it without unlocking. A tap opens
  the round on its **Leaderboard** tab (`pinpals://live/round/<id>?view=board`).
- A secret leaderboard shows only the member's own group, as everywhere else.
- It sits **below** the scoring card: relevance 50 v 100, so the scoring card
  keeps the Dynamic Island. If the board's the one in the Island, it shows
  the member's place ("2nd", "2 UP").
- Ends with the scoring card — finished rounds keep the final board for 15
  minutes; deleted rounds and sign-out take it straight away. Swiped away,
  it stays away for that round.

## Keeping it fresh (no server push yet)

The card fetches `GET /api/widget/live/board` itself, with the scoring card's
LiveScore key (same payload as the Home Screen widgets and the watch). It
refreshes:

- about **once a minute** while the distance-to-green location updates run —
  they keep the app awake with the phone locked (`setLocation` in the bridge);
- after every score saved from the lock screen or the watch (≥10 s apart);
- whenever the app scores or reopens the round (≥15 s apart);
- on ⟳ (≥5 s apart).

Without location permission it still refreshes on all but the first. A
fully push-driven card (others' scores arriving with the app asleep) needs
ActivityKit push updates via APNs — an Apple .p8 key on Vercel and the
activity's push token sent to the server — Expo's push service can't send
Live Activity updates. Not done yet.

## Where it lives

| Piece | File |
|---|---|
| Payload types (moved from PinPalsWidgets.swift), attributes, which rows fit, App Group store, refresh, ⟳ intent, start/end (app only) | `mobile/targets/widget/_shared/LiveBoardShared.swift` |
| The card + Dynamic Island | `mobile/targets/widget/LiveBoardLiveActivity.swift`, registered in `PinPalsWidgetBundle` |
| Started / refreshed / ended alongside the scoring card | `_shared/LiveScoreShared.swift` (`startBoard`, `save`, `setLocation`, `applyWatchScore`, `end`) |
| `board`, `boardApi`, `boardUrl` sent to Swift | `mobile/src/lib/lock-screen.ts`, `lockScreenBoard()` in `lock-screen-rules.ts` (+ test) |
| `others`, `?view=board` | `mobile/src/app/(tabs)/live/round/[id].tsx` |
| Guide | "Score from your lock screen" in `mobile/src/lib/guide.ts` |

## Not done yet

- Push updates from the server (above).
- Android: there's no lock screen card on Android yet at all.
- A member setting to turn just the leaderboard card off (swiping it away
  works per round).
