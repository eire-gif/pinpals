import { describe, expect, it } from "vitest";

import type { CardHole } from "@/lib/live-scoring";
import type { TvGame } from "@/lib/tv-board";
import { cardProblems, controlRoom, parseCard, planDay, QUIET_MINUTES, type DaySetup, type DrawnGroup } from "./live-day";

const SI = [7, 15, 3, 11, 1, 17, 9, 13, 5, 8, 16, 2, 12, 4, 18, 10, 14, 6];
const card: CardHole[] = SI.map((si, i) => ({ hole: i + 1, par: [4, 3, 5][i % 3], strokeIndex: si }));

const setup = (over: Partial<DaySetup> = {}): DaySetup => ({
  title: "Captain's Prize",
  courseName: "Portmarnock",
  clubId: 12,
  tee: { teeName: "Blue", courseRating: 74.6, slope: 135, par: 72, card },
  format: "stableford",
  pairScoring: "stableford",
  start: "tees",
  shotgunTime: null,
  ...over,
});

const p = (name: string, index: number | null, guest = false) => ({ key: guest ? `g:${name}` : `m:${name}`, memberId: guest ? null : `00000000-0000-4000-8000-${String(name.length).padStart(12, "0")}`, name, index, guest });

const draw: DrawnGroup[] = [
  { number: 1, teeTime: "08:30", players: [p("Niamh Kelly", 8.4), p("Ciaran Byrne", 11.9), p("Tom Gallagher", 14.2), p("Ruth Keane", 19.6)] },
  { number: 2, teeTime: "08:40", players: [p("Pat Moran", 18, true), p("Brian Kenny", 10), p("Orla Quinn", 13.1), p("Liam Farrell", 8)] },
];

describe("cardProblems", () => {
  it("passes a full card", () => expect(cardProblems(card)).toEqual([]));
  it("names missing stroke indexes", () => {
    const c = card.map((h) => (h.hole === 4 ? { ...h, strokeIndex: null } : h));
    expect(cardProblems(c)[0]).toContain("hole 4");
  });
  it("catches an index used twice", () => {
    const c = card.map((h) => (h.hole === 2 ? { ...h, strokeIndex: 7 } : h));
    expect(cardProblems(c)[0]).toMatch(/Stroke index 7 is on hole 1 and hole 2/);
  });
  it("checks par", () => expect(cardProblems(card.map((h) => (h.hole === 3 ? { ...h, par: 9 } : h)))[0]).toContain("hole 3"));
});

describe("planDay", () => {
  it("makes a society day the app would make: 95% of course handicap", () => {
    const plan = planDay(setup(), draw);
    expect(plan.problems).toEqual([]);
    expect(plan.rpc?.fn).toBe("live_fourball_day_create");
    if (plan.rpc?.fn !== "live_fourball_day_create") return;
    const niamh = plan.rpc.args.p_groups[0].players[0];
    // 8.4 × 135/113 + (74.6 − 72) = 12.64 → 13; 95% → 12.35 → 12
    expect(niamh).toMatchObject({ name: "Niamh Kelly", course_handicap: 13, playing_handicap: 12, handicap_estimated: false });
    expect(plan.rpc.args.p_day).toMatchObject({ format: "stableford", allowance: 0.95, holes: 18, tee_name: "Blue", par_total: 72 });
    expect(plan.rpc.args.p_groups.map((g) => g.tee_time)).toEqual(["08:30", "08:40"]);
    expect(plan.rpc.args.p_groups[1].players[0].member_id).toBeNull();
  });

  it("refuses without every handicap, and says who", () => {
    const plan = planDay(setup(), [{ number: 1, teeTime: null, players: [p("Sean Doyle", null)] }]);
    expect(plan.rpc).toBeNull();
    expect(plan.problems[0]).toContain("Sean Doyle has no handicap index");
  });

  it("refuses without a draw", () => {
    expect(planDay(setup(), []).problems[0]).toContain("Publish the draw");
  });

  it("pairs foursomes as seats 1 & 2 and 3 & 4, off half the combined handicaps", () => {
    const plan = planDay(setup({ format: "foursomes", pairScoring: "stroke" }), draw);
    expect(plan.problems).toEqual([]);
    if (plan.rpc?.fn !== "live_scramble_day_create") throw new Error("expected pairs");
    expect(plan.rpc.args.p_day).toMatchObject({ scramble_size: 2, foursomes_scoring: "stroke" });
    expect(plan.rpc.args.p_teams).toHaveLength(4);
    expect(plan.rpc.args.p_teams[0].name).toBe("Niamh & Ciaran");
    expect(plan.rpc.args.p_teams[0].team_handicap).toBe(Math.floor(0.5 * (13 + 17) + 0.5));
  });

  it("marks greensomes", () => {
    const plan = planDay(setup({ format: "greensomes" }), draw);
    if (plan.rpc?.fn !== "live_scramble_day_create") throw new Error("expected pairs");
    expect(plan.rpc.args.p_day.greensomes).toBe(true);
  });

  it("needs pairs to fit the groups", () => {
    const odd: DrawnGroup[] = [{ number: 1, teeTime: null, players: draw[0].players.slice(0, 3) }];
    expect(planDay(setup({ format: "foursomes" }), odd).problems[0]).toContain("groups of 2 or 4");
  });

  it("makes each group a scramble team", () => {
    const plan = planDay(setup({ format: "scramble" }), draw);
    if (plan.rpc?.fn !== "live_scramble_day_create") throw new Error("expected a scramble");
    expect(plan.rpc.args.p_day.scramble_size).toBe(4);
    expect(plan.rpc.args.p_teams.map((t) => t.name)).toEqual([null, null]);
  });

  it("gives a shotgun its holes and one start time", () => {
    const plan = planDay(setup({ start: "shotgun", shotgunTime: "09:00" }), draw);
    if (plan.rpc?.fn !== "live_fourball_day_create") throw new Error("expected a society day");
    expect(plan.rpc.args.p_groups.map((g) => [g.tee_time, g.start_hole, g.start_letter])).toEqual([
      ["09:00", 1, "A"],
      ["09:00", 2, "A"],
    ]);
    expect(plan.groups.map((g) => g.start)).toEqual(["1", "2"]);
  });

  it("needs a shotgun time", () => {
    expect(planDay(setup({ start: "shotgun", shotgunTime: null }), draw).problems[0]).toContain("start time");
  });

  it("won't leave out someone entered but not drawn", () => {
    expect(planDay(setup({ notDrawn: ["Sean Doyle"] }), draw).problems[0]).toContain("Sean Doyle is entered but not in the draw");
  });

  it("says when the card isn't fit to play off", () => {
    const plan = planDay(setup({ tee: { teeName: "Blue", courseRating: null, slope: null, par: null, card: card.map((h) => ({ ...h, strokeIndex: null })) } }), draw);
    expect(plan.rpc).toBeNull();
    expect(plan.problems.join(" ")).toContain("every hole");
  });

  it("flags handicaps worked out without a rating", () => {
    const plan = planDay(setup({ tee: { teeName: "", courseRating: null, slope: null, par: 72, card } }), draw);
    expect(plan.groups[0].lines[0]).toMatchObject({ estimated: true, handicap: 8 });
  });
});

describe("parseCard", () => {
  it("reads the posted card", () => expect(parseCard(JSON.stringify(card))).toHaveLength(18));
  it("refuses junk", () => {
    expect(parseCard("nope")).toBeNull();
    expect(parseCard(JSON.stringify([{ hole: 1, par: "4" }]))).toBeNull();
  });
});

describe("controlRoom", () => {
  const now = new Date("2026-10-24T11:00:00Z"); // 12:00 in Dublin
  const mins = (m: number) => new Date(now.getTime() - m * 60000).toISOString();
  const game = (id: number, number: number, holesIn: number, lastAgo: number, teeTime: string | null = "09:00"): TvGame => {
    const sheet = new Map<number, Map<number, number | null>>();
    const entries: TvGame["entries"] = [];
    for (const pid of [id * 10 + 1, id * 10 + 2]) {
      const m = new Map<number, number | null>();
      for (let h = 1; h <= holesIn; h += 1) {
        const strokes = h === 2 && pid === id * 10 + 1 ? 2 : card[h - 1].par;
        m.set(h, strokes);
        entries.push({ playerId: pid, hole: h, strokes, at: mins(lastAgo + (holesIn - h)) });
      }
      sheet.set(pid, m);
    }
    return {
      round: { id, matchNumber: number, format: "stableford", matchFormat: null, status: "live", courseName: "Portmarnock", teeTime, scramble: null },
      players: [
        { id: id * 10 + 1, memberId: null, name: `A${id} Player`, club: null, playingHandicap: 0, courseHandicap: 0, side: null, position: 1 },
        { id: id * 10 + 2, memberId: null, name: `B${id} Player`, club: null, playingHandicap: 0, courseHandicap: 0, side: null, position: 2 },
      ],
      card,
      scores: sheet,
      entries,
    };
  };

  it("shows where each group is, and its colours hole by hole", () => {
    const room = controlRoom([game(1, 1, 5, 2), game(2, 2, 18, 1)], now, { today: true, kind: "fourballs" });
    expect(room.groups.map((g) => [g.number, g.state, g.thru, g.on])).toEqual([
      [1, "playing", 5, "6"],
      [2, "done", 18, "F"],
    ]);
    expect(room.onHole).toEqual({ 6: [1] });
    expect(room.strips.p11.slice(0, 3).map((x) => x.mark)).toEqual(["par", "birdie", "par"]);
    expect(room.strips.p11[6].mark).toBe("none");
    expect(room.totals).toMatchObject({ groupsOut: 1, groupsDone: 1, holesScored: 5 * 2 + 18 * 2, holesTotal: 72 });
  });

  it("flags a group gone quiet, and one that hasn't started", () => {
    const room = controlRoom([game(1, 1, 7, QUIET_MINUTES + 5), game(2, 2, 0, 0, "10:00")], now, { today: true, kind: "fourballs" });
    expect(room.attention.map((a) => a.key)).toEqual(["quiet-1", "late-2"]);
    expect(room.attention[0].title).toContain("group 1");
  });

  it("doesn't nag about the clock on another day", () => {
    const room = controlRoom([game(1, 1, 7, 120)], now, { today: false, kind: "fourballs" });
    expect(room.attention).toEqual([]);
  });

  it("asks about a score worth a second look", () => {
    const g = game(1, 1, 3, 1);
    (g.scores.get(11) as Map<number, number | null>).set(1, 10);
    const room = controlRoom([g], now, { today: true, kind: "fourballs" });
    expect(room.attention.some((a) => a.key === "odd-11-1")).toBe(true);
  });
});
