import { describe, expect, it } from "vitest";
import { summarizeBalance } from "./balance";

describe("summarizeBalance", () => {
  it("sums cents to euros for both available and pending", () => {
    expect(
      summarizeBalance({
        available: [{ amount: 12345, currency: "eur", source_types: {} } as never],
        pending: [{ amount: 500, currency: "eur", source_types: {} } as never],
      })
    ).toEqual({ availableEur: 123.45, pendingEur: 5 });
  });

  it("sums multiple entries in the same array", () => {
    expect(
      summarizeBalance({
        available: [
          { amount: 1000, currency: "eur", source_types: {} } as never,
          { amount: 2000, currency: "eur", source_types: {} } as never,
        ],
        pending: [],
      })
    ).toEqual({ availableEur: 30, pendingEur: 0 });
  });

  it("returns zero for an empty balance", () => {
    expect(summarizeBalance({ available: [], pending: [] })).toEqual({ availableEur: 0, pendingEur: 0 });
  });
});
