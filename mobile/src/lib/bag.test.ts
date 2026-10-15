import { describe, expect, it } from "vitest";

import { clubDistanceM, likelyClubs, suggestClub, type BagClub } from "./bag";
import { METRES_PER_YARD, destination, distanceArcs, distanceM } from "./hole-geo";

const yd = (y: number) => y * METRES_PER_YARD;
const c = (club: string, yards: number | null, medianYds: number | null = null, shots = 0, inBag = true): BagClub => ({
  club,
  inBag,
  yards,
  shots,
  medianM: medianYds == null ? null : yd(medianYds),
  lowM: null,
  highM: null,
});

const BAG: BagClub[] = [c("driver", 230), c("5i", 170), c("7i", 150, 151, 23), c("8i", 140, 139, 21), c("9i", 128), c("pw", 115), c("lw", 60, null, 0, false)];

describe("a club's distance", () => {
  it("goes by the member's shots once there are three, else what they typed", () => {
    expect(clubDistanceM(c("7i", 150, 151, 23))).toBeCloseTo(yd(151));
    expect(clubDistanceM(c("7i", 150, 160, 2))).toBeCloseTo(yd(150));
    expect(clubDistanceM(c("7i", null, 160, 1))).toBeCloseTo(yd(160));
    expect(clubDistanceM(c("7i", null))).toBeNull();
  });
});

describe("the club for a shot", () => {
  it("picks the nearest club, and offers the one up when the shot is beyond it", () => {
    const s = suggestClub(BAG, yd(137));
    expect(s?.club.club).toBe("8i");
    expect(s?.longer).toBeNull();
    const into = suggestClub(BAG, yd(149));
    expect(into?.club.club).toBe("7i");
    const between = suggestClub(BAG, yd(145));
    expect(between?.club.club).toBe("8i");
    expect(between?.longer?.club).toBe("7i");
  });

  it("leaves out clubs not in the bag, and copes with too far or too short", () => {
    expect(suggestClub(BAG, yd(55))?.club.club).toBe("pw");
    expect(suggestClub(BAG, yd(300))?.club.club).toBe("driver");
    expect(suggestClub([], yd(150))).toBeNull();
  });
});

describe("clubs to offer when tagging a shot", () => {
  it("the nearest by distance first", () => {
    expect(likelyClubs(BAG, yd(142), 3)).toEqual(["8i", "7i", "9i"]);
  });
  it("a sensible guess before anything is known", () => {
    expect(likelyClubs([], yd(240))[0]).toBe("driver");
    expect(likelyClubs([], yd(90))).toContain("pw");
  });
});

describe("distance arcs", () => {
  const tee = { lat: 53.43, lng: -6.12 };
  const green = destination(tee, 10, 330);
  it("draws rings at the given distances across the line, none past the green", () => {
    const arcs = distanceArcs(tee, green, [yd(100), yd(150), yd(200), yd(250), yd(400)]);
    expect(arcs.map((a) => Math.round(a.radiusM / METRES_PER_YARD))).toEqual([100, 150, 200, 250]);
    for (const a of arcs) for (const p of a.points) expect(distanceM(tee, p)).toBeCloseTo(a.radiusM, 0);
  });
});
