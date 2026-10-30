
## Skins, Wolf and Nassau (30 Oct 2026, migration 0201)

Asked by Eire from the *PinPals Next Ideas* canvas. Same scoring basis
(Stableford points off each player's own handicap), same money rules
(PinPals keeps the tally; everyone says I'm in; no money with a minor).

- **Skins** (`skins` carry | void, `stake_skins` a skin): the one player
  with the most points on a hole wins it plus any carried; a skin is worth
  the amount from every other player. Won in hole order only.
- **Wolf** (`wolf`, `stake_wolf` a point; exactly four players): the Wolf is
  the hole's player in turn by playing order. Partner: better ball two v two,
  each winner +1 and each loser −1. Lone Wolf: ±2 against each of the three.
  Picks in `live_round_wolf_picks` via `live_round_wolf_pick(round, hole,
  partner|null)` — any member playing or the starter, while live. A hole
  with no pick doesn't count.
- **Nassau** (`nassau`, `stake_nassau` a bet): every two players play front,
  back and the 18 on holes won; whoever goes 2 down presses automatically (a
  new bet to the end of that bet). Each finished bet moves the amount.
- `lib/side-games-extra.ts` scores them and `sideSummary()` totals every
  game (money and points) for the screen, the scorecard row and settle-up.
- 0201 drops and re-adds the "at least one game" check (the Supabase tool
  will ask to confirm).
