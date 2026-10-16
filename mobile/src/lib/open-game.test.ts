import { describe, expect, it } from "vitest";

import { openGameFrom, openGamePath } from "./open-game";

describe("openGameFrom", () => {
  it("reads the game the database names", () => {
    expect(openGameFrom({ message: "Ciarán is already in a game", hint: "open-game:round:12" })).toEqual({ kind: "round", id: 12 });
    expect(openGameFrom({ hint: "open-game:day:4" })).toEqual({ kind: "day", id: 4 });
  });
  it("ignores every other error", () => {
    expect(openGameFrom(new Error("Network"))).toBeNull();
    expect(openGameFrom({ hint: "Something else" })).toBeNull();
    expect(openGameFrom({ hint: "open-game:round:abc" })).toBeNull();
    expect(openGameFrom(null)).toBeNull();
  });
  it("opens the right screen", () => {
    expect(openGamePath({ kind: "round", id: 12 })).toBe("/live/round/12");
    expect(openGamePath({ kind: "day", id: 4 })).toBe("/live/day/4");
  });
});
