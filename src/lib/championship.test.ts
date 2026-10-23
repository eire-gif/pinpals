import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  type ChampionshipDay,
  type DayRow,
  type Player,
  biggestMovers,
  buildBoard,
  dayPlacesPoints,
  leadMargin,
  placesPointsFor,
  resolveRule,
  toParLabel,
} from "./championship";

const solo = (id: string, score: number | null, thru = 18, extra: Partial<DayRow> = {}): DayRow => ({
  memberIds: [id],
  score,
  thru,
  finished: thru >= 18,
  ...extra,
});

const players = new Map<string, Player>(
  ["a", "b", "c", "d"].map((id) => [`m:${id}`, { key: `m:${id}`, name: id.toUpperCase(), detail: null, memberId: id }]),
);

describe("rule", () => {
  it("adds up when every day is in the same units, else places points", () => {
    expect(resolveRule("auto", ["points", "points", "points"])).toBe("add");
    expect(resolveRule("auto", ["net", "net"])).toBe("add");
    expect(resolveRule("auto", ["points", "net"])).toBe("places");
    expect(resolveRule("auto", ["net", "gross"])).toBe("places");
    expect(resolveRule("places", ["points", "points"])).toBe("places");
    // Adding up is refused when units mix.
    expect(resolveRule("add", ["points", "gross"])).toBe("places");
  });

  it("places table runs 25, 20, 16 … 1 and 1 after", () => {
    expect([0, 1, 2, 3, 14, 15, 40].map(placesPointsFor)).toEqual([25, 20, 16, 13, 1, 1, 1]);
  });

  it("formats to par", () => {
    expect([0, 3, -2, -1.5].map(toParLabel)).toEqual(["E", "+3", "−2", "−1.5"]);
  });
});

describe("adding up points", () => {
  const days: ChampionshipDay[] = [
    { round: 1, kind: "points", team: false, status: "final", rows: [solo("a", 38), solo("b", 36), solo("c", 40), solo("d", 30)] },
    { round: 2, kind: "points", team: false, status: "live", rows: [solo("a", 30, 14), solo("b", 39, 18), solo("c", 20, 9)] },
  ];

  it("totals points, highest first, with movement against the end of day 1", () => {
    const b = buildBoard({ days, rule: "auto", players });
    expect(b.rule).toBe("add");
    expect(b.unit).toBe("points");
    expect(b.through).toBe(2);
    expect(b.live).toBe(true);
    expect(b.rows.map((r) => [r.name, r.totalLabel, r.positionLabel, r.move, r.thruLabel])).toEqual([
      ["B", "75", "1", 2, "F"],
      ["A", "68", "2", 0, "14"],
      ["C", "60", "3", -2, "9"],
      ["D", "30", "4", 0, "—"],
    ]);
    expect(biggestMovers(b).map((r) => r.name)).toEqual(["B"]);
    expect(leadMargin(b)).toBe(7);
  });

  it("can be viewed after day 1, with no movement yet", () => {
    const b = buildBoard({ days, rule: "auto", players, view: 1 });
    expect(b.rows.map((r) => [r.name, r.positionLabel, r.move])).toEqual([
      ["C", "1", null],
      ["A", "2", null],
      ["B", "3", null],
      ["D", "4", null],
    ]);
    // Live day's column is blank when viewing day 1.
    expect(b.rows[0].cells[1].label).toBe("");
  });

  it("shows a live card as — in its round column", () => {
    const b = buildBoard({ days, rule: "auto", players });
    const a = b.rows.find((r) => r.name === "A")!;
    expect(a.cells.map((c) => c.label)).toEqual(["38", "—"]);
  });
});

describe("adding up strokes", () => {
  it("lowest to par wins and a missed final day isn't ranked", () => {
    const days: ChampionshipDay[] = [
      { round: 1, kind: "net", team: false, status: "final", rows: [solo("a", -2), solo("b", 1), solo("c", 0)] },
      { round: 2, kind: "net", team: false, status: "final", rows: [solo("a", 1), solo("b", -4)] },
    ];
    const b = buildBoard({ days, rule: "auto", players });
    expect(b.unit).toBe("to par");
    expect(b.rows.map((r) => [r.name, r.totalLabel, r.positionLabel])).toEqual([
      ["B", "−3", "1"],
      ["A", "−1", "2"],
      ["C", "—", "—"],
    ]);
    expect(b.rows[2].missed).toEqual([2]);
  });
});

describe("places points", () => {
  it("splits points on a tie and gives a team's points to every member", () => {
    const day: ChampionshipDay = {
      round: 2,
      kind: "net",
      team: true,
      status: "final",
      rows: [
        { memberIds: ["a", "b"], score: -8, thru: 18, finished: true },
        { memberIds: ["c", "d"], score: -8, thru: 18, finished: true },
      ],
    };
    expect(dayPlacesPoints(day)).toEqual([22.5, 22.5]);
  });

  it("uses the published places so countbacks count", () => {
    const day: ChampionshipDay = {
      round: 1,
      kind: "points",
      team: false,
      status: "final",
      rows: [solo("a", 38, 18, { position: 2 }), solo("b", 38, 18, { position: 1 }), solo("c", 35, 18, { position: 3 })],
    };
    expect(dayPlacesPoints(day)).toEqual([20, 25, 16]);
  });

  it("mixes a Stableford day with a team scramble", () => {
    const days: ChampionshipDay[] = [
      { round: 1, kind: "points", team: false, status: "final", rows: [solo("a", 40), solo("b", 36), solo("c", 34), solo("d", 30)] },
      {
        round: 2,
        kind: "net",
        team: true,
        status: "final",
        rows: [
          { memberIds: ["c", "d"], score: -10, thru: 18, finished: true },
          { memberIds: ["a", "b"], score: -6, thru: 18, finished: true },
        ],
      },
    ];
    const b = buildBoard({ days, rule: "auto", players });
    expect(b.rule).toBe("places");
    expect(b.rows.map((r) => [r.name, r.totalLabel, r.cells.map((c) => c.label)])).toEqual([
      ["A", "45", ["25", "20"]],
      ["C", "41", ["16", "25"]],
      ["B", "40", ["20", "20"]],
      ["D", "38", ["13", "25"]],
    ]);
    // Cells keep the real score too.
    expect(b.rows[1].cells[1].scoreLabel).toBe("−10");
  });
});

describe("level at the end", () => {
  it("the better final day wins once every day is final", () => {
    const days: ChampionshipDay[] = [
      { round: 1, kind: "points", team: false, status: "final", rows: [solo("a", 40), solo("b", 36)] },
      { round: 2, kind: "points", team: false, status: "final", rows: [solo("a", 34), solo("b", 38)] },
    ];
    const b = buildBoard({ days, rule: "auto", players });
    expect(b.final).toBe(true);
    expect(b.rows.map((r) => [r.name, r.positionLabel])).toEqual([
      ["B", "1"],
      ["A", "2"],
    ]);
  });

  it("is shared while a day is still live", () => {
    const days: ChampionshipDay[] = [
      { round: 1, kind: "points", team: false, status: "final", rows: [solo("a", 40), solo("b", 36)] },
      { round: 2, kind: "points", team: false, status: "live", rows: [solo("a", 34, 17), solo("b", 38)] },
    ];
    const b = buildBoard({ days, rule: "auto", players });
    expect(b.rows.map((r) => r.positionLabel)).toEqual(["T1", "T1"]);
  });
});

describe("review fixes", () => {
  it("a guest without a published place doesn't throw the countback away", () => {
    const day: ChampionshipDay = {
      round: 1,
      kind: "points",
      team: false,
      status: "final",
      rows: [
        solo("a", 38, 18, { position: 2 }),
        solo("b", 38, 18, { position: 1 }),
        { memberIds: [], guestNames: ["Guest"], score: 40, thru: 18, finished: true },
      ],
    };
    // Placed sides first by place, then the guest by score.
    expect(dayPlacesPoints(day)).toEqual([20, 25, 16]);
  });

  it("the tie-break at the end uses the countback winner, not the raw score", () => {
    const days: ChampionshipDay[] = [
      { round: 1, kind: "points", team: false, status: "final", rows: [solo("a", 36), solo("b", 36)] },
      { round: 2, kind: "points", team: false, status: "final", rows: [solo("a", 38, 18, { position: 2 }), solo("b", 38, 18, { position: 1 })] },
    ];
    const b = buildBoard({ days, rule: "auto", players });
    expect(b.rows.map((r) => [r.name, r.positionLabel])).toEqual([
      ["B", "1"],
      ["A", "2"],
    ]);
  });

  it("an unfinished card on a final day counts under neither rule", () => {
    const days: ChampionshipDay[] = [
      { round: 1, kind: "points", team: false, status: "final", rows: [solo("a", 36), solo("b", 20, 9)] },
      { round: 2, kind: "points", team: false, status: "live", rows: [solo("a", 10, 5), solo("b", 12, 5)] },
    ];
    const b = buildBoard({ days, rule: "auto", players });
    expect(b.rows.map((r) => [r.name, r.totalLabel])).toEqual([
      ["A", "46"],
      ["B", "12"],
    ]);
  });
});

describe("copies", () => {
  it("website and app copies are byte-identical", () => {
    const site = readFileSync(join(process.cwd(), "src/lib/championship.ts"), "utf8");
    const app = readFileSync(join(process.cwd(), "mobile/src/lib/championship.ts"), "utf8");
    expect(app).toBe(site);
  });
});
