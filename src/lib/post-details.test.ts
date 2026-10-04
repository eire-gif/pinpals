import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  POST_TYPES,
  POST_TYPE_INFO,
  cleanDetails,
  detailChips,
  detailsProblem,
  menuPostTypes,
  roundScoreLabel,
  scoreName,
} from "./post-details";

describe("post-details.ts", () => {
  it("is byte-identical in the website and the app", () => {
    const site = readFileSync(join(process.cwd(), "src/lib/post-details.ts"), "utf8");
    const app = readFileSync(join(process.cwd(), "mobile/src/lib/post-details.ts"), "utf8");
    expect(app).toBe(site);
  });
});

describe("post types", () => {
  it("offers all six, in order, and maps each to a stored kind or a hand-off", () => {
    expect(menuPostTypes()).toEqual(["general", "round", "hole", "shot", "photo", "tee_time"]);
    expect(POST_TYPES.map((t) => POST_TYPE_INFO[t].kind)).toEqual(["general", "round", "hole", "shot", "general", null]);
  });
});

describe("detailsProblem", () => {
  it("general posts carry nothing", () => {
    expect(detailsProblem("general", null)).toBeNull();
    expect(detailsProblem("general", undefined)).toBeNull();
    expect(detailsProblem("general", { score: 80 })).toMatch(/no golf details/);
  });

  it("a round needs a score and accepts the full set", () => {
    expect(detailsProblem("round", {})).toMatch(/score/);
    expect(detailsProblem("round", { score: 81 })).toBeNull();
    expect(
      detailsProblem("round", {
        score: 78, holes: 18, course_par: 72, tee: "White", played_on: "2026-10-04", differential: 6.3,
        fairways_hit: 8, fairways_total: 14, gir: 7, putts: 31, birdies: 3, best_hole: { hole: 6, par: 4, score: 3 },
      })
    ).toBeNull();
    expect(detailsProblem("round", { score: 78, birdies: 19 })).toMatch(/birdie/);
  });

  it("a recap's nines, drive and tee time (0099)", () => {
    expect(detailsProblem("round", { score: 78, front_nine: 38, back_nine: 40, longest_drive: 285, tee_time_id: 12 })).toBeNull();
    expect(detailsProblem("round", { score: 78, front_nine: 38, back_nine: 41 })).toMatch(/add up/);
    expect(detailsProblem("round", { score: 40, holes: 9, front_nine: 40, back_nine: 41 })).toBeNull();
    expect(detailsProblem("round", { score: 78, longest_drive: 900 })).toMatch(/drive/);
    expect(detailsProblem("round", { score: 78, tee_time_id: 0 })).toMatch(/round/);
    expect(detailChips({ kind: "round", details: { score: 78, front_nine: 38, back_nine: 40, longest_drive: 285 } })).toEqual([
      "78", "Front 38 · Back 40", "285 yd drive",
    ]);
  });

  it("refuses nonsense in a round", () => {
    expect(detailsProblem("round", { score: 12 })).toMatch(/score/);
    expect(detailsProblem("round", { score: 78.5 })).toMatch(/score/);
    expect(detailsProblem("round", { score: 78, holes: 12 })).toMatch(/9 or 18/);
    expect(detailsProblem("round", { score: 78, played_on: "2026-02-30" })).toMatch(/date/);
    expect(detailsProblem("round", { score: 78, fairways_hit: 9, fairways_total: 7 })).toMatch(/more than/);
    expect(detailsProblem("round", { score: 78, gir: 19 })).toMatch(/0 to 18/);
    expect(detailsProblem("round", { score: 78, best_hole: { hole: 6 } })).toMatch(/best hole/);
    expect(detailsProblem("round", { score: 78, map: [] })).toMatch(/update the app/);
  });

  it("a hole needs its number", () => {
    expect(detailsProblem("hole", { par: 3 })).toMatch(/Which hole/);
    expect(detailsProblem("hole", { hole: 7, par: 3, yards: 162, score: 1 })).toBeNull();
    expect(detailsProblem("hole", { hole: 7, par: 7 })).toMatch(/par 3, 4, 5 or 6/);
  });

  it("a shot needs a club, a distance or a result", () => {
    expect(detailsProblem("shot", { hole: 7 })).toMatch(/club, the distance/);
    expect(detailsProblem("shot", { club: "7 Iron" })).toBeNull();
    expect(detailsProblem("shot", { hole: 18, shot_number: 2, club: "3 Wood", distance_yards: 245, lie: "fairway", result: "Eagle" })).toBeNull();
    expect(detailsProblem("shot", { club: "7 Iron", lie: "car park" })).toMatch(/lying/);
  });
});

describe("cleanDetails", () => {
  it("drops blanks, trims text and keeps zeros", () => {
    expect(cleanDetails({ score: 78, tee: "  ", putts: 0, gir: undefined, club: " Driver ", x: Number.NaN })).toEqual({
      score: 78,
      putts: 0,
      club: "Driver",
    });
  });
});

describe("words", () => {
  it("names scores", () => {
    expect(scoreName(1, 3)).toBe("Ace");
    expect(scoreName(1, undefined)).toBe("Ace");
    expect(scoreName(3, 5)).toBe("Eagle");
    expect(scoreName(3, 4)).toBe("Birdie");
    expect(scoreName(4, 4)).toBe("Par");
    expect(scoreName(6, 4)).toBe("Double bogey");
    expect(scoreName(9, 4)).toBe("+5");
    expect(scoreName(4, undefined)).toBeNull();
  });

  it("writes a round against par", () => {
    expect(roundScoreLabel(78, 72)).toBe("78 (+6)");
    expect(roundScoreLabel(70, 72)).toBe("70 (-2)");
    expect(roundScoreLabel(72, 72)).toBe("72 (E)");
    expect(roundScoreLabel(81, undefined)).toBe("81");
  });

  it("builds chips per kind", () => {
    expect(detailChips({ kind: "general", details: null })).toEqual([]);
    expect(detailChips({ kind: "hole", details: { hole: 7, par: 3, yards: 162, score: 1 } })).toEqual([
      "Hole 7", "Par 3", "162 yds", "Ace",
    ]);
    expect(
      detailChips({ kind: "round", details: { score: 78, course_par: 72, tee: "White", fairways_hit: 8, fairways_total: 14, birdies: 2, gir: 7, putts: 31, best_hole: { hole: 6, par: 4, score: 3 } } })
    ).toEqual(["78 (+6)", "White tees", "8/14 fairways", "2 birdies", "7 GIR", "31 putts", "Best: 6 · Birdie"]);
    expect(detailChips({ kind: "shot", details: { hole: 18, club: "3 Wood", distance_yards: 245, lie: "fairway", result: "Eagle" } })).toEqual([
      "Hole 18", "3 Wood", "245 yds", "From the fairway", "Eagle",
    ]);
  });
});
