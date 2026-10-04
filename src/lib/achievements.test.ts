import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACHIEVEMENTS, ACHIEVEMENT_INFO, achievementOf, achievementProblem, eligibleAchievements } from "./achievements";

describe("achievements.ts", () => {
  it("is byte-identical in the website and the app", () => {
    const site = readFileSync(join(process.cwd(), "src/lib/achievements.ts"), "utf8");
    const app = readFileSync(join(process.cwd(), "mobile/src/lib/achievements.ts"), "utf8");
    expect(app).toBe(site);
  });

  it("covers the seven achievements", () => {
    expect(ACHIEVEMENTS.map((a) => ACHIEVEMENT_INFO[a].title)).toEqual([
      "Hole in One", "Eagle", "Personal Best", "Broke 70", "Broke 80", "Broke 90", "Broke 100",
    ]);
  });
});

describe("eligibleAchievements", () => {
  it("a hole: an ace, or two under par", () => {
    expect(eligibleAchievements("hole", { hole: 7, par: 3, score: 1 })).toEqual(["hole_in_one"]);
    expect(eligibleAchievements("hole", { hole: 18, par: 5, score: 3 })).toEqual(["eagle"]);
    expect(eligibleAchievements("hole", { hole: 4, par: 4, score: 3 })).toEqual([]);
    expect(eligibleAchievements("hole", { hole: 4, score: 3 })).toEqual([]);
  });

  it("a full round: personal best and each threshold beaten, lowest first", () => {
    expect(eligibleAchievements("round", { score: 78 })).toEqual(["personal_best", "breaking_80", "breaking_90", "breaking_100"]);
    expect(eligibleAchievements("round", { score: 69 })).toEqual(["personal_best", "breaking_70", "breaking_80", "breaking_90", "breaking_100"]);
    expect(eligibleAchievements("round", { score: 104 })).toEqual(["personal_best"]);
  });

  it("a 9-hole round breaks nothing; a best hole can be an ace", () => {
    expect(eligibleAchievements("round", { score: 38, holes: 9 })).toEqual([]);
    expect(eligibleAchievements("round", { score: 84, best_hole: { hole: 11, par: 3, score: 1 } })).toEqual([
      "hole_in_one", "personal_best", "breaking_90", "breaking_100",
    ]);
  });

  it("shots and general posts carry none", () => {
    expect(eligibleAchievements("shot", { club: "Driver" })).toEqual([]);
    expect(eligibleAchievements("general", null)).toEqual([]);
  });
});

describe("achievementProblem", () => {
  it("allows a supported claim, refuses an unsupported or unknown one", () => {
    expect(achievementProblem("round", { score: 88, achievement: "breaking_90" })).toBeNull();
    expect(achievementProblem("round", { score: 92, achievement: "breaking_90" })).toMatch(/broke 90/);
    expect(achievementProblem("hole", { hole: 7, par: 3, score: 2, achievement: "hole_in_one" })).toMatch(/hole in one/);
    expect(achievementProblem("round", { score: 80, achievement: "albatross" })).toMatch(/recognised/);
    expect(achievementProblem("round", { score: 80 })).toBeNull();
  });
});

describe("achievementOf", () => {
  it("builds the structure for a hole in one", () => {
    expect(
      achievementOf({
        kind: "hole",
        details: { hole: 7, par: 3, yards: 162, score: 1, club: "7 Iron", achievement: "hole_in_one" },
        courseName: "Royal County Down",
        createdAt: "2026-10-04T12:00:00Z",
      })
    ).toEqual({
      achievementType: "hole_in_one",
      achievementTitle: "Hole in One",
      tagline: "One swing. In the cup.",
      icon: "flag",
      course: "Royal County Down",
      hole: 7,
      club: "7 Iron",
      distance: 162,
      score: "Ace",
      date: "2026-10-04",
      stats: [
        { label: "Par", value: "3" },
        { label: "Yards", value: "162" },
        { label: "Club", value: "7 Iron" },
      ],
    });
  });

  it("builds a personal best round", () => {
    const a = achievementOf({
      kind: "round",
      details: { score: 78, course_par: 72, birdies: 3, gir: 8, putts: 29, played_on: "2026-10-03", longest_drive: 285, achievement: "personal_best" },
      courseName: "Portmarnock Golf Club",
    });
    expect(a).toMatchObject({ achievementTitle: "Personal Best", score: "78 (+6)", date: "2026-10-03", distance: 285, hole: null });
    expect(a?.stats).toEqual([
      { label: "Birdies", value: "3" },
      { label: "GIR", value: "8" },
      { label: "Putts", value: "29" },
    ]);
  });

  it("is null without a claim, or with one the numbers don't support", () => {
    expect(achievementOf({ kind: "round", details: { score: 78 }, courseName: null })).toBeNull();
    expect(achievementOf({ kind: "round", details: { score: 95, achievement: "breaking_90" }, courseName: null })).toBeNull();
  });
});
