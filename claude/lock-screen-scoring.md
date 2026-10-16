# Scoring from the lock screen (Oct 2026)

**Status: built in this PR; needs migration 0155 applied and a new iOS build
(`eas build` + `eas submit`) — not reachable with `eas update`.**

On an iPhone (iOS 17+), a live round the member is playing in appears on the
lock screen as a Live Activity, and in the Dynamic Island when the phone is
unlocked. Its buttons work **without unlocking**: − / + to set the score,
**Save** to save it and move to the next hole, **Picked up**, and **Undo**
to go back to the hole just saved. Mock-ups: the "PinPals Lock Screen
Scoring" design canvas (artboards 1–4).

## What the member sees

- Opening a live round in the app starts the card. Nothing to set up.
- The number starts at net par (par + their shots), dimmed, as on the app's
  scoring screen. Most holes are one tap: Save.
- Header: hole, par, SI and a dot per shot; their total ("18 pts · thru 6",
  "Net +2 · thru 6", "Thru 6"). Footer: the last save with Undo, scores
  waiting for signal, or their standing from the app ("2nd of 4",
  "Blues 2 UP"). The standing is cleared as soon as a score goes in from
  the lock screen, so it's never shown stale.
- All holes in → "Open PinPals to finish and get your card certified".
  Finishing (or deleting) the round in the app takes the card down; a
  finished card keeps the final total for 15 minutes. Sign-out removes it.
- **Own ball only**, and only in formats where everyone plays their own ball
  (Stableford, stroke play, singles, fourball). Scramble teams, foursomes
  pairs and foursomes/greensomes matches are scored in the app.
- Swiping the card away leaves it gone for that round (until the app is
  reopened later).
- Apple limits a Live Activity to 8 hours and about 160 points of height;
  the card is three rows to fit.

## How it works

| Piece | File |
|---|---|
| Card UI (lock screen + Dynamic Island) | `mobile/targets/widget/LiveScoreLiveActivity.swift` (in the existing `PinPalsWidgets` extension and bundle) |
| Attributes, intents, App Group queue, sending, JS bridge | `mobile/targets/widget/_shared/LiveScoreShared.swift` — `_shared` = compiled into the app **and** the extension |
| JS ↔ Swift bridge | `mobile/modules/live-activity` (local Expo module; calls `PinPalsLiveActivityBridge` by name) |
| When to start / update / end; draining unsent scores | `mobile/src/lib/lock-screen.ts`, `lock-screen-rules.ts` (+ test) |
| Hook-up | `app/(tabs)/live/round/[id].tsx` (load, effect, delete), `lib/auth.tsx` (sign-out) |
| Key | `src/lib/live-score-token.ts` (+ test), `POST /api/app/live/rounds/[id]/lock-screen-key` |
| Save | `POST /api/widget/live/score` → `live_round_set_own_score()` (0155) |

- **Buttons** are `LiveActivityIntent`s. Because the type is in both targets,
  iOS runs them in the app's process (launched in the background, phone still
  locked), where ActivityKit can update the card.
- **Saving**: the score goes into an App Group queue first, the card updates
  at once, then it's POSTed with `Authorization: LiveScore <key>`. No
  signal → it stays queued, retried on the next tap; when the app opens it
  takes the queue over (`takePending` → `score-queue.ts`), so nothing is lost.
  401 → "Open PinPals to keep scoring here"; 409 → round finished; 400/403 →
  dropped with "A score wasn't accepted".
- **The key** is HMAC-signed (same secret as share links, different prefix
  from the widget key so neither verifies as the other), names one member and
  one round, lasts 18 hours, and is refreshed whenever the round screen opens.
  Sent as a header, never in a URL.
- **0155 `live_round_set_own_score(member, round, hole, strokes, clear)`**:
  service role only (the website calls it after checking the key). Writes the
  member's **own** player row only, live rounds only, refuses scramble /
  foursomes / greensomes, holes off the card and strokes outside 1–20.
  `entered_by` is the member; the broadcast trigger fires as usual, so the
  group's phones and the TV board update.
- **Birdie alerts**: a birdie or better saved from the lock screen alerts the
  game like an in-app score (`notifyHighlight`, after the response).

## Tests

- `supabase/tests/rls/lock-screen-scores.test.ts` (5) — member and anon
  can't call it; own ball only; picked up / clear; finished; shared-ball
  formats refused. Confirmed to fail when the grant is widened, as does the
  function-grants register (entry added). Full RLS suite 883/883 on a fresh
  replay; unit tests 1618/1618; app `tsc` clean.
- The Swift can't be compiled outside Xcode. It was reviewed line by line by
  a separate agent; fixes from that review are in. **The first EAS build is
  the compile check.**

## To ship

1. Merge, let Vercel deploy (the app needs the two new routes live).
2. Apply `0155_lock_screen_scores.sql` to production (no `drop`, so the
   Supabase tool applies it in one go).
3. In the Codespace: `git pull`, `cd mobile`,
   `eas build --platform ios --profile production`, then
   `eas submit --platform ios --latest`. New native code (module + intents),
   so the runtime fingerprint changes: testers need the new TestFlight build.
4. Test on the course: open a round, lock the phone, Save a few holes, turn on
   Airplane Mode for one, turn it off and open the app — it should send.

## Not done yet

- **Android** — the same idea as an ongoing notification with −1 / +1 / Save
  actions. Needs its own native module; no Android device to test on yet.
- **Other players' scores on the lock screen** while it's locked (needs
  ActivityKit push updates from the server via APNs). Today the card's
  standing refreshes whenever the app is opened.
- **Marking for the group** from the lock screen (artboard 6) — own ball only
  for now.
- **Apple Watch** (artboard 7).
