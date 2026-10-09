import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * scorecard-math.ts is shared with the app (its own tests live in
 * mobile/src/lib/scorecard-math.test.ts). The website's public scorecard page
 * and the app must add up a card the same way, so the two copies may not
 * drift: edit one, copy it to the other.
 */
describe("scorecard-math", () => {
  it("is byte-identical in the website and the app", () => {
    const site = readFileSync(join(process.cwd(), "src/lib/scorecard-math.ts"), "utf8");
    const app = readFileSync(join(process.cwd(), "mobile/src/lib/scorecard-math.ts"), "utf8");
    expect(site).toBe(app);
  });
});
