import { describe, expect, it } from "vitest";

import { extraLabel, playerTees } from "./mixed-tees";

const WHITE = { name: "White", courseRating: 71.3, slope: 128, par: 72 };
const RED = { name: "Red", courseRating: 74.1, slope: 133, par: 74 };

describe("playerTees", () => {
  it("on the day's tees: the day's handicap, no adjustment", () => {
    expect(playerTees(18.4, WHITE, null, true)).toMatchObject({ courseHandicap: 20, estimated: false, teeName: null, extra: 0, indexUsed: 18.4 });
  });

  it("off other tees: their own rating, slope and par, plus the par difference", () => {
    // 18.4 × 133 / 113 + (74.1 − 74) = 21.76 → 22; reds are par 74 against 72: +2.
    expect(playerTees(18.4, WHITE, RED, true)).toMatchObject({ courseHandicap: 22, estimated: false, teeName: "Red", extra: 2 });
    expect(playerTees(18.4, WHITE, RED, true).exact).toBeCloseTo(21.7566, 4);
  });

  it("with the adjustment off: their own tees, no extra shots", () => {
    expect(playerTees(18.4, WHITE, RED, false).extra).toBe(0);
    expect(playerTees(18.4, WHITE, RED, false).teeName).toBe("Red");
  });

  it("a lower-par tee gives shots back", () => {
    expect(playerTees(10, RED, WHITE, true).extra).toBe(-2);
  });

  it("no par on file: no adjustment", () => {
    expect(playerTees(10, WHITE, { ...RED, par: null }, true).extra).toBe(0);
  });
});

describe("extraLabel", () => {
  it("says it plainly", () => {
    expect(extraLabel(2, "Red")).toBe("2 extra shots off the Red tees");
    expect(extraLabel(1, "Red")).toBe("1 extra shot off the Red tees");
    expect(extraLabel(-1, "Blue")).toBe("1 shot fewer off the Blue tees");
    expect(extraLabel(0, "Red")).toBeNull();
  });
});

import { cardForRatings, ladiesTees } from "./mixed-tees";

const cards = [
  { id: 1, teeName: "White", holes: 18 },
  { id: 2, teeName: "White (Women)", holes: 18 },
  { id: 3, teeName: "Red", holes: 18 },
  { id: 4, teeName: "Red (Women)", holes: 18 },
  { id: 5, teeName: "Yellow", holes: 18 },
];

describe("cardForRatings", () => {
  it("a woman on the reds plays off the women's card; a man off the men's", () => {
    expect(cardForRatings(cards[2], cards, "women").teeName).toBe("Red (Women)");
    expect(cardForRatings(cards[3], cards, "men").teeName).toBe("Red");
  });
  it("a woman on the whites plays off White (Women)", () => {
    expect(cardForRatings(cards[0], cards, "women").teeName).toBe("White (Women)");
  });
  it("no answer, or no women's card for that tee: the tee as picked", () => {
    expect(cardForRatings(cards[2], cards, null).teeName).toBe("Red");
    expect(cardForRatings(cards[4], cards, "women").teeName).toBe("Yellow");
  });
});

describe("ladiesTees", () => {
  it("Red (Women) first, never the day's own card", () => {
    expect(ladiesTees(cards, 1)?.teeName).toBe("Red (Women)");
    expect(ladiesTees(cards, 4)?.teeName).toBe("White (Women)");
    expect(ladiesTees([cards[0], cards[2]], 1)?.teeName).toBe("Red");
    expect(ladiesTees([cards[0]], 1)).toBeNull();
  });
});
