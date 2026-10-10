# Add to calendar, and an easier match tee time (10 Oct 2026)

**Status: website parts live once `main` deploys on Vercel; app over the air. No migration, no native build.**

## What a member sees

- **Tee times:** "Add to my calendar" on the tee time screen for the host
  and for confirmed players (until the day). Offered once automatically the
  moment a round becomes theirs — straight after posting it, and when they
  confirm an offered place.
- **Match days:** "Add my match to my calendar" on the board (organiser:
  "Add the match day…"), offered once after setting a day up. The event is
  their own match — "Saturday Society — Match 2", its tee time.
- Tapping it opens Safari with the event and **Add to Calendar** — no
  permission prompt. A one-hour reminder is on timed events. No time set →
  an all-day event on the date. Tee time with only a "from" time → starts
  then, and says to check PinPals for the exact time.
- **Match tee times** are picked on a clock wheel in a sheet (no more typing
  "09:20" on the punctuation keyboard), with quick picks "+8 / +10 / +12 min"
  after the previous match. A new match starts ten minutes after the last.

## How it's built

| Piece | File |
|---|---|
| ICS builder, course time zone → UTC, signed links (pure, + test 4) | `src/lib/calendar-ics.ts` |
| Link API — checks the member is in the round (RLS + host/confirmed/player) | `src/app/api/app/calendar/route.ts` |
| The .ics itself (no session: the signed token *is* the event, 7-day expiry) | `src/app/cal/[token]/route.ts` |
| App helper | `mobile/src/lib/calendar.ts` |
| Clock sheet | `mobile/src/components/time-sheet.tsx` |

Why a link and not the phone's calendar API: the app's native build has no
calendar module (expo-calendar would mean a new store build and a calendar
permission prompt). Safari's .ics handling does the same job over the air.
`/cal/*` is deliberately **not** in the apple-app-site-association, so it
opens Safari rather than the app.

Time zones by club country: Ireland Europe/Dublin; NI, England, Scotland,
Wales Europe/London; Spain Europe/Madrid; Portugal Europe/Lisbon.

## Not verified

- Not yet tried on a phone (Safari's Add to Calendar sheet in particular).
- Moving a tee time later doesn't update an event already added — the
  member adds it again (same UID, so Calendar may offer to replace it).
