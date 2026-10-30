# Rivalries (30 Oct 2026, no migration)

**Asked (Eire, 30 Oct 2026):** build Rivalries from the *PinPals Next Ideas*
canvas. Decided: **only rounds against each other count** — a match on
opposite sides, or your own balls in the same group; never partners.

## Rules (`mobile/src/lib/rivalry-rules.ts`, 10 tests)

- Finished live rounds only, and never a team card (scramble team,
  foursomes/greensomes pair card).
- **A match** (singles, fourball, foursomes, greensomes — Match Day Fun, a
  Ryder Cup session) with you on opposite sides: the match's own result
  (`teamMatchState`), so a fourball counts against both players opposite.
  Same side = partners = nothing.
- **Own balls in the same group** (Stableford, stroke play, a society day's
  tee group): a singles match between the two of you, net off your course
  handicaps (the higher gets the difference), stopped once decided, as
  matchplay. Needs both to have finished enough holes for a result.
- Rivals are members (by id) or guests (by name, "(guest)" stripped).
- Record won–lost–halved; season = calendar year; best wins by holes up then
  holes left; run = the current streak.

## App

- `app/rivals/index.tsx` — Your rivals: biggest rivalry on top with the last
  five, everyone else, and a gold card for a guest played twice or more
  (Send the record: the guest scorecard link with the record line).
- `app/rivals/[key].tsx` — Head to head: this season / all time, best wins,
  run, every round against each other (tap opens the round), Rematch → Post
  a tee time.
- Profile → Your rivals. Feature flag `rivalries`. Guide step in "Your
  passport, rivals, leaderboards and year".
- Loaded on the phone (`lib/rivalries.ts`): the member's finished rounds of
  the last two years (240 at most), scores fetched 6 rounds a request to stay
  under the API's 1,000-row cap; cached a minute between the two screens.

## Not done

- The "Next: Sat 8:40 … you give Dave 3 shots" line from the mock-up
  (needs the shared upcoming tee time).
- Head-to-head on a member's page; the website.
