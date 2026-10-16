# One open game per player (0157) — 16 Oct 2026

Two people on the same tee time could both tap **Start live scoring** and get
two games with the same players. Now a PinPals member can be a player in only
**one open game** at a time — any kind of game (round, scramble, foursomes,
match day, group day).

- **Open game** = a live round started in the last 8 hours. A round someone
  forgot to finish stops counting after that.
- **Database** (`0157_one_open_game.sql`): a trigger on `live_round_players`
  refuses a second open game for a member; nothing is created. A single
  transaction lock on every game start stops two phones racing each other.
  The error names the game in its hint: `open-game:round:<id>` / `open-game:day:<id>`.
  The same match day can hold one member in several of its matches.
  Guests by name are never checked.
- **App**: the start screens read the hint and offer **Open the game**
  (`mobile/src/lib/open-game.ts`, `open-game-alert.ts`). The tee time's button
  becomes **Open the live game** once you're in one (`my_open_live_game()`),
  and the new-game screen shows a banner. Everyone added already gets the
  "You're scoring with…" alert that opens the game.
- **Tests**: RLS `one-open-game.test.ts` (race, match day, guests, finished,
  8-hour window); existing tests that start several rounds with the same
  player age the earlier ones first. Unit `open-game.test.ts`.
