import { describe, expect, it } from "vitest";
import {
  PROFILE_TABS,
  achievementTally,
  chunk,
  dateBadge,
  identityTiles,
  isProfileTab,
  roundStats,
  sortCourses,
  toRoundRow,
  vsParLabel,
  type RoundRow,
} from "./profile-sections";

const base = { handicap: null, privateHandicap: null, coursesPlayed: 0, pinpals: null, postCount: 0 };

describe("identityTiles", () => {
  it("other readers see only what's shared — no dashes for the rest", () => {
    expect(identityTiles({ ...base, postCount: 3 }, false).map((t) => t.key)).toEqual(["posts"]);
    const all = identityTiles({ handicap: 8.4, privateHandicap: null, coursesPlayed: 12, pinpals: 31, postCount: 1 }, false);
    expect(all.map((t) => [t.key, t.value, t.label])).toEqual([
      ["handicap", "8.4", "Handicap"],
      ["courses", "12", "Courses"],
      ["pinpals", "31", "PinPals"],
      ["posts", "1", "Post"],
    ]);
  });

  it("a hidden handicap is never shown to others, and shown 'Only you' to its owner", () => {
    // privateHandicap is only ever filled for the owner, but even if it were
    // set, another reader gets no tile.
    expect(identityTiles({ ...base, privateHandicap: 12 }, false).some((t) => t.key === "handicap")).toBe(false);
    expect(identityTiles({ ...base, privateHandicap: 12 }, true)[0]).toEqual({ key: "handicap", label: "Handicap", value: "12", note: "Only you" });
  });

  it("the owner sees prompts for what's missing", () => {
    const tiles = identityTiles(base, true);
    expect(tiles.find((t) => t.key === "handicap")).toMatchObject({ value: "Add", empty: true });
    expect(tiles.find((t) => t.key === "courses")).toMatchObject({ value: "0", empty: true });
  });

  it("plus handicaps read as golfers write them; singulars are singular", () => {
    const tiles = identityTiles({ handicap: -1.2, privateHandicap: null, coursesPlayed: 1, pinpals: 1, postCount: 0 }, false);
    expect(tiles.map((t) => `${t.value} ${t.label}`)).toEqual(["+1.2 Handicap", "1 Course", "1 PinPal", "0 Posts"]);
  });

  it("no PinPals tile across a block (null)", () => {
    expect(identityTiles({ ...base, pinpals: null }, true).some((t) => t.key === "pinpals")).toBe(false);
    expect(identityTiles({ ...base, pinpals: 0 }, false).some((t) => t.key === "pinpals")).toBe(true);
  });
});

describe("rounds", () => {
  const row = (id: number, details: Record<string, unknown>, club = { id: 3, name: "Portmarnock" }) =>
    toRoundRow({ id, created_at: "2026-10-03T10:00:00Z", details, club })!;

  it("a round post becomes a row; no score, no row", () => {
    expect(row(1, { score: 78, course_par: 72, played_on: "2026-10-02", tee: "Blue", birdies: 3, achievement: "breaking_80" })).toEqual({
      postId: 1,
      date: "2026-10-02",
      course: "Portmarnock",
      clubId: 3,
      score: 78,
      holes: 18,
      coursePar: 72,
      vsPar: 6,
      tee: "Blue",
      birdies: 3,
      achievement: "breaking_80",
    });
    expect(toRoundRow({ id: 2, created_at: "2026-10-03T10:00:00Z", details: { holes: 18 }, club: null })).toBeNull();
    expect(toRoundRow({ id: 2, created_at: "2026-10-03T10:00:00Z", details: null, club: null })).toBeNull();
    expect(row(3, { score: 41, holes: 9 }).date).toBe("2026-10-03");
  });

  it("stats: best and average over full eighteens; average needs three", () => {
    const rows: RoundRow[] = [
      row(1, { score: 80, birdies: 1 }),
      row(2, { score: 76, birdies: 2 }, { id: 5, name: "The European Club" }),
      row(3, { score: 39, holes: 9, birdies: 1 }),
    ];
    expect(roundStats(rows)).toEqual({ rounds: 3, best: { score: 76, course: "The European Club" }, average: null, birdies: 4 });
    expect(roundStats([...rows, row(4, { score: 83 })]).average).toBe(79.7);
    expect(roundStats([])).toEqual({ rounds: 0, best: null, average: null, birdies: 0 });
  });

  it("labels", () => {
    expect([vsParLabel(0), vsParLabel(6), vsParLabel(-2), vsParLabel(null)]).toEqual(["E", "+6", "-2", null]);
    expect(dateBadge("2026-10-02")).toEqual({ day: "2", month: "Oct" });
  });
});

describe("achievementTally", () => {
  it("counts each earned achievement in the canonical order", () => {
    expect(
      achievementTally([
        { details: { achievement: "breaking_80" } },
        { details: { achievement: "hole_in_one" } },
        { details: { achievement: "breaking_80" } },
        { details: { achievement: "nonsense" } },
        { details: null },
      ]).map((t) => [t.title, t.count]),
    ).toEqual([
      ["Hole in One", 1],
      ["Broke 80", 2],
    ]);
  });
});

describe("courses and helpers", () => {
  it("home first, then the member's favourites, then A–Z", () => {
    const c = (name: string, rating: number | null, home = false) => ({ clubId: name.length, name, place: null, rating, home });
    expect(sortCourses([c("Adare", null), c("Lahinch", 4), c("Portmarnock", null, true), c("Ballybunion", 5), c("Carne", null)]).map((x) => x.name)).toEqual([
      "Portmarnock",
      "Ballybunion",
      "Lahinch",
      "Adare",
      "Carne",
    ]);
  });

  it("tabs and chunks", () => {
    expect(PROFILE_TABS).toEqual(["posts", "rounds", "courses", "highlights", "achievements"]);
    expect(isProfileTab("rounds")).toBe(true);
    expect(isProfileTab("likes")).toBe(false);
    expect(chunk([1, 2, 3, 4, 5], 3)).toEqual([[1, 2, 3], [4, 5]]);
  });
});
