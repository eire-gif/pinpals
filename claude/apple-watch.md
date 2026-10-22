# PinPals for Apple Watch (Oct 2026)

**Status: built in this PR, untested on a real watch. Needs a new iOS build
(`eas build` + `eas submit`) — not reachable with `eas update`.** No
database or website changes.

A watchOS app bundled inside the iPhone app. A golfer with PinPals on their
watch sees the live round they opened on their iPhone, and scores their own
ball from the wrist with the distance to the green in view.

## What the member sees

- **Nothing to set up.** Opening a live round on the iPhone puts it on the
  watch; finishing it there shows the final total; deleting it or signing out
  clears it. The watch app is installed from the Watch app on the iPhone
  (PinPals → Install), or automatically if they have that turned on.
- **Hole page:** hole number, par, SI and a dot per shot; distance to the
  centre of the green in yards (from the member when they're within 750 m of
  the green, otherwise the hole's length from the tee — "yds from tee"); the
  score, starting dimmed at net par; − / + or the **Digital Crown**; **Save**.
  Save moves to the next hole with no score, with a tap on the wrist. The
  footer shows the last save with **Undo**, scores waiting for signal, or the
  standing from the app ("2nd of 4", "Blues 2 UP"), else the total.
- **Card page (swipe left):** course, total and standing; Undo; **Picked up**;
  every hole with its score — tap one to go back and change it.
- **All holes in:** "All in. Finish on your iPhone to get your card certified."
  Finishing, certification and results stay on the iPhone.
- **Same rules as the lock screen card:** own ball only, and only in formats
  where everyone plays their own ball (Stableford, stroke play, singles,
  fourball). Scramble teams and foursomes are scored on the iPhone.
- GPS runs only while the watch app is open on a live round with mapped
  greens, and stops when it goes to the background. watchOS asks for
  location the first time.

## How it works

| Piece | File |
|---|---|
| Watch app (SwiftUI, watchOS 10+) | `mobile/targets/watch/` — `PinPalsWatchApp.swift` (screens), `WatchRoundModel.swift` (buttons, distance, GPS), `WatchSending.swift` (queue, sending, talking to the iPhone), `WatchRound.swift` (the round + golf maths) |
| Target config | `mobile/targets/watch/expo-target.config.js` — `@bacons/apple-targets` type `watch`, bundle `ie.pinpals.app.watchkitapp`; writes the watch Info.plist (version, location wording, `WKApplication`) |
| iPhone ↔ watch | `mobile/modules/live-activity/ios/PinPalsWatchLink.swift` (WatchConnectivity), started at launch by `PinPalsWatchAppDelegate` (an Expo AppDelegate subscriber) |
| Watch scores into the card's queue | `applyWatchScore` on `PinPalsLiveActivityBridge` in `mobile/targets/widget/_shared/LiveScoreShared.swift` |

**It rides on the lock screen card.** JavaScript already tells the card
about the round (`lock-screen.ts`: start, update, setGeometry, end). The
Expo module now hands each of those calls to `PinPalsWatchLink` too, which
merges them into one live round (course, holes with par/SI/shots, scores,
standing, greens, and the member's lock-screen key) and sends it as the
watch's **application context** — always the latest, delivered even when the
watch app isn't open. No JavaScript changes.

With a watch paired and PinPals on it, `isSupported`, `start` and `update`
report success even when the card itself can't show (Live Activities off, or
the card swiped away), so JavaScript keeps the watch up to date.

**Scores from the watch** are kept on the watch first, then:

1. **Handed to the iPhone** when it's in reach (`sendMessage`, which wakes the
   iPhone app in the background). The iPhone adds it to the lock screen's App
   Group queue, shows it on the card, and sends it to
   `POST /api/widget/live/score`. Once the iPhone replies, it owns the score —
   retried on the next lock screen tap, and drained by the app when it opens
   (`drainLockScreenScores`), like any lock screen score.
2. **Sent straight from the watch** to the same route with the same key when
   the iPhone doesn't answer within 8 seconds (a watch on Wi-Fi or with its
   own mobile data).
3. Otherwise **kept on the watch** and retried on the next save, when the
   app opens, and when the iPhone comes back into reach.

Same status codes as the card: 401 → "Open PinPals on your iPhone to keep
scoring here" (the key lasts 18 hours and the iPhone renews it while the
round is open), 409 → round finished, 400/403 → dropped with a notice.

The golf maths (net par, Stableford points, totals, next hole) is copied
from `LiveScoreShared.swift`; change both together.

## Building and testing

- `eas build -p ios` builds and signs the watch app with the iPhone app. EAS
  creates the provisioning for the new bundle id the first time; accept its
  prompt to register `ie.pinpals.app.watchkitapp`.
- **Without an Apple Watch:** the watch app can only be run in the watchOS
  Simulator, which needs a Mac with Xcode (`npx expo prebuild -p ios`, open
  `ios/*.xcworkspace`, pick the PinPalsWatch scheme and a watch simulator
  paired with an iPhone simulator). TestFlight installs it only onto a real
  watch paired with the tester's iPhone, so a TestFlight tester with a watch
  (or a borrowed one) is the practical way to try it before launch.
- First things to check on a real watch: the round appears after opening it
  on the iPhone; Save sends (website and lock screen both update); scoring
  with the iPhone in airplane mode queues on the watch and sends later;
  distance appears on a course with mapped greens; Digital Crown changes the
  number; finishing on the iPhone shows the final total on the watch.

**Watch v2 (Oct 2026):** most of the list below is now built — see `claude/watch-v2.md`.

## Not in v1 (candidates for later)

- Group scores (scramble, foursomes) and other players' scores.
- A watch-face complication (current hole, score, distance).
- Taps on the wrist when someone in the group makes birdie.
- Front and back of the green (the card's data has the centre only).
- Keeping GPS running with the wrist down for a whole round (needs a workout
  session and HealthKit).
- Marking shots for the hole map.
