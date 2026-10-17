import { describe, expect, it } from "vitest";
import { FEATURES } from "./features";
import { navyAlpha, creamAlpha } from "./theme";

describe("feature flags", () => {
  it("unfinished features stay off until their backend ships", () => {
    // Switching one of these on? Its backend must exist first — see the
    // design docs named in features.ts — then update this test.
    expect({
      sharedRounds: FEATURES.sharedRounds,
      memberships: FEATURES.memberships,
    }).toEqual({
      sharedRounds: false,
      memberships: false,
    });
  });

  it("shipped features are on", () => {
    expect([FEATURES.recapPrompts, FEATURES.achievementClaims, FEATURES.profileSections, FEATURES.video, FEATURES.liveScoring, FEATURES.shotMaps, FEATURES.scorecards, FEATURES.groups, FEATURES.scorecardCertification, FEATURES.ads, FEATURES.clubhouseTv, FEATURES.competitions, FEATURES.voiceScoring, FEATURES.liveFollow, FEATURES.ageBands, FEATURES.cashMarketplace]).toEqual([
      true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true,
    ]);
  });
});

describe("theme alpha helpers", () => {
  it("derive from the navy and cream tokens", () => {
    expect(navyAlpha(0.5)).toBe("rgba(12,32,56,0.5)");
    expect(creamAlpha(0.12)).toBe("rgba(247,243,234,0.12)");
  });
});
