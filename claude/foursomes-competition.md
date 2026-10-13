# Foursomes (Scotch foursomes) as a competition — Oct 2026

**Asked (Eire, 13 Oct 2026):** have we accounted for Scotch foursomes, and is it
the same as foursomes in the app? Yes, they're the same game: two players share
one ball, take alternate shots, and one partner tees off on the odd holes, the
other on the even holes. Until now the app only had it as a **match** (pair v
pair in a match day). Eire wanted it available as societies and clubs usually
run it too: **pairs on one leaderboard, Stableford or stroke play.**

## What members see

- **Start a Game → Foursomes** (tile now enabled, blurb "Scotch foursomes · pairs,
  alternate shot"). Then a *Foursomes scoring* choice:
  - **Stableford** / **Stroke play**: 2 players = one pair (a round);
    4 players = two pairs, 1 & 2 and 3 & 4, on one leaderboard (a small day).
  - **Matchplay**: 4 players, 1 & 2 v 3 & 4 (a one-match match day).
  Players are shown under *Pair 1* / *Pair 2* headers with "Plays off N".
- **From a Group → Foursomes Stableford / Foursomes stroke play** (two new
  format tiles). The draw makes tee groups of two pairs (seats 1 & 2, 3 & 4,
  coloured), and a group of one pair if the pairs are odd. One player left over
  must be fixed (guest or untick). Balanced draw puts the best with the highest
  and the middle two together, as for pairs matches.
- The matchplay *Foursomes* pill now says "Scotch foursomes: pairs, alternate shot".
- **On the card:** one score per pair; under the pair's name, "<name> tees off"
  for the hole (first player on odd holes, partner on even). Shown for foursomes
  matches too. No "Whose drive?" picker for foursomes.
- **Leaderboard (day):** Stableford pairs rank on **points** (with net alongside);
  stroke play on net / gross as for scrambles. Hub tag "Foursomes", "n pairs".
- Notifications, the Home Screen widget and the in-app guides all say foursomes.

## Handicaps (WHS)

The pair plays off **50% of the combined course handicaps, rounded once**
(`foursomesHandicap` in `live-scoring.ts`), e.g. 9 + 18 = 27 → 13.5 → 14. The
foursomes match uses the same function, so the figure is identical in both.

## How it's stored (migration 0136)

A foursomes pair is a 2-person team round, exactly like a scramble pair, so
everything built for teams (visibility, who scores, realtime, delete, calendar,
highlights) carries over. One new column says it's foursomes and how it's ranked:

- `live_rounds.foursomes_scoring` — `'stableford' | 'stroke' | null`
  (check `live_rounds_foursomes_is_a_pair`: only with `scramble_size = 2`, no drives)
- `live_match_days.foursomes_scoring` — same, on a `kind = 'scramble'` day

`format` stays `'stroke'` on the round (the 0113 check requires it for every team
round, and changing it would need a drop). The app maps a foursomes round's
format to its scoring, so the Stableford views work unchanged.

RPCs: `live_round_create` accepts `format: 'foursomes'` with `scoring`;
`live_scramble_day_create` accepts `foursomes_scoring` (forces size 2, no drives,
allowance 0.5, default name "Pair n"). No drop statements — safe for the
Supabase tool. Tests: `supabase/tests/rls/foursomes-competition.test.ts`,
`src/lib/live-scoring.test.ts` (foursomes block).

## Order to ship

1. Apply 0136 to production **before** the app update — the app now selects
   `foursomes_scoring`, and older builds don't, so the migration first is safe.
2. Merge the PR (website deploys via Vercel).
3. `eas update` — JS only, no native change.
