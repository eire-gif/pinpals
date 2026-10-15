import { describe, expect, it } from "vitest";

import { arrowOnScreen, playsLikeM, windLine, windOnShot, windSpeed } from "./wind";

describe("wind on a shot", () => {
  // A hole playing due north (bearing 0).
  it("a north wind is straight into you", () => {
    const w = windOnShot(15, 0, 0);
    expect(w.head).toBeCloseTo(15);
    expect(w.along).toBe("into");
    expect(w.push).toBeNull();
    expect(windLine(w)).toBe("Into you");
  });

  it("a south wind is behind you", () => {
    expect(windOnShot(15, 180, 0).along).toBe("behind");
  });

  it("a west wind blows left to right; an east wind right to left", () => {
    expect(windOnShot(15, 270, 0)).toMatchObject({ along: "across", push: "left to right" });
    expect(windOnShot(15, 90, 0)).toMatchObject({ along: "across", push: "right to left" });
  });

  it("a north-west wind on a north hole is into you and pushes left to right", () => {
    expect(windLine(windOnShot(14, 315, 0))).toBe("Into you, left to right");
  });

  it("works the same on a hole playing south-east", () => {
    expect(windOnShot(15, 135, 135).along).toBe("into");
    expect(windOnShot(15, 315, 135).along).toBe("behind");
  });

  it("calls a light breeze calm", () => {
    expect(windOnShot(2, 0, 0).along).toBe("calm");
  });
});

describe("plays like", () => {
  it("adds about 1% per mph into the wind and takes off half that downwind", () => {
    expect(playsLikeM(137, 10)).toBeCloseTo(150.7, 1);
    expect(playsLikeM(137, -10)).toBeCloseTo(130.15, 1);
    expect(playsLikeM(137, 0)).toBe(137);
  });

  it("caps a gale", () => {
    expect(playsLikeM(100, 60)).toBeCloseTo(130);
    expect(playsLikeM(100, -60)).toBeCloseTo(85);
  });
});

describe("the arrow on the map", () => {
  it("points where the wind blows to, turned with the map", () => {
    // North wind blows south: on a north-up map the arrow points down (180).
    expect(arrowOnScreen(0, 0)).toBe(180);
    // Hole playing east (map turned so east is up): a north wind blows to the right of... south is 90° clockwise from east.
    expect(arrowOnScreen(0, 90)).toBe(90);
  });
});

describe("speed in the member's unit", () => {
  it("mph with yards, km/h with metres", () => {
    expect(windSpeed(22.5, true)).toBe("14 mph");
    expect(windSpeed(22.5, false)).toBe("23 km/h");
  });
});
