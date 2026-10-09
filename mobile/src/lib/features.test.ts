import { describe, expect, it } from "vitest";
import { FEATURES } from "./features";
import { navyAlpha, creamAlpha } from "./theme";

describe("feature flags", () => {
  it("unfinished features stay off until their backend ships", () => {
    // Switching one of these on? Its backend must exist first — see the
    // design docs named in features.ts — then update this test.
    expect({
      groups: FEATURES.groups,
      sharedRounds: FEATURES.sharedRounds,
    }).toEqual({
      groups: false,
      sharedRounds: false,
    });
  });

  it("shipped features are on", () => {
    expect([FEATURES.recapPrompts, FEATURES.achievementClaims, FEATURES.profileSections, FEATURES.video, FEATURES.liveScoring, FEATURES.shotMaps]).toEqual([
      true, true, true, true, true, true,
    ]);
  });
});

describe("theme alpha helpers", () => {
  it("derive from the navy and cream tokens", () => {
    expect(navyAlpha(0.5)).toBe("rgba(12,32,56,0.5)");
    expect(creamAlpha(0.12)).toBe("rgba(247,243,234,0.12)");
  });
});
