/**
 * An event's totals for the console: who's in, what's collected and still
 * owed, and the meal counts. Pure: tested in events-totals.test.ts.
 *
 * Money follows the app (outing screen and society_money): a member counts
 * as paid once marked cash, transfer or card; "waived" owes nothing and
 * collects nothing; "refunded" belongs to someone who withdrew. A guest's
 * fee is the event's guest fee, or the entry fee when none is set.
 */

type Status = "cash" | "transfer" | "card" | "waived" | "refunded";

export type EventTotals = {
  entrants: number;
  guests: number;
  paid: number;
  waived: number;
  unpaid: number;
  claims: number;
  collectedCents: number;
  outstandingCents: number;
  meals: { meal: string; count: number }[];
  noMeal: number;
};

export function eventTotals(input: {
  entryFeeCents: number | null;
  guestFeeCents: number | null;
  mealOptions: readonly string[];
  entrants: readonly string[];
  guests: readonly number[];
  payments: ReadonlyMap<string, Status>;
  guestPayments: ReadonlyMap<number, Status>;
  claims: ReadonlyMap<string, unknown>;
  choices: ReadonlyMap<string, { meal: string | null; guestMeal: string | null }>;
}): EventTotals {
  const fee = input.entryFeeCents ?? 0;
  const guestFee = input.guestFeeCents ?? fee;
  let paid = 0;
  let waived = 0;
  let unpaid = 0;
  let claims = 0;
  let collected = 0;
  let outstanding = 0;
  for (const m of input.entrants) {
    const s = input.payments.get(m);
    if (s === "waived") waived++;
    else if (s && s !== "refunded") {
      paid++;
      collected += fee;
    } else {
      unpaid++;
      outstanding += fee;
      if (input.claims.has(m)) claims++;
    }
  }
  for (const g of input.guests) {
    const s = input.guestPayments.get(g);
    if (s === "waived") waived++;
    else if (s && s !== "refunded") {
      paid++;
      collected += guestFee;
    } else {
      unpaid++;
      outstanding += guestFee;
    }
  }
  const counts = new Map<string, number>(input.mealOptions.map((m) => [m, 0]));
  let noMeal = 0;
  for (const m of input.entrants) {
    const c = input.choices.get(m);
    if (c?.meal) counts.set(c.meal, (counts.get(c.meal) ?? 0) + 1);
    else noMeal++;
    if (c?.guestMeal) counts.set(c.guestMeal, (counts.get(c.guestMeal) ?? 0) + 1);
  }
  return {
    entrants: input.entrants.length,
    guests: input.guests.length,
    paid,
    waived,
    unpaid: fee > 0 || guestFee > 0 ? unpaid : 0,
    claims,
    collectedCents: collected,
    outstandingCents: outstanding,
    meals: [...counts.entries()].map(([meal, count]) => ({ meal, count })),
    noMeal: input.mealOptions.length ? noMeal : 0,
  };
}
