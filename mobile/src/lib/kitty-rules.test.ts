import { describe, expect, it } from "vitest";

import { kittyBalances, kittyEuros, kittyTotals, parseKittyAmount, settleKitty, splitShares } from "./kitty-rules";

const EIGHT = ["eire", "dave", "ciaran", "niall", "mark", "paul", "tom", "barry"];
const total = (m: ReadonlyMap<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

describe("the kitty", () => {
  it("splits equally, odd cents to the first", () => {
    expect([...splitShares(1000, ["a", "b", "c"]).values()]).toEqual([334, 333, 333]);
    expect(splitShares(1000, []).size).toBe(0);
  });

  it("the mock-up: four expenses, eight going, buggies for four", () => {
    const expenses = [
      { id: 1, amountCents: 128000, paidBy: "dave", shares: EIGHT },
      { id: 2, amountCents: 9600, paidBy: "ciaran", shares: EIGHT },
      { id: 3, amountCents: 64000, paidBy: "eire", shares: EIGHT },
      { id: 4, amountCents: 24000, paidBy: "niall", shares: ["niall", "dave", "mark", "tom"] },
    ];
    const bal = kittyBalances(expenses, []);
    expect(bal.get("eire")).toBe(38800);
    expect(bal.get("dave")).toBe(96800);
    expect(bal.get("mark")).toBe(-31200);
    expect(total(bal)).toBe(0);
    const pay = settleKitty(bal);
    expect(pay).toHaveLength(7);
    // Squares everyone.
    const after = new Map(bal);
    for (const p of pay) {
      after.set(p.from, (after.get(p.from) ?? 0) + p.cents);
      after.set(p.to, (after.get(p.to) ?? 0) - p.cents);
    }
    expect([...after.values()].every((c) => c === 0)).toBe(true);
    expect(kittyTotals(expenses, "eire")).toEqual({ spent: 225600, myShare: 25200 });
  });

  it("a payment ticked off moves the balances", () => {
    const bal = kittyBalances([{ id: 1, amountCents: 10000, paidBy: "a", shares: ["a", "b"] }], [{ id: 1, from: "b", to: "a", amountCents: 5000 }]);
    expect(Object.fromEntries(bal)).toEqual({ a: 0, b: 0 });
    expect(settleKitty(bal)).toEqual([]);
  });

  it("reads and writes euro amounts", () => {
    expect(parseKittyAmount("1,280")).toBe(128000);
    expect(parseKittyAmount("€12.50")).toBe(1250);
    expect(parseKittyAmount("12,50")).toBe(1250);
    expect(parseKittyAmount("0")).toBeNull();
    expect(parseKittyAmount("abc")).toBeNull();
    expect(kittyEuros(128000)).toBe("€1,280");
    expect(kittyEuros(1250)).toBe("€12.50");
    expect(kittyEuros(-500)).toBe("−€5");
  });
});
