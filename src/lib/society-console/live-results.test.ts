import { describe, expect, it } from "vitest";

import type { CardHole } from "@/lib/live-scoring";
import type { TvGame } from "@/lib/tv-board";
import { basisOf, entrantsOf, settingsFrom, workOut } from "./live-results";

const card: CardHole[] = Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, strokeIndex: i + 1 }));

const player = (id: number, name: string, ph: number, memberId: string | null, position: number) => ({ id, memberId, name, club: null, playingHandicap: ph, courseHandicap: ph, side: null, position });

function full(strokes: number, except: Record<number, number | null> = {}) {
  const m = new Map<number, number | null>();
  for (let h = 1; h <= 18; h += 1) m.set(h, h in except ? except[h] : strokes);
  return m;
}

const day: TvGame[] = [
  {
    round: { id: 7, matchNumber: 1, format: "stableford", matchFormat: null, status: "live", courseName: "Portmarnock", teeTime: "09:00", scramble: null },
    players: [player(71, "Niamh Kelly", 0, "m1", 1), player(72, "Tom Gallagher", 0, "m2", 2), player(73, "Pat Moran", 0, null, 3)],
    card,
    scores: new Map([
      [71, full(4, { 18: 3 })],
      [72, full(4)],
      [73, full(3)],
    ]),
    entries: [],
  },
];

describe("live results", () => {
  it("keys and certifies cards as the app does", () => {
    const es = entrantsOf("fourballs", day, new Map([["7:m1", true]]));
    expect(es.map((e) => [e.key, e.certified, e.guest])).toEqual([
      ["p71", true, false],
      ["p72", false, false],
      ["p73", null, true],
    ]);
  });

  it("ranks the day, guests listed but not placed", () => {
    const r = workOut(1, "fourballs", day, new Map(), settingsFrom({}));
    expect(basisOf("fourballs", day)).toBe("stableford");
    const rows = r.divisions[0].ranking.rows;
    expect(rows.map((x) => x.positionLabel)).toEqual(["1", "2", "Guest"]);
    expect(rows.find((x) => x.key === "p71")?.score).toBe("37");
  });

  it("applies an amendment and marks it", () => {
    const r = workOut(1, "fourballs", day, new Map(), settingsFrom({ amendments: [{ key: "p71", hole: 18, strokes: 6, dq: false, reason: "Signed for a 3, took 6" }] }));
    const niamh = r.divisions[0].ranking.rows.find((x) => x.key === "p71")!;
    expect(niamh.score).toBe("34");
    expect(niamh.amended[0]).toContain("Hole 18: 3 → 6");
    expect(r.amendments).toHaveLength(1);
  });

  it("reads stored settings safely", () => {
    const s = settingsFrom({ tieRule: "share", divisionCuts: [18, "x", 9], bestGross: false, extras: [{ label: "NTP 5th", winner: "Orla" }, { nope: 1 }] });
    expect(s).toMatchObject({ tieRule: "share", divisionCuts: [9, 18], bestGross: false, extras: [{ label: "NTP 5th", winner: "Orla" }] });
    expect(settingsFrom(null).tieRule).toBe("draw");
  });
});
