# Birdie alerts (Oct 2026)

When a birdie, eagle, albatross or hole in one goes in on a live scorecard, everyone in the game gets an alert in the **PinPals app only** — the app's Inbox and a push to their phone. Never email, never browser push.

- **What counts** — gross score against par (`src/lib/live-highlight-rules.ts`): par −1 birdie, −2 eagle, −3 or better albatross; 1 stroke is always a hole in one.
- **Who hears** — every member in the round, or for a match day / scramble every member across the whole day; not the player(s) who made it (a foursomes pair or scramble team counts as one) and not whoever typed it in.
- **Mis-taps** — the app waits 12 s after the score is saved (`queueHighlight` in `mobile/src/lib/live-rounds.ts`); changing the score in that time cancels it, and the website re-reads the score from the database before sending (`POST /api/app/live/rounds/[id]/highlight`, `src/lib/live-highlights.ts`).
- **Once only** — dedupe key per round, player, hole, kind and recipient.
- **Words** — "🐦 Birdie for Eire!" / "3 on the par-4 7th at Portmarnock Links. Tap for the leaderboard." Tapping opens the round or match day.
- **App only** — `notifyUser(..., { appOnly: true })` skips email, and `sendPushToUser(..., { appOnly: true })` skips web-push subscriptions (test: `push-app-only.test.ts`).
- **Switch** — under "Tee times & matches" in notification settings.
