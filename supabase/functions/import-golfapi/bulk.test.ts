import { describe, expect, it } from "vitest";

import { clubCost, decide, nameKey, searchName, type Located } from "./bulk";

const club = (id: string, km: number | null, courses = 1): Located => ({
  providerClubId: id,
  name: `Club ${id}`,
  town: null,
  lat: km == null ? null : 53.4,
  lng: km == null ? null : -6.1,
  km_away: km,
  courses: Array.from({ length: courses }, (_, i) => ({ providerCourseId: `${id}-c${i + 1}`, name: `Course ${i + 1}`, holes: 18, hasGps: true })),
});

describe("decide", () => {
  it("imports the one club within 2 km, all its courses", () => {
    const d = decide([club("a", 0.4, 2), club("b", 31)], true, "X");
    expect(d).toMatchObject({ kind: "import", candidate: { providerClubId: "a" }, courseIds: ["a-c1", "a-c2"] });
  });

  it("sends nothing found to review", () => {
    expect(decide([], true, "X")).toMatchObject({ kind: "review", reason: "not found on golfapi" });
  });

  it("won't guess when our club has no location", () => {
    expect(decide([club("a", 5)], false, "X")).toMatchObject({ kind: "review" });
  });

  it("won't take a match further than 2 km, and says how far", () => {
    const d = decide([club("a", 2.6)], true, "X");
    expect(d.kind).toBe("review");
    expect(d.kind === "review" && d.reason).toContain("2.6 km");
  });

  it("won't choose between two clubs that are both close", () => {
    expect(decide([club("a", 0.3), club("b", 1.9)], true, "X")).toMatchObject({ kind: "review", reason: "2 golfapi clubs within 2 km" });
  });

  it("leaves loop combinations to a person", () => {
    const d = decide([club("a", 0.2, 9)], true, "X");
    expect(d.kind).toBe("review");
    expect(d.kind === "review" && d.reason).toContain("9 courses");
  });

  it("reviews a club golfapi lists with no courses", () => {
    expect(decide([club("a", 0.2, 0)], true, "X")).toMatchObject({ kind: "review", reason: "golfapi lists no courses for this club" });
  });
});

// golfapi's search gives no location (seen 14 Oct 2026): the name decides.
const named = (id: string, name: string, courses = 1): Located => ({ ...club(id, null, courses), name });

describe("decide by name, when golfapi gives no location", () => {
  it("takes the one club with the same name — Grange, not Grange Castle", () => {
    const d = decide([named("gc", "Grange Castle Golf Club"), named("g", "Grange Golf Club", 3), named("gx", "Grange Castle")], true, "Grange Golf Club");
    expect(d).toMatchObject({ kind: "import", candidate: { providerClubId: "g" } });
  });

  it("matches without the generic words", () => {
    expect(decide([named("h", "Hermitage Golf Club")], true, "Hermitage GC")).toMatchObject({ kind: "import" });
    expect(decide([named("i", "The Island Golf Club")], false, "Island Golf Club")).toMatchObject({ kind: "import" });
  });

  it("won't take a merely similar name", () => {
    expect(decide([named("gc", "Grange Castle Golf Club")], true, "Grange Golf Club")).toMatchObject({ kind: "review" });
  });

  it("won't choose between two clubs of the same name", () => {
    expect(decide([named("a", "Castle Golf Club"), named("b", "Castle GC")], true, "Castle Golf Club")).toMatchObject({
      kind: "review",
      reason: "2 golfapi clubs with the same name",
    });
  });
});

describe("nameKey", () => {
  it("keeps what tells clubs apart", () => {
    expect(nameKey("Royal Dublin Golf Club")).toBe("royal dublin");
    expect(nameKey("Club de Golf La Moraleja")).toBe("moraleja");
    expect(nameKey("Elm Park Golf & Sports Club")).toBe("elm park sports");
  });
});

describe("clubCost", () => {
  it("is a tenth per search and one per course", () => {
    expect(clubCost(1, 1)).toBe(1.1);
    expect(clubCost(2, 3)).toBe(3.2);
    expect(clubCost(1, 0)).toBe(0.1);
  });
});

describe("searchName", () => {
  it("drops the generic words", () => {
    expect(searchName("Portmarnock Golf Club")).toBe("Portmarnock");
    expect(searchName("The Island Golf Club")).toBe("Island");
    expect(searchName("Golf Club")).toBe("Golf Club");
  });
});
