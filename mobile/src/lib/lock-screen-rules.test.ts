import { describe, expect, it } from "vitest";

import { lockScreenHole, lockScreenStrokes, positionLine } from "./lock-screen-rules";

const card = Array.from({ length: 18 }, (_, i) => ({ hole: i + 1 }));

describe("lockScreenStrokes", () => {
  it("sends picked up as 0 and keys holes as strings", () => {
    expect(lockScreenStrokes(new Map([[1, 5], [2, null], [3, 4]]))).toEqual({ "1": 5, "2": 0, "3": 4 });
  });
});

describe("lockScreenHole", () => {
  it("shows the first hole with no score", () => {
    expect(lockScreenHole(card, new Map())).toBe(1);
    expect(lockScreenHole(card, new Map([[1, 4], [2, 5], [4, 3]]))).toBe(3);
  });
  it("counts picked up as scored", () => {
    expect(lockScreenHole(card, new Map([[1, null]]))).toBe(2);
  });
  it("follows the card's own order, e.g. a round starting on the 10th", () => {
    const back = [10, 11, 12, 1, 2].map((hole) => ({ hole }));
    expect(lockScreenHole(back, new Map([[10, 4]]))).toBe(11);
  });
  it("stays on the last hole once everything is in", () => {
    expect(lockScreenHole(card, new Map(card.map((h) => [h.hole, 4])))).toBe(18);
  });
});

describe("positionLine", () => {
  it("reads naturally", () => {
    expect(positionLine("1", 4)).toBe("1st of 4");
    expect(positionLine("2", 4)).toBe("2nd of 4");
    expect(positionLine("3", 4)).toBe("3rd of 4");
    expect(positionLine("T2", 4)).toBe("Joint 2nd of 4");
    expect(positionLine("11", 12)).toBe("11th of 12");
  });
  it("says nothing before anyone has a position, or playing alone", () => {
    expect(positionLine("", 4)).toBeNull();
    expect(positionLine("1", 1)).toBeNull();
  });
});
