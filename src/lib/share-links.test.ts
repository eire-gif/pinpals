import { describe, expect, it } from "vitest";
import { signShareToken, verifyShareToken } from "./share-links";
import { buildShareCard, type ShareCardPost } from "./share-card";

const SECRET = "test-secret";
const AUTHOR = "00000000-0000-0000-0000-000000000001";
const OTHER = "00000000-0000-0000-0000-000000000002";

describe("share tokens", () => {
  it("round-trips a post and its sharer", () => {
    const token = signShareToken(42, AUTHOR, SECRET);
    expect(verifyShareToken(token, SECRET)).toEqual({ p: 42, s: AUTHOR, v: 1 });
  });

  it("refuses a tampered, re-signed or malformed token", () => {
    const token = signShareToken(42, AUTHOR, SECRET);
    const [payload, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ p: 43, s: AUTHOR, v: 1 })).toString("base64url");
    expect(verifyShareToken(`${forged}.${sig}`, SECRET)).toBeNull();
    expect(verifyShareToken(token, "another-secret")).toBeNull();
    expect(verifyShareToken(`${payload}`, SECRET)).toBeNull();
    expect(verifyShareToken("a.b.c", SECRET)).toBeNull();
    expect(verifyShareToken("", SECRET)).toBeNull();
  });
});

const base: ShareCardPost = {
  id: 7,
  authorId: AUTHOR,
  authorFirstName: "Niamh",
  kind: "round",
  details: { score: 78, course_par: 72, tee: "White", played_on: "2026-10-04", birdies: 3, gir: 8, putts: 29, fairways_hit: 9, fairways_total: 14 },
  clubId: 13,
  clubName: "Old Head Golf Links",
  hidden: false,
};

describe("buildShareCard", () => {
  it("a round shared by its author: course, score, relative to par, birdies, GIR, putts", () => {
    const card = buildShareCard(base, AUTHOR);
    expect(card.rich).toBe(true);
    expect(card.title).toBe("Old Head Golf Links");
    expect(card.hero).toEqual({ big: "78", small: "+6" });
    expect(card.stats).toEqual([
      { label: "Birdies", value: "3" },
      { label: "GIR", value: "8" },
      { label: "Putts", value: "29" },
      { label: "Fairways", value: "9/14" },
    ]);
    expect(card.subtitle).toBe("Niamh · White tees · 4 Oct 2026");
    expect(card.pageTitle).toBe("Niamh shot 78 (+6) at Old Head Golf Links");
    expect(card.photo).toBe(13 % 6);
  });

  it("anyone else sharing it gets a plain card — no name, course or score", () => {
    const card = buildShareCard(base, OTHER);
    expect(card.rich).toBe(false);
    expect(JSON.stringify(card)).not.toMatch(/Niamh|Old Head|78/);
  });

  it("a hidden or missing post is a plain card", () => {
    expect(buildShareCard({ ...base, hidden: true }, AUTHOR).rich).toBe(false);
    expect(buildShareCard(null, AUTHOR).rich).toBe(false);
  });

  it("a shot: course, hole, distance and club", () => {
    const card = buildShareCard(
      { ...base, kind: "shot", details: { hole: 18, club: "3 Wood", distance_yards: 245, lie: "fairway", result: "Eagle" } },
      AUTHOR
    );
    expect(card.kicker).toBe("SHOT");
    expect(card.hero).toEqual({ big: "245 yds", small: "3 Wood" });
    expect(card.stats).toEqual([
      { label: "Hole", value: "18" },
      { label: "From", value: "Fairway" },
      { label: "Result", value: "Eagle" },
    ]);
  });

  it("a hole names the score", () => {
    const card = buildShareCard({ ...base, kind: "hole", details: { hole: 7, par: 3, yards: 162, score: 1 } }, AUTHOR);
    expect(card.hero).toEqual({ big: "Hole 7", small: "Ace" });
  });

  it("a round without a par shows the score alone", () => {
    const card = buildShareCard({ ...base, details: { score: 81 } }, AUTHOR);
    expect(card.hero).toEqual({ big: "81", small: null });
    expect(card.stats).toEqual([]);
  });
});
