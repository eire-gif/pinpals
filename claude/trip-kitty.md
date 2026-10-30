# The trip kitty (30 Oct 2026, migration 0202)

**Asked (Eire, 30 Oct 2026):** build the trip kitty from the *PinPals Next
Ideas* canvas (row 3).

- On an overnight/abroad trip's Itinerary: **The kitty** card (what's been
  spent). Screens: `app/group/[id]/kitty/[outingId].tsx` (spent, you're
  owed/you owe, every expense), `kitty/add.tsx` (add or change: what, how
  much, category, who paid, split between — everyone going by default),
  `kitty/settle/[outingId].tsx` (the fewest payments, yours first, Mark as
  paid, PAID list with Undo, Share to the chat).
- **Data (0202):** `trip_kitty_expenses`, `trip_kitty_shares` (equal split),
  `trip_kitty_payments` (money paid back — a payment moves the balances, so
  a ticked one drops off the settle-up list). RPCs `trip_kitty_save`,
  `trip_kitty_delete`, `trip_kitty_pay`, `trip_kitty_unpay`. Group members
  read and add; change/delete by whoever added it, whoever paid, or whoever
  runs the trip; payments ticked/undone by either person or the organiser.
- **Rules:** `mobile/src/lib/kitty-rules.ts` — equal split, odd cents to the
  first in the people's order; balances add to zero; settle-up biggest debt
  to biggest credit. Tests: `kitty-rules.test.ts`, RLS `trip-kitty.test.ts`.
- "Going" = the trip's entries, or the whole group if nobody has entered.
- PinPals never holds the money. Feature flag `tripKitty`. Guide step in
  "Run an event / Plan the trip".

## Not done

- Uneven splits (by amount), currencies other than euro, receipts/photos,
  pushing a notification when someone adds an expense, side-game winnings
  feeding in.
