import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_REACTION, REACTIONS, REACTION_INFO, applyReaction, isReaction, normaliseCounts, topReactions } from "./reactions";

describe("reactions.ts", () => {
  it("is byte-identical in the website and the app", () => {
    const site = readFileSync(join(process.cwd(), "src/lib/reactions.ts"), "utf8");
    const app = readFileSync(join(process.cwd(), "mobile/src/lib/reactions.ts"), "utf8");
    expect(app).toBe(site);
  });

  it("offers the five golf reactions, Great Shot first and by default", () => {
    expect(REACTIONS.map((r) => REACTION_INFO[r].label)).toEqual(["Great Shot", "On Fire", "Nice Round", "Amazing", "Unlucky"]);
    expect(DEFAULT_REACTION).toBe("great_shot");
    expect(isReaction("on_fire")).toBe(true);
    expect(isReaction("like")).toBe(false);
  });
});

describe("normaliseCounts", () => {
  it("keeps known positive counts", () => {
    expect(normaliseCounts({ on_fire: 3, great_shot: 1, like: 9, unlucky: 0, amazing: -2 }, 4)).toEqual({ on_fire: 3, great_shot: 1 });
  });
  it("credits a post with no breakdown (pre-0096) to the default", () => {
    expect(normaliseCounts(null, 5)).toEqual({ great_shot: 5 });
    expect(normaliseCounts({}, 0)).toEqual({});
  });
});

describe("topReactions", () => {
  it("most used first, ties in reaction order, at most three", () => {
    expect(topReactions({ unlucky: 2, on_fire: 5, great_shot: 2, amazing: 1 })).toEqual(["on_fire", "great_shot", "unlucky"]);
    expect(topReactions({})).toEqual([]);
  });
});

describe("applyReaction", () => {
  it("adds, changes and removes", () => {
    expect(applyReaction({}, 0, null, "on_fire")).toEqual({ counts: { on_fire: 1 }, total: 1 });
    expect(applyReaction({ on_fire: 1, great_shot: 2 }, 3, "on_fire", "great_shot")).toEqual({ counts: { great_shot: 3 }, total: 3 });
    expect(applyReaction({ great_shot: 3 }, 3, "great_shot", null)).toEqual({ counts: { great_shot: 2 }, total: 2 });
  });
  it("is a no-op for the same reaction and never goes negative", () => {
    expect(applyReaction({ amazing: 1 }, 1, "amazing", "amazing")).toEqual({ counts: { amazing: 1 }, total: 1 });
    expect(applyReaction({}, 0, "unlucky", null)).toEqual({ counts: {}, total: 0 });
  });
});
