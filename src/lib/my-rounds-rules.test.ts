import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildMyRounds } from "./my-rounds-rules";

/**
 * The rules for My rounds are tested in full in
 * mobile/src/lib/my-rounds-rules.test.ts. This only makes sure the website
 * runs the same ones: the two copies must be identical, or the app and the
 * site would tell a member different things about the same round.
 */
describe("my-rounds-rules.ts", () => {
  it("is byte-identical in the website and the app", () => {
    const site = readFileSync(join(process.cwd(), "src/lib/my-rounds-rules.ts"), "utf8");
    const app = readFileSync(join(process.cwd(), "mobile/src/lib/my-rounds-rules.ts"), "utf8");
    expect(site).toBe(app);
  });

  it("builds an empty page for a member with no rounds", () => {
    const view = buildMyRounds({ userId: "u", hosted: [], joined: [], interests: [], now: new Date(2026, 9, 17, 12) });
    expect(view).toEqual({ needs: [], upcoming: [], played: [], counts: { all: 0, hosting: 0, playing: 0, requested: 0 } });
  });
});
