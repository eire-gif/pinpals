# WHS handicaps — Golf Ireland accuracy + handicap calculator (26 Oct 2026)

## Why
Tested PinPals against Golf Ireland's own WHS Course Handicap calculator
(The Links Portmarnock, index 15.6, every tee it lists). 18-hole course
handicaps matched; two things didn't:

1. **Double rounding.** PinPals rounded the course handicap, then took the
   allowance. WHS Rule 6.2a/1: the allowance goes on the *unrounded* course
   handicap, rounded once. Men's Green: 16.357 × 95% = 15.54 → **16**;
   PinPals gave 16 × 95% = 15.2 → 15. Out by a shot in ~23% of cases at any
   allowance; foursomes ~27%, greensomes ~17%.
2. **9 holes.** WHS Rule 6.1b: half the index, rounded to one decimal, with
   the nine's own rating, slope and par. PinPals used the full index (Blue B9
   showed 20, Golf Ireland 11), and switching an 18-hole tee to 9 holes kept
   the 18-hole rating against par 36 (~58).

Also found: `Math.floor(x + 0.5)` on doubles can turn an exact .5 into
.4999… (index 0.2, CR 72.3, slope 113, par 72 = 0.5 exactly → gave 0).

## What changed
- `live-scoring.ts` (site + app, byte-identical): `courseHandicap` returns
  `exact` and `indexUsed` and takes `holes`; `nineHoleIndex`; float-safe
  `roundHalfUp`; `playingHandicap` takes the CourseHandicap (or an exact
  number); `SINGLES_ALLOWANCE_CHOICES` (Golf Ireland 2025: 100/95/90/85%);
  `exactLabel`.
- Every stroke-play/Stableford call site and every pair/team figure
  (foursomes, greensomes, scramble — app set-up, group draw, scramble day,
  web society console) now works from exact course handicaps.
- **Match play is unchanged on purpose**: it uses the stored whole-number
  course handicap (Golf GB&I: four-ball match play uses rounded course
  handicaps; singles is the full difference). Stored `course_handicap`
  stays smallint — no migration.
- Course set-up: switching a saved 18-hole tee to 9 holes clears rating and
  slope and asks for the nine's own; a 9-hole rating on 18 holes (or the
  other way) blocks Tee off. Scorecard entry won't use a tee's ratings for a
  different number of holes (falls back to estimated).
- New **Handicap calculator** (`app/handicap.tsx`, Menu → Play): Course
  lookup (men's/women's from the member's ratings choice, 18/9 holes) or
  Enter manually; allowance 100/95/90/85; tap a tee for the breakdown.
- **How it's worked out** sheet (`components/handicap-breakdown.tsx`): tap a
  plays-off figure on Start a Round, or a tee in the calculator.
- **Your handicap here** card on course pages (`components/course-handicap-card.tsx`).
- **Handicap allowance** choice on Start a Round for Stableford/stroke play;
  stored as the round's `allowance` as before.
- Guides: new "Check your handicap"; Score a game live steps updated.

## Tests
`live-scoring.test.ts`: all 18 Golf Ireland figures (men's/women's, 18 and
each nine), 95% rounding-once case, the float trap, and an exact-integer
reference sweep over every index −10.0…54.0 × 18 tees × 4 allowances.
`handicap-calculator.test.ts` for the calculator logic. 2,174 unit tests pass.

## Open
- Plus handicaps at exactly .5: JS rounds −2.5 → −2, Postgres `round()` in
  the handicap-indicator SQL gives −3. The published rules reached don't say
  which; confirm with Golf Ireland before changing either.
- Course data: golfapi cards are 18-hole; front/back-nine ratings per tee
  would make 9-hole lookup work everywhere (manual entry covers it now).
- Mixed-tee par difference is still added after the allowance (unchanged).
