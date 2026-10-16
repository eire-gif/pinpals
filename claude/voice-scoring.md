# Voice scoring (Oct 2026)

**Status (16 Oct 2026): built, not yet on a phone. Needs a new iOS build
(`eas build` + `eas submit`): it adds two native modules
(expo-speech-recognition, expo-task-manager), new Swift in the lock screen
card, and new Info.plist keys. No migration, no website change.**

Mock-ups: the "PinPals Voice Scoring" design canvas (artboards 1–7).

## What a member does

- **In the app:** on the round screen, under the players, **Say scores**.
  They say the group's scores the way they'd tell the group — "Niamh bogey,
  I had par, Dec took a double and Ciarán a four". Listening stops by itself
  after a short silence, or on **Done**.
- **Check:** one row per player with the score, a Par / Bogey / Double tag,
  what it heard ("“niamh bogey”") and − / +. Anything it wasn't sure of is
  outlined in gold with the reason ("Sounded like “for”. Did you mean 4?")
  and a **Yes, 4** button; **Save** stays off until every one is settled. A
  player it didn't hear says "Not heard" and is left alone unless − / + is
  tapped. **Save & go to hole 8** saves through the same path as tapping
  scores in (offline queue, birdie alerts, the lock screen card, the group's
  phones). **Say it again** and **Cancel** underneath.
- **From the lock screen:** the card has a small gold **mic**. Tapping it
  unlocks (Face ID) and opens the round on the card's hole, already
  listening. Beside it, the **distance to the centre of the green** in yards
  ("152 yds", location arrow) once they're within 750 m of the green, else
  the hole's length from the tee (flag). Tapping it opens the hole map on
  that hole.

## What it understands — `mobile/src/lib/voice-scores.ts` (+ test, 22)

Runs on the phone, no network. It knows the hole's par, who's in the group
and their shots on the hole.

| Said | Means |
|---|---|
| birdie, par, bogey, double (bogey), triple, eagle, albatross, hole in one, ace | against the hole's par |
| net par / net bogey… | plus the player's shots here |
| one … fifteen, 4 | strokes |
| picked up, pick up, no score, blob, NR, wiped | picked up |
| "five for Niamh" | the score before the name |
| "Niamh five, no, six" / sorry / actually / make that | the correction |
| "the rest of us par", "we all had bogeys", everyone | everyone not yet scored |
| "Niamh and I both had par" | the last two named |
| "Dec the same", "same for me" | the score before |
| I, me, my, we, us | the member holding the phone (their side for a pair or team) |

Names: each part of a player's name, near spellings ("Niam"), short forms
("Dec" for Declan), and how recognisers write Irish names (`NAME_SOUNDS`:
Niamh → Neve, Caoimhe → Keeva, Ciarán → Kieran, Oisín → Osheen/Ocean,
Tadhg → Tiger…). Everyday words never count as names (`NOT_NAMES`: "and" is
not Andrew, "had" is not Hadley).

**It flags rather than guesses** (`check`): a sound-alike word ("for" 4,
"to" 2, "won" 1, "ate" 8, "tree" 3) when nothing better was said for that
player; two players it can't tell apart; two different scores for one player
without a correction word; no name at all (it assumes the speaker, and asks);
"net" on a hole with no shots set; par + 5 or worse. Not scores: "two putts",
"on in two", "on seven", "on the par four".

## Listening — `mobile/src/lib/voice-listening.ts`

expo-speech-recognition 57.1.1, required lazily (native-capabilities.ts
`HAS_SPEECH`: older binaries never show the button).

- en-IE, else en-GB, else en-US (`getSupportedLocales`).
- **On the phone** whenever it can (`requiresOnDeviceRecognition` =
  `supportsOnDeviceRecognition()`): works with no signal, and audio never
  leaves the phone. Otherwise Apple's online recogniser; with no signal that
  fails with "Voice needs a signal on this phone. Tap the scores in instead."
- The group's names and the golf words go in as `contextualStrings`.
- Continuous, stops 2.2 s after the last word (9 s if nothing is said).
  iOS 18 sends each phrase after a pause as its own final result: they're
  joined, so a pause mid-sentence loses nothing.
- Waits until the app is properly in front before listening (opened from
  the lock screen's mic, it's still coming up through Face ID, and iOS takes
  the microphone straight back: "interrupted"). If something does take the
  microphone (a call, Siri, the phone locking), words already heard go to the
  check; with nothing heard yet it quietly starts again once. Going to the
  background mid-sentence finishes with what was heard.
- Permission refused → "Open Settings". Cancel during the permission
  prompt doesn't start the microphone afterwards.

## The sheet — `mobile/src/components/voice-scores-sheet.tsx`

Mounted by the round screen (`app/(tabs)/live/round/[id].tsx`) for anyone
who can score a live round, when `voiceScoring` is on and the phone can
recognise speech. The hole is fixed when the sheet opens (`voiceAt`), so
scores land on the hole they were said for even if the screen's hole moves
underneath. `score()` now takes the hole and a `quiet` flag and reports
success; a refused save stops the run and shows in the sheet.

Deep link from the lock screen: `pinpals://live/round/<id>?voice=1&hole=N`
→ the round on hole N, sheet open. Only for a player or the round's starter,
only while live; the params are cleared once used.

## The lock screen card

Swift: `mobile/targets/widget/_shared/LiveScoreShared.swift`,
`LiveScoreLiveActivity.swift`; bridge `mobile/modules/live-activity`.

- Attributes gain `voiceUrl` and `mapUrl` (append the hole number);
  `lockScreenLinks()` in lock-screen-rules.ts builds them. Either is nil
  when its feature is off or there's no club. Optional, so a card started by
  an older build still decodes.
- ContentState gains `distance` (yards) and `distanceFrom` ("you"/"tee").
- Bottom row: Picked up · the footnote (now "Hole 6 · 4 · 3 pts" + Undo,
  shorter, and the first to shrink) · `[152 yds]` · `[mic]`, both `Link`s.
- Greens: `setGeometry` stores each hole's green centre and tee in the App
  Group (`lockScreenSpots()`: golfapi.io's points, OpenStreetMap's where it
  has none — the hole map's order).
- Position: `lock-screen-location.ts` runs expo-location updates through an
  expo-task-manager task (defined at launch from the root layout). Started
  from the round screen in the foreground, so iOS carries them on in the
  background with **"While using the app"** permission — no "Always"
  needed (UIBackgroundModes `location`; the blue location pill shows while
  it runs). Asked once, with the reason ("Distance to the green on your lock
  screen?"); never again after a no. High accuracy, every 4 m, Fitness
  activity, fixes worse than 50 m ignored.
- Each fix → `setLocation` → Swift measures to the card's **current** hole
  (it may have moved on from the lock screen) and redraws when it changes by
  2 yards or more. Swift also re-measures on Save, Undo and every update
  from the app. The last fix is kept 10 minutes.
- Stops: round finished or deleted, sign-out, card swiped away, or a fix
  that finds no running card ("not running").

## Config

app.json: `NSSpeechRecognitionUsageDescription`, microphone wording now
mentions scores, `NSLocationAlwaysAndWhenInUseUsageDescription` (required
key; we don't ask for Always), expo-location
`isIosBackgroundLocationEnabled: true` (Android off), the
expo-speech-recognition plugin. Feature flag `voiceScoring` (kill switch,
on). Guide: Score a game live → "Or say the scores", and the lock screen
step mentions the mic and the yardage.

## Not verified

- **Nothing here has run on a phone.** The Swift can't be compiled outside
  Xcode: it was reviewed line by line by a separate agent (captured `var`s
  in `Task` closures fixed from that review). The first EAS build is the
  compile check.
- Recogniser accuracy on Irish names and on-course wind: the first round
  will tell. `NAME_SOUNDS` is where to add what it gets wrong.
- Battery over 18 holes with the distance on.

## To ship

1. Merge (no migration, nothing for Vercel).
2. In the Codespace: `git pull`, `cd mobile`, `npm install`,
   `eas build --platform ios --profile production`, then
   `eas submit --platform ios --latest`.
3. On the course: Say scores for a fourball; tap the lock screen mic; walk
   a hole with the phone locked and watch the yardage; turn on Airplane Mode
   and Say scores (should still work on a recent iPhone).
