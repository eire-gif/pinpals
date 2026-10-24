import { describe, expect, it } from "vitest";

import type { LayoutPoint } from "./hole-geo";
import { anySpots, lockScreenBoard, lockScreenHole, lockScreenLinks, lockScreenSpots, lockScreenStrokes, positionLine, watchGroup, watchNames } from "./lock-screen-rules";

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
    // The watch also gets the front and back of the green.
    expect(spots[1].front).toEqual([53.4, -6.4]);
    expect(spots[1].back).toEqual([53.6, -6.6]);
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

describe("lockScreenSpots — hazards for the watch", () => {
  it("names each hazard from the course data, or by its kind", () => {
    const provider: LayoutPoint[] = [
      { hole: 1, kind: "tee_back", lat: 53.1, lng: -6.1, label: null },
      { hole: 1, kind: "green_centre", lat: 53.2, lng: -6.2, label: null },
      { hole: 1, kind: "water", lat: 53.15, lng: -6.15, label: "Burn" },
      { hole: 1, kind: "fairway_bunker", lat: 53.16, lng: -6.16, label: "  " },
    ];
    const [spot] = lockScreenSpots([{ hole: 1 }], provider, []);
    expect(spot.hz).toEqual([
      { k: "water", l: "Burn", p: [53.15, -6.15] },
      { k: "fairway_bunker", l: "Fairway bunker", p: [53.16, -6.16] },
    ]);
    expect(lockScreenSpots([{ hole: 1 }], provider.slice(0, 2), [])[0].hz).toBeUndefined();
  });
});

describe("watchNames", () => {
  it("uses first names, with an initial where two clash", () => {
    expect(watchNames(["Tom Byrne", "Tom Walsh", "Ruth Ryan", "Seán (guest)"])).toEqual(["Tom B.", "Tom W.", "Ruth", "Seán"]);
    expect(watchNames(["Ciarán", "ciarán"])).toEqual(["Ciarán", "ciarán"]);
  });
});

describe("watchGroup", () => {
  const card = [{ hole: 1 }, { hole: 2 }];
  const players = [
    { id: 10, name: "Tom Byrne", memberId: "tom", position: 1 },
    { id: 11, name: "Eire Duffy", memberId: "me", position: 2 },
    { id: 12, name: "Seán (guest)", memberId: null, position: 3 },
  ];
  const scores = new Map([[10, new Map<number, number | null>([[1, 5], [2, null]])]]);
  const shotsAt = (id: number, hole: number) => (id === 12 && hole === 1 ? 1 : 0);

  it("puts you first, with everyone's shots and scores", () => {
    const g = watchGroup({ shared: false, players, me: "me", card, shotsAt, scores });
    expect(g?.map((p) => [p.id, p.name, p.me])).toEqual([
      [11, "Eire", true],
      [10, "Tom", false],
      [12, "Seán", false],
    ]);
    expect(g?.[1].strokes).toEqual({ "1": 5, "2": 0 });
    expect(g?.[2].shots).toEqual([1, 0]);
  });

  it("is off for a shared card, on your own, or when you're not playing", () => {
    expect(watchGroup({ shared: true, players, me: "me", card, shotsAt, scores })).toBeNull();
    expect(watchGroup({ shared: false, players: players.slice(1, 2), me: "me", card, shotsAt, scores })).toBeNull();
    expect(watchGroup({ shared: false, players, me: "someone-else", card, shotsAt, scores })).toBeNull();
  });
});

describe("lockScreenBoard", () => {
  it("wants the leaderboard card only when someone else is in the game", () => {
    expect(lockScreenBoard({ id: 7 }, true, "https://pinpals.ie").board).toBe(true);
    expect(lockScreenBoard({ id: 7 }, false, "https://pinpals.ie").board).toBe(false);
    expect(lockScreenBoard({ id: 7 }, undefined, "https://pinpals.ie").board).toBe(false);
  });

  it("reads the watch's board route and opens the round on its Leaderboard", () => {
    expect(lockScreenBoard({ id: 42 }, true, "https://pinpals.ie/")).toEqual({
      board: true,
      boardApi: "https://pinpals.ie/api/widget/live/board",
      boardUrl: "pinpals://live/round/42?view=board",
    });
  });
});
