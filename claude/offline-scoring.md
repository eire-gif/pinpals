# Offline scoring (Oct 2026)

Signal is poor on plenty of Irish links courses. A live round must never lose
a hole, and must open and score with no signal at all.

## What was already there

`score-queue.ts` kept a score that failed for want of signal and resent it.
Two holes in it:

- The phone copy was one SecureStore value, which refuses anything over
  ~2 KB — about 20 queued scores. Past that, closing the app lost them.
- Everything else needed signal: opening the round (or reopening the app in
  a dip) showed "Couldn't load", scramble drives failed, and Complete
  scorecard could finish a round with scores still waiting on a phone.

## What changed

- **`phone-store.ts`**: JSON (Maps included) in a file in the app's documents
  folder (expo-file-system, already part of Expo — no new build). If a build
  lacks it, chunked SecureStore. Pure helpers in `phone-store-rules.ts`.
- **`score-queue.ts`**: stored with phone-store (up to 600 waiting), moves the
  old SecureStore copy across once, also queues scramble drives
  (`sendDrive`), retries every 15 s and when the app comes to the front, and
  gives up on a hanging send after 10 s so it waits on the phone instead.
- **`round-cache.ts`**: the last 3 live rounds saved on the phone each time
  they load. `loadRoundAnyway()` falls back to the phone's copy on no signal
  (or after 8 s on one bar), with waiting scores laid over it
  (`overlayPending`). Finished or deleted rounds are forgotten.
- **Live round screen**: opens from the phone with a "No signal — this is the
  card saved on your phone" line; refetches once everything has sent;
  Complete scorecard sends everything first and refuses to finish while
  anything is still waiting.
- **MY ROUND pill**: with no signal and no pill yet, the live round saved on
  the phone (today or yesterday).
- **Hole map**: the course and hole maps are saved on the phone and used with
  no signal; GPS distances work; satellite tiles need signal.
- **My Game stats queue** moved off the 2 KB store too.
- Guide: new step *No signal? Keep scoring* in Score a game live.

## Not covered

- Starting a new round needs signal (the round is created on the server).
- Shots marked on the hole map, a hole's par/index edit, and birdie alerts are
  not queued; birdie alerts for scores sent late aren't sent.
- If two phones change the same hole while one is offline, the one that syncs
  last wins.

## To ship

App only, no database change: GitHub → Actions → Publish app update.
