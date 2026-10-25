# Team handicaps set by hand (Oct 2026, migration 0189)

**Status:** 0189 applied to production 25 Oct 2026 (checked: 4 columns, function granted to authenticated only, trigger in place). PR #348. After merge: `eas update` (JS only).

Asked by Eire, 25 Oct 2026: in a scramble (2s or 4s), foursomes or greensomes — any game where a team or pair plays off one handicap — the organiser can set that team's handicap by hand for one game. By default it's still worked out from each player's index (WHS allowances, as before).

## Decisions (Eire, 25 Oct 2026)
- **Who:** the organiser of a day (`live_day_organiser`, 0174: whoever started it, or the society event's officers). For a round on its own, whoever set it up.
- **When:** before tee-off, and during the round. Once a score is in, the app asks the organiser to confirm, and the team's players get a `live_team_handicap` notification. Not after the round has finished.
- **No reason** is asked for.
- **Open and fair:** the worked-out figure is kept beside it, and the team is marked **Set by hand** everywhere it's shown — the way an amended result reads "Amended".
- Only that game changes. Members' own handicaps and the society's figures are never touched.

## How it's stored
- `live_rounds.team_handicap` stays the one figure everything scores from (cards, boards, results, TV, saved scorecards), so nothing downstream changed.
- New: `team_handicap_auto` (the worked-out figure while a hand-set one is in force; null = worked out), `team_handicap_set_by`, `team_handicap_set_at`.
- Written only by `live_round_set_team_handicap(p_round_id, p_handicap)`. Setting the worked-out figure clears the mark. Range +20 to 80 in the database; the app offers +10 to 54.
- A trigger pings the round's and day's realtime channels when `team_handicap` changes, so phones and the TV update at once.
- New days: the app creates the day with the worked-out figures, then calls the function for each hand-set team (`applyHandSetHandicaps`), so the worked-out figure is always recorded. If that call fails, the day still starts and the organiser is told where to set it.

## App
- **Set up a round → Scramble:** the "Team plays off" row has **Edit**; with a hand-set figure it shows the gold Set by hand badge, "Worked out from indexes: N" and **Reset to N**. **Foursomes** pairs: tap the pair's "Plays off" header (not in a foursomes match, which plays off the difference).
- **Scramble day:** each team's "Team plays off" strip opens the sheet; a summary line counts teams set by hand with **Reset all**. Changing a team's players drops its hand-set figure.
- **The draw (Groups & Societies):** under each drawn group, a "Team plays off" row (scramble) or one per pair (foursomes / greensomes). Swapping a player drops it. Only shown when starting now, not when saving a day for later or publishing tee times ahead — set it on the day.
- **The sheet** (`components/team-handicap-sheet.tsx`): how the worked-out figure is made, player by player; big − / + or type it (+2 for a plus team); **Team plays off N**; **Use the worked-out N**.
- **During the round:** the card's Leaderboard tab, Handicaps panel — "X plays off N", Set by hand + "Worked out N", and **Edit** for the organiser. Confirms first if scores are in.
- **Marked on:** the day leaderboard (badge + "worked out N" under the team, and a footnote), results detail line.

## Website
- Control room → a team's card (`/society/[id]/live/[outingId]/card/[roundId]`): a **Team handicap** / **Pair handicap** card with the figure, Set by hand / Worked out pill, and a form to set it or **Use the worked-out N** while live (`setTeamHandicap` action, same database function).
- TV board: the team's line reads "… · handicap set by hand (worked out N)"; plus figures show with a +.
- Website results: same detail line as the app.

## Verified
- Full replay of 189 migrations.
- RLS 1090/1090 — new `manual-team-handicap.test.ts` (6): organiser sets/resets, worked-out kept, plus figures; players and non-team rounds refused; single team by its creator only; no alert before scores, the team (not the organiser) after; finished and out-of-range refused; no direct writes. Function grants register updated.
- Unit: 2142 passed (new team handicap helpers: parse, label, step, breakdown for scramble/foursomes/greensomes; notification type registered).
- Website and app tsc clean; website eslint clean on changed files.

## To ship
1. ~~Apply `0189_manual_team_handicap.sql` to production~~ — done 25 Oct 2026 (it had to go before the app update: the app now selects `team_handicap_auto`).
2. Merge PR #348; Vercel deploys the website parts.
3. `git pull origin main`, then `cd mobile && eas update --branch production --platform ios` (JS only, no native build).

## Not done / later
- Not run on a phone yet.
- Saving a day ahead ("Save for <date>") and publishing tee times don't carry hand-set figures — they're set on the day, at the draw or from the card.
- Fourball / foursomes **matches** (matchplay) aren't included: they play off the difference between sides, not a team figure.
- The Home Screen widget and Follow my round don't show the Set by hand mark.
