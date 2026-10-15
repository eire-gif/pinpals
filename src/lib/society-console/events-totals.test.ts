import { describe, expect, it } from "vitest";

import { eventTotals } from "./events-totals";

describe("eventTotals", () => {
  it("counts money and meals", () => {
    const t = eventTotals({
      entryFeeCents: 6000,
      guestFeeCents: 8000,
      mealOptions: ["Beef", "Salmon"],
      entrants: ["a", "b", "c", "d"],
      guests: [1, 2],
      payments: new Map([
        ["a", "cash"],
        ["b", "waived"],
        ["c", "card"],
      ]),
      guestPayments: new Map([[1, "transfer"]]),
      claims: new Map([["d", "revolut"]]),
      choices: new Map([
        ["a", { meal: "Beef", guestMeal: "Salmon" }],
        ["b", { meal: "Beef", guestMeal: null }],
      ]),
    });
    expect(t).toMatchObject({ entrants: 4, guests: 2, paid: 3, waived: 1, unpaid: 2, claims: 1, collectedCents: 6000 * 2 + 8000, outstandingCents: 6000 + 8000, noMeal: 2 });
    expect(t.meals).toEqual([
      { meal: "Beef", count: 2 },
      { meal: "Salmon", count: 1 },
    ]);
  });

  it("guests pay the entry fee when there's no guest fee, and a free event owes nothing", () => {
    const base = { mealOptions: [], entrants: ["a"], guests: [1], payments: new Map(), guestPayments: new Map(), claims: new Map(), choices: new Map() };
    expect(eventTotals({ ...base, entryFeeCents: 5000, guestFeeCents: null }).outstandingCents).toBe(10000);
    expect(eventTotals({ ...base, entryFeeCents: null, guestFeeCents: null }).unpaid).toBe(0);
  });
});
