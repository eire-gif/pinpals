import { describe, expect, it } from "vitest";
import { draftDetailsProblem, draftToDetails, emptyDraft } from "./post-draft";

const today = "2026-10-04";

describe("draftToDetails", () => {
  it("a round: drops blanks, keeps zeros, only stores 9 holes when it was 9", () => {
    const d = { ...emptyDraft(today), score: "78", course_par: "72", tee: "White", putts: "31", gir: "0" };
    expect(draftToDetails("round", d)).toEqual({ score: 78, course_par: 72, tee: "White", played_on: today, putts: 31, gir: 0 });
    expect(draftToDetails("round", { ...d, holes: "9" })).toMatchObject({ holes: 9 });
  });

  it("a round's best hole only when one was given", () => {
    const d = { ...emptyDraft(today), score: "78" };
    expect(draftToDetails("round", d)).not.toHaveProperty("best_hole");
    expect(draftToDetails("round", { ...d, best_hole: "6", best_par: "4", best_score: "3" })).toMatchObject({
      best_hole: { hole: 6, par: 4, score: 3 },
    });
  });

  it("a hole and a shot", () => {
    expect(draftToDetails("hole", { ...emptyDraft(today), hole: "7", par: "3", yards: "162", hole_score: "1" })).toEqual({
      hole: 7, par: 3, yards: 162, score: 1,
    });
    expect(
      draftToDetails("shot", { ...emptyDraft(today), hole: "18", club: " 3 Wood ", distance_yards: "245", lie: "fairway", result: "Eagle" })
    ).toEqual({ hole: 18, club: "3 Wood", distance_yards: 245, lie: "fairway", result: "Eagle" });
  });

  it("general posts carry nothing", () => {
    expect(draftToDetails("general", { ...emptyDraft(today), score: "78" })).toBeNull();
  });
});

describe("draftDetailsProblem", () => {
  it("asks for what each kind needs", () => {
    expect(draftDetailsProblem("round", emptyDraft(today))).toMatch(/score/);
    expect(draftDetailsProblem("hole", emptyDraft(today))).toMatch(/Which hole/);
    expect(draftDetailsProblem("shot", emptyDraft(today))).toMatch(/club, the distance/);
    expect(draftDetailsProblem("general", emptyDraft(today))).toBeNull();
  });

  it("catches a half-typed best hole and a decimal score", () => {
    expect(draftDetailsProblem("round", { ...emptyDraft(today), score: "78", best_hole: "6" })).toMatch(/best hole/);
    expect(draftDetailsProblem("round", { ...emptyDraft(today), score: "78.5" })).toMatch(/score/);
  });
});
