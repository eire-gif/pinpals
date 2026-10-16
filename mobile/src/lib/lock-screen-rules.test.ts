import { describe, expect, it } from "vitest";

import type { LayoutPoint } from "./hole-geo";
import { anySpots, lockScreenHole, lockScreenLinks, lockScreenSpots, lockScreenStrokes, positionLine } from "./lock-screen-rules";

const card = Array.from({ length: 18 }, (_, i) => ({ hole: i + 1 }));

describe("lockScreenStrokes", () => {
  it("sends picked up as 0 and keys holes as strings", () => {
    expect(lockScreenStrokes(new Map([[1, 5], [2, null], [3, 4]]))).toEqual({ "1": 5, "2": 0, "3": 4 });
  });
});

describe("lockScreenHole", () => {
  it("shows the first hole with no score", () => {
    expect(lockScreenHole(card, new Map())).toBe(1);
    expect(lockScreenHole(card, new Map([[1, 4], [2, 5], [4, 3]]))).toBe(3);
  });
  it("counts picked up as scored", () => {
    expect(lockScreenHole(card, new Map([[1, null]]))).toBe(2);
  });
  it("follows the card's own order, e.g. a round starting on the 10th", () => {
    const back = [10, 11, 12, 1, 2].map((hole) => ({ hole }));
    expect(lockScreenHole(back, new Map([[10, 4]]))).toBe(11);
  });
  it("stays on the last hole once everything is in", () => {
    expect(lockScreenHole(card, new Map(card.map((h) => [h.hole, 4])))).toBe(18);
  });
});

describe("positionLine", () => {
  it("reads naturally", () => {
    expect(positionLine("1", 4)).toBe("1st of 4");
    expect(positionLine("2", 4)).toBe("2nd of 4");
    expect(positionLine("3", 4)).toBe("3rd of 4");
    expect(positionLine("T2", 4)).toBe("Joint 2nd of 4");
    expect(positionLine("11", 12)).toBe("11th of 12");
  });
  it("says nothing before anyone has a position, or playing alone", () => {
    expect(positionLine("", 4)).toBeNull();
    expect(positionLine("1", 1)).toBeNull();
  });
});

describe("lockScreenSpots", () => {
  const pt = (hole: number, kind: LayoutPoint["kind"], lat: number, lng: number): LayoutPoint => ({ hole, kind, lat, lng, label: null });
  it("takes the provider's green and tee, and OpenStreetMap's where the provider has none", () => {
    const provider = [pt(1, "tee_back", 53.1, -6.1), pt(1, "green_centre", 53.2, -6.2)];
    const osm = [pt(2, "tee_front", 53.3, -6.3), pt(2, "green_front", 53.4, -6.4), pt(2, "green_back", 53.6, -6.6), pt(1, "green_centre", 1, 1)];
    const spots = lockScreenSpots([{ hole: 1 }, { hole: 2 }, { hole: 3 }], provider, osm);
    expect(spots[0]).toEqual({ n: 1, green: [53.2, -6.2], tee: [53.1, -6.1] });
    // No centre: halfway between front and back.
    expect(spots[1].green?.[0]).toBeCloseTo(53.5);
    expect(spots[1].tee).toEqual([53.3, -6.3]);
    expect(spots[2]).toEqual({ n: 3, green: null, tee: null });
    expect(anySpots(spots)).toBe(true);
    expect(anySpots([spots[2]])).toBe(false);
  });
});

describe("lockScreenLinks", () => {
  it("builds the mic and map links, leaving out what's off", () => {
    expect(lockScreenLinks(34, 12, { voice: true, map: true })).toEqual({
      voiceUrl: "pinpals://live/round/34?voice=1&hole=",
      mapUrl: "pinpals://hole-map?clubId=12&roundId=34&hole=",
    });
    expect(lockScreenLinks(34, null, { voice: false, map: true })).toEqual({ voiceUrl: null, mapUrl: null });
  });
});
