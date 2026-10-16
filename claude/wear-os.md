# PinPals for Wear OS (Oct 2026)

**Status: built in this PR, untested on a watch. Needs the Android build
(`eas build -p android`) plus a separate watch build (profiles
`wear-preview` / `wear-production`) — not reachable with `eas update`.** No
database or website changes. Builds on the Apple Watch PR
(claude/apple-watch.md) and works the same way for the member.

## What the member sees

The same as the Apple Watch:

- **Nothing to set up.** Opening a live round in the phone app puts it on the
  watch; finishing it there shows the final total; deleting it or signing
  out clears it.
- **Hole page:** hole, par, SI and a dot per shot; distance to the centre of
  the green in yards (from the member within 750 m of the green, otherwise
  the hole's length from the tee); the score, starting dimmed at net par;
  − / + or **turn the crown or bezel**; **Save**, with a buzz. Footer: last
  save, scores waiting for signal, a problem to act on, or the standing.
- **Card page (swipe left):** course, total, standing; Change the last hole;
  Picked up; every hole — tap one to change it.
- Own ball only, same formats as the lock screen card.
- GPS only while the app is open on a live round with mapped greens. Wear OS
  asks for location the first time.

## How it works

| Piece | File |
|---|---|
| Watch app (Kotlin, Compose for Wear OS, Wear OS 3+) | `mobile/wear/` — `Ui.kt` (screens), `RoundModel.kt` (buttons, distance), `Sending.kt` (queue, sending, background retry), `PhoneLink.kt` (round from the phone, GPS), `Round.kt` (the round + golf maths) |
| Adds the watch to the Android project | `mobile/plugins/with-wear-os.js` → `include ':wear'` in the generated `settings.gradle`, building from `mobile/wear` |
| Phone side | `mobile/modules/live-activity/android` — the same module as the iPhone card, Android half |
| JavaScript | `lock-screen.ts` now loads the module on Android too |

**Phone → watch.** Android has no lock screen card, but `lock-screen.ts`
makes the same calls (start, update, setGeometry, end). The Android module
merges them into one live round — the same JSON the Apple Watch gets — and
puts it on the Wear OS **Data Layer** at `/pinpals/round`. Wear OS copies it
to the watch even when the watch app is closed (`RoundListenerService`), and
later if the watch is out of reach. `isSupported` is true only when a watch
has PinPals (the watch advertises the capability `pinpals_wear`), so phones
without one make no extra calls.

**Watch → website.** The watch sends its own scores to
`POST /api/widget/live/score` with the member's key for the round — Wear OS
routes that through the phone's connection when it's near, or the watch's
Wi-Fi or mobile data. Every score is kept on the watch first; with no signal,
WorkManager sends it as soon as there's a connection, even with the app
closed. Status codes as on the lock screen: 401 → "Open PinPals on your
phone", 409 → finished, 400/403 → dropped with a notice.

The golf maths is the third copy (with the lock screen card and the Apple
Watch); change all three together.

## Building

- **Same package name and signing key as the phone app** (`ie.pinpals.app`)
  — Wear OS only lets them talk when both match. `wear/build.gradle` reads
  the package from `app.json` and, on EAS, applies the phone app's signing
  file.
- `eas build -p android --profile wear-preview` → a watch `.apk`.
  `--profile wear-production` → a watch `.aab` for Google Play.
- **Version number:** Play needs the watch build's number to differ from
  the phone's and to rise each time; `wear/build.gradle` uses minutes since
  1970, far above the phone's.
- **Google Play:** upload the watch `.aab` to the same app, on the
  **Wear OS** form factor track (Play Console → Release → Form factors →
  add Wear OS), with watch screenshots. Wear OS review is separate from the
  phone's.

## Testing without a watch or an Android phone

- **CI** (`.github/workflows/watch-apps.yml`) builds the watch app on every
  pull request that touches it and attaches the debug `.apk` to the run.
- **Android Studio's emulators** (free, Windows or Mac): create a Wear OS
  emulator and a phone emulator, pair them with Android Studio's Wear OS
  pairing assistant, install the phone `.apk` and the watch `.apk`, sign in
  on the phone, open a live round.
- First checks: the round appears on the watch; Save reaches the website and
  the phone's round screen; scoring with the watch offline queues and sends
  later; distance shows on a mapped course; the crown changes the number;
  finishing on the phone shows the total on the watch.

## Not in v1

As for the Apple Watch: group formats, a watch-face tile/complication,
birdie alerts, front/back of the green, GPS with the screen off, shot
marking.
