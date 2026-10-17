import { describe, expect, it } from "vitest";

import { assistFor, competitionLine } from "./competition-mode-rules";

describe("competition mode", () => {
  it("leaves a casual round exactly as it was", () => {
    const a = assistFor(false, false);
    expect(a).toEqual({ on: false, source: null, playsLike: true, clubSuggestion: true, windOnShot: true, canSwitchOff: true });
    expect(competitionLine(a)).toBeNull();
  });

  it("takes away plays-like, the club and the wind on the shot in a society or competition round", () => {
    const a = assistFor(true, false);
    expect(a.on).toBe(true);
    expect(a.playsLike).toBe(false);
    expect(a.clubSuggestion).toBe(false);
    expect(a.windOnShot).toBe(false);
    expect(competitionLine(a)).toBe("Competition round · distances only (Rule 4.3)");
  });

  it("can't be switched off on the phone when the round itself is a competition", () => {
    expect(assistFor(true, false).canSwitchOff).toBe(false);
    expect(assistFor(true, true).canSwitchOff).toBe(false);
    expect(assistFor(true, true).source).toBe("society");
  });

  it("can be switched on and off by the member in any other round", () => {
    const a = assistFor(false, true);
    expect(a.on).toBe(true);
    expect(a.source).toBe("manual");
    expect(a.canSwitchOff).toBe(true);
    expect(a.clubSuggestion).toBe(false);
    expect(competitionLine(a)).toBe("Competition mode · distances only (Rule 4.3)");
  });
});
