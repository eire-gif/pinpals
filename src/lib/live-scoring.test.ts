import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseTeamHandicap,
  stepTeamHandicap,
  teamHandicapBreakdown,
  teamHandicapLabel,
  blankCard,
  buildBoard,
  courseHandicap,
  exactLabel,
  nineHoleIndex,
  roundHalfUp,
  SINGLES_ALLOWANCE_CHOICES,
  driveCounts,
  driveShortfall,
  foursomesHandicap,
  foursomesTeeShot,
  scrambleHandicap,
  formatInfo,
  indexLabel,
  matchCompetitors,
  matchPoints,
  matchState,
  pointsLabel,
  teamMatchState,
  type MatchPlayer,
  netScoreName,
  parseIndex,
  playingHandicap,
  shotsByHole,
  shotsSoFar,
  stablefordPoints,
  toParLabel,
  type CardHole,
  type LivePlayer,
} from "./live-scoring";

// An 18-hole card with stroke indexes 1–18 in a realistic order.
const SI = [7, 13, 3, 15, 1, 11, 5, 17, 9, 8, 16, 2, 12, 6, 18, 4, 14, 10];
const PAR = [4, 4, 4, 3, 4, 5, 4, 3, 4, 4, 3, 5, 4, 4, 3, 5, 4, 4];
const card: CardHole[] = SI.map((si, i) => ({ hole: i + 1, par: PAR[i], strokeIndex: si }));
const sheet = (rows: Record<number, Record<number, number | null>>) =>
  new Map(Object.entries(rows).map(([id, holes]) => [Number(id), new Map(Object.entries(holes).map(([h, s]) => [Number(h), s]))]));


// ---------------------------------------------------------------------------
// Tie-out against Golf Ireland's own WHS Course Handicap calculator
// (Golf Ireland app, 26 Oct 2026): The Links Portmarnock, index 15.6, every
// tee it lists — men's and women's, 18 holes and each nine. If one of these
// fails, PinPals no longer agrees with Golf Ireland: don't change the
// expected numbers, find what changed in the sum.
// ---------------------------------------------------------------------------

const PORTMARNOCK: [tee: string, rating: number, slope: number, par: number, holes: 9 | 18, golfIreland: number][] = [
  ["Men's Blue", 75.8, 133, 72, 18, 22],
  ["Men's White", 73.5, 130, 72, 18, 19],
  ["Men's Green", 71.1, 125, 72, 18, 16],
  ["Men's Gold", 67.3, 118, 72, 18, 12],
  ["Women's Green", 77.1, 137, 72, 18, 24],
  ["Women's Gold", 72.7, 126, 72, 18, 18],
  ["Men's Blue B9", 38.1, 133, 36, 9, 11],
  ["Men's Blue F9", 37.7, 133, 36, 9, 11],
  ["Men's White B9", 36.9, 130, 36, 9, 10],
  ["Men's White F9", 36.6, 130, 36, 9, 10],
  ["Men's Green F9", 35.6, 125, 36, 9, 8],
  ["Men's Green B9", 35.5, 124, 36, 9, 8],
  ["Men's Gold B9", 33.6, 123, 36, 9, 6],
  ["Men's Gold F9", 33.7, 113, 36, 9, 6],
  ["Women's Green B9", 38.6, 137, 36, 9, 12],
  ["Women's Green F9", 38.5, 137, 36, 9, 12],
  ["Women's Gold B9", 36.3, 126, 36, 9, 9],
  ["Women's Gold F9", 36.4, 126, 36, 9, 9],
];

describe("live-scoring.ts agrees with Golf Ireland", () => {
  it.each(PORTMARNOCK)("%s: course handicap matches Golf Ireland", (_tee, courseRating, slope, par, holes, golfIreland) => {
    expect(courseHandicap(15.6, { slope, courseRating, par, holes }).courseHandicap).toBe(golfIreland);
  });

  it("9 holes uses half the index, to one decimal (Rule 6.1b)", () => {
    expect([nineHoleIndex(15.6), nineHoleIndex(15.5), nineHoleIndex(15.4), nineHoleIndex(0.1), nineHoleIndex(54)]).toEqual([7.8, 7.8, 7.7, 0.1, 27]);
    expect(courseHandicap(15.6, { slope: 133, courseRating: 38.1, par: 36, holes: 9 }).indexUsed).toBe(7.8);
    // Men's Gold F9 is exactly 5.5 → 6 (halves up).
    expect(courseHandicap(15.6, { slope: 113, courseRating: 33.7, par: 36, holes: 9 }).exact).toBeCloseTo(5.5, 9);
  });

  it("puts the allowance on the EXACT course handicap and rounds once (Rule 6.2a/1)", () => {
    // Men's Green: 16.357 × 95% = 15.54 → 16. Rounding first (16 × 95% = 15.2) would give 15.
    const green = courseHandicap(15.6, { slope: 125, courseRating: 71.1, par: 72 });
    expect(green.courseHandicap).toBe(16);
    expect(playingHandicap(green, 0.95)).toBe(16);
    expect(playingHandicap(green.courseHandicap, 0.95)).toBe(15); // the double rounding this guards against
    // The other men's tees at 95%: 22.16→21, 19.45→18, 11.59→11.
    expect(
      [[75.8, 133], [73.5, 130], [67.3, 118]].map(([cr, sl]) => playingHandicap(courseHandicap(15.6, { slope: sl, courseRating: cr, par: 72 }), 0.95))
    ).toEqual([21, 18, 11]);
  });

  it("doesn't let floating point round an exact .5 down", () => {
    // 0.2 × 113 ÷ 113 + (72.3 − 72) is 0.5 exactly; in doubles it's 0.4999… → must still be 1.
    expect(courseHandicap(0.2, { slope: 113, courseRating: 72.3, par: 72 }).courseHandicap).toBe(1);
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(0.30000000000000004 + 0.2)).toBe(1);
    expect(roundHalfUp(2.4999)).toBe(2);
  });

  it("matches an exact-arithmetic reference across every index, tee and allowance", () => {
    // Reference in whole numbers (tenths), no floating point at all.
    let checked = 0;
    for (let t = -100; t <= 540; t++) {
      for (const [, cr, slope, par, holes] of PORTMARNOCK) {
        const idxT = holes === 9 ? Math.floor((t + 1) / 2) : t;
        const num = idxT * slope + 113 * (Math.round(cr * 10) - 10 * par); // exact CH = num / 1130
        const ch = courseHandicap(t / 10, { slope, courseRating: cr, par, holes });
        expect(ch.courseHandicap).toBe(Math.floor((2 * num + 1130) / 2260));
        for (const pct of [100, 95, 90, 85]) expect(playingHandicap(ch, pct / 100)).toBe(Math.floor((2 * num * pct + 113000) / 226000));
        checked++;
      }
    }
    expect(checked).toBe(641 * PORTMARNOCK.length);
  });

  it("team formats round once, from exact course handicaps", () => {
    const ex = (i: number) => courseHandicap(i, { slope: 130, courseRating: 73.5, par: 72 }).exact;
    // 15.6 & 8.2 off the whites: 19.447 + 10.934 = 30.381 × 50% = 15.19 → 15.
    expect(foursomesHandicap([ex(15.6), ex(8.2)])).toBe(15);
    // Rounded first, 19 + 11 = 30 → 15 too; this pair shows where they differ: 16.6 & 4.4.
    expect(foursomesHandicap([ex(16.6), ex(4.4)])).toBe(Math.floor(0.5 * (ex(16.6) + ex(4.4)) + 0.5));
  });

  it("rounds a plus .5 towards zero (R&A Appendix C)", () => {
    // +0.5 → 0, +1.5 → +1, +2.5 → +2; an ordinary 2.5 → 3.
    expect([-0.5, -1.5, -2.5, 2.5].map(roundHalfUp)).toEqual([0, -1, -2, 3]);
    // A plus playing handicap moves up towards zero: +2.6 course at 95% = −2.47 → +2.
    expect(playingHandicap(-2.6, 0.95)).toBe(-2);
  });

  it("offers Golf Ireland's singles allowance choices, WHS 95% among them", () => {
    expect(SINGLES_ALLOWANCE_CHOICES).toEqual([1, 0.95, 0.9, 0.85]);
    expect(exactLabel(16.357)).toBe("16.4");
    expect(exactLabel(-1.26)).toBe("+1.3");
    expect(exactLabel(19)).toBe("19");
  });
});

describe("live-scoring.ts handicaps", () => {
  it("works out the course handicap the WHS way", () => {
    // 14.2 × 138 ÷ 113 + (73.4 − 72) = 18.74 → 19
    expect(courseHandicap(14.2, { slope: 138, courseRating: 73.4, par: 72 })).toMatchObject({ courseHandicap: 19, estimated: false, indexUsed: 14.2 });
    expect(courseHandicap(14.2, { slope: 138, courseRating: 73.4, par: 72 }).exact).toBeCloseTo(18.7416, 4);
    // Portmarnock Red, Blue tees (from the API test): 10.0 × 143 ÷ 113 + 6 = 18.65 → 19
    expect(courseHandicap(10, { slope: 143, courseRating: 78, par: 72 }).courseHandicap).toBe(19);
  });

  it("falls back to the index, and says so, when the course has no rating", () => {
    expect(courseHandicap(14.2, { slope: null, courseRating: null, par: 72 })).toEqual({ courseHandicap: 14, exact: 14.2, indexUsed: 14.2, estimated: true });
    expect(courseHandicap(14.5, {}).courseHandicap).toBe(15);
  });

  it("applies the format's allowance, halves rounding up", () => {
    expect(playingHandicap(19, formatInfo("stableford").allowance)).toBe(18); // 18.05
    expect(playingHandicap(10, 0.95)).toBe(10); // 9.5
    expect(playingHandicap(26, 0.95)).toBe(25); // 24.7
    expect(playingHandicap(19, formatInfo("matchplay").allowance)).toBe(19);
  });

  it("reads what a member types as an index", () => {
    expect([parseIndex("14.2"), parseIndex(" 8 "), parseIndex("+1.5"), parseIndex("14,2")]).toEqual([14.2, 8, -1.5, 14.2]);
    expect([parseIndex(""), parseIndex("abc"), parseIndex("60"), parseIndex("+11"), parseIndex("14.25")]).toEqual([null, null, null, null, null]);
  });

  it("writes plus handicaps with a plus", () => {
    expect(indexLabel(14.2)).toBe("14.2");
    expect(indexLabel(-1.5)).toBe("+1.5");
    expect(indexLabel(0)).toBe("0");
  });
});

describe("live-scoring.ts shots per hole", () => {
  const total = (m: Map<number, number>) => [...m.values()].reduce((a, b) => a + b, 0);

  it("hands out one shot on the hardest holes first", () => {
    const s = shotsByHole(5, card)!;
    expect(total(s)).toBe(5);
    expect(s.get(5)).toBe(1); // SI 1
    expect(s.get(16)).toBe(1); // SI 4
    expect(s.get(3)).toBe(1); // SI 3
    expect(s.get(15)).toBe(0); // SI 18
  });

  it("gives a second shot on the hardest holes above 18", () => {
    const s = shotsByHole(20, card)!;
    expect(total(s)).toBe(20);
    expect(s.get(5)).toBe(2); // SI 1
    expect(s.get(12)).toBe(2); // SI 2
    expect(s.get(3)).toBe(1); // SI 3
  });

  it("takes shots back on the easiest holes for a plus handicap", () => {
    const s = shotsByHole(-2, card)!;
    expect(total(s)).toBe(-2);
    expect(s.get(15)).toBe(-1); // SI 18
    expect(s.get(8)).toBe(-1); // SI 17
    expect(s.get(5)).toBe(0);
  });

  it("allocates by rank on a 9-hole card numbered 1, 3, 5…", () => {
    const nine: CardHole[] = [1, 3, 5, 7, 9, 11, 13, 15, 17].map((si, i) => ({ hole: i + 1, par: 4, strokeIndex: si }));
    const s = shotsByHole(4, nine)!;
    expect([...s.values()]).toEqual([1, 1, 1, 1, 0, 0, 0, 0, 0]);
  });

  it("refuses to guess on a card missing a stroke index", () => {
    expect(shotsByHole(10, blankCard(18))).toBeNull();
  });
});

describe("live-scoring.ts per hole", () => {
  it("scores Stableford points", () => {
    expect(stablefordPoints(5, 4, 1)).toBe(2); // net par
    expect(stablefordPoints(4, 4, 1)).toBe(3); // net birdie
    expect(stablefordPoints(8, 4, 1)).toBe(0); // never negative
    expect(stablefordPoints(null, 4, 2)).toBe(0); // picked up
  });

  it("names net scores", () => {
    expect(netScoreName(5, 4, 1)).toBe("Net par");
    expect(netScoreName(4, 4, 1)).toBe("Net birdie");
    expect(netScoreName(9, 4, 1)).toBeNull();
  });

  it("labels net to par", () => {
    expect([toParLabel(0), toParLabel(3), toParLabel(-2)]).toEqual(["E", "+3", "-2"]);
  });
});

describe("live-scoring.ts leaderboard", () => {
  const players: LivePlayer[] = [
    { id: 1, name: "Eire", playingHandicap: 18 },
    { id: 2, name: "Ciarán", playingHandicap: 10 },
    { id: 3, name: "Aoife", playingHandicap: 25 },
    { id: 4, name: "Seán", playingHandicap: 5 },
  ];

  it("ranks Stableford by points with ties, and leaves non-starters at the bottom", () => {
    // Hole 1: par 4, SI 7. Eire (1 shot) 5 = 2pts; Ciarán (1 shot) 4 = 3; Aoife (2 shots, 25 ≥ 18+7) 5 = 3.
    const board = buildBoard("stableford", card, players, sheet({ 1: { 1: 5 }, 2: { 1: 4 }, 3: { 1: 5 } }));
    expect(board.rows.map((r) => [r.name, r.position, r.points])).toEqual([
      ["Aoife", "T1", 3],
      ["Ciarán", "T1", 3],
      ["Eire", "3", 2],
      ["Seán", "", 0],
    ]);
    expect(board.rows[0].pace).toBe(1);
    expect(board.cardIncomplete).toBe(false);
  });

  it("ranks stroke play by net to par", () => {
    const board = buildBoard("stroke", card, players, sheet({ 1: { 1: 5, 2: 5 }, 4: { 1: 4, 2: 4 } }));
    // Seán: 8 strokes, no shots on SI 7 and 13, par 8 → E.
    // Eire: 10 strokes, a shot on each, par 8 → E. Tied, then by name.
    expect(board.rows.slice(0, 2).map((r) => [r.name, r.position, r.netToPar])).toEqual([
      ["Eire", "T1", 0],
      ["Seán", "T1", 0],
    ]);
  });

  it("counts a picked-up hole as zero points and net double on the card", () => {
    const board = buildBoard("stableford", card, players.slice(0, 1), sheet({ 1: { 1: null } }));
    expect(board.rows[0]).toMatchObject({ thru: 1, points: 0, gross: 7, netToPar: 2 });
  });

  it("flags a card without stroke indexes", () => {
    expect(buildBoard("stableford", blankCard(18), players, sheet({ 1: { 1: 4 } })).cardIncomplete).toBe(true);
  });
});

describe("live-scoring.ts singles matchplay", () => {
  const a: LivePlayer = { id: 1, name: "Eire", playingHandicap: 19 };
  const b: LivePlayer = { id: 2, name: "Ciarán", playingHandicap: 10 };

  it("gives the higher handicap the difference, by stroke index", () => {
    const m = matchState(card, a, b, sheet({}))!;
    expect(m.shots).toEqual([9, 0]);
    expect(m.label).toBe("All square");
  });

  it("tracks holes up, dormie and a finished match", () => {
    // Hole 1 (SI 7): Eire gets a shot. 5 net 4 vs 4 → halved.
    // Hole 2 (SI 13): no shot. 4 vs 5 → won.
    // Hole 3 (SI 3): shot. 5 net 4 vs 5 → won.
    let m = matchState(card, a, b, sheet({ 1: { 1: 5, 2: 4, 3: 5 }, 2: { 1: 4, 2: 5, 3: 5 } }))!;
    expect(m.results.map((r) => r.result)).toEqual(["halved", "won", "won"]);
    expect(m.label).toBe("2 UP");
    expect(m.holesLeft).toBe(15);

    // Level handicaps: two holes won, fourteen halved, two to play.
    const even: LivePlayer = { ...a, playingHandicap: 10 };
    const eire = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [i + 1, 4]));
    const ciaran = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [i + 1, i < 2 ? 6 : 4]));
    m = matchState(card, even, b, sheet({ 1: eire, 2: ciaran }))!;
    expect(m.label).toBe("Dormie 2");
    expect(m.finished).toBe(false);
  });

  it("finishes 3&2", () => {
    const eire = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [i + 1, 4]));
    const ciaran = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [i + 1, i < 3 ? 6 : 4]));
    const even: LivePlayer = { ...a, playingHandicap: 10 };
    const m = matchState(card, even, b, sheet({ 1: eire, 2: ciaran }))!;
    expect(m.up).toBe(3);
    expect(m.finished).toBe(true);
    expect(m.label).toBe("Won 3&2");
  });

  it("can't score a match on a card without stroke indexes", () => {
    expect(matchState(blankCard(18), a, b, sheet({}))).toBeNull();
  });
});

describe("live-scoring.ts team matches", () => {
  // Course handicaps 19, 10, 26, 5 (Eire, Ciarán | Aoife, Seán).
  const four: MatchPlayer[] = [
    { id: 1, name: "Eire", playingHandicap: 0, courseHandicap: 19, side: 1, position: 1 },
    { id: 2, name: "Ciarán", playingHandicap: 0, courseHandicap: 10, side: 1, position: 2 },
    { id: 3, name: "Aoife", playingHandicap: 0, courseHandicap: 26, side: 2, position: 3 },
    { id: 4, name: "Seán", playingHandicap: 0, courseHandicap: 5, side: 2, position: 4 },
  ];

  it("fourball: 90% each, shots off the lowest", () => {
    // 17.1→17, 9, 23.4→23, 4.5→5. Off Seán's 5: 12, 4, 18, 0.
    const c = matchCompetitors("fourball", four);
    expect(c.map((x) => [x.key, x.matchHandicap, x.shots])).toEqual([
      ["p1", 17, 12],
      ["p2", 9, 4],
      ["p3", 23, 18],
      ["p4", 5, 0],
    ]);
  });

  it("foursomes: half the pair's combined handicaps; greensomes: 60/40", () => {
    // Blues (19+10)/2 = 14.5→15; Golds (26+5)/2 = 15.5→16. Golds get 1.
    expect(matchCompetitors("foursomes", four).map((x) => [x.key, x.matchHandicap, x.shots])).toEqual([
      ["side1", 15, 0],
      ["side2", 16, 1],
    ]);
    // Blues 0.6×10 + 0.4×19 = 13.6→14; Golds 0.6×5 + 0.4×26 = 13.4→13.
    expect(matchCompetitors("greensomes", four).map((x) => x.shots)).toEqual([1, 0]);
  });

  it("fourball counts the better net ball of each side, once all four have scored", () => {
    // Hole 1 is SI 7: Eire (12 shots) and Aoife (18) get one, Ciarán (4) and Seán (0) don't.
    let m = teamMatchState("fourball", card, four, sheet({ 1: { 1: 5 }, 2: { 1: 3 }, 3: { 1: 6 } }))!;
    expect(m.holes).toEqual([]); // Seán hasn't scored yet
    m = teamMatchState("fourball", card, four, sheet({ 1: { 1: 5 }, 2: { 1: 3 }, 3: { 1: 6 }, 4: { 1: 4 } }))!;
    expect(m.holes[0]).toEqual({ hole: 1, result: "won", net: [3, 4], counting: [2, 4] });
    expect([m.leader, m.margin]).toEqual([1, "1 UP"]);
  });

  it("a side that picks up on both balls loses the hole; both picking up halves it", () => {
    const m = teamMatchState("fourball", card, four, sheet({
      1: { 1: null, 2: null }, 2: { 1: null, 2: null }, 3: { 1: 7, 2: null }, 4: { 1: null, 2: null },
    }))!;
    expect(m.holes.map((h) => h.result)).toEqual(["lost", "halved"]);
    expect([m.leader, m.margin]).toEqual([2, "1 UP"]);
  });

  it("foursomes reads the pair's one ball from its first player", () => {
    // Hole 4 is SI 15: Golds' single shot (SI 1) doesn't apply.
    const m = teamMatchState("foursomes", card.slice(0, 18), four, sheet({
      1: { 1: 4 }, 3: { 1: 5 },
    }))!;
    expect(m.holes[0].result).toBe("won");
    expect(m.holes[0].counting).toEqual([1, 2, 3, 4]); // each pair's one ball
  });

  it("finishes a match early and scores it 3&2, dormie on the way", () => {
    const even = four.map((p) => ({ ...p, courseHandicap: 10 }));
    const blue = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [i + 1, 4]));
    const gold = (n: number, lose: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [i + 1, i < lose ? 6 : 4]));
    let m = teamMatchState("fourball", card, even, sheet({ 1: blue(16), 2: blue(16), 3: gold(16, 2), 4: gold(16, 2) }))!;
    expect([m.margin, m.dormie, m.finished]).toEqual(["2 UP", true, false]);
    m = teamMatchState("fourball", card, even, sheet({ 1: blue(16), 2: blue(16), 3: gold(16, 3), 4: gold(16, 3) }))!;
    expect([m.margin, m.finished, m.leader]).toEqual(["3&2", true, 1]);
    expect(matchPoints(m)).toEqual([1, 0]);
  });

  it("scores team points, projected and final", () => {
    const even = four.map((p) => ({ ...p, courseHandicap: 10 }));
    const live = teamMatchState("fourball", card, even, sheet({ 1: { 1: 4 }, 2: { 1: 4 }, 3: { 1: 5 }, 4: { 1: 5 } }))!;
    expect(matchPoints(live)).toEqual([0, 0]);
    expect(matchPoints(live, true)).toEqual([1, 0]);
    const notStarted = teamMatchState("fourball", card, even, sheet({}))!;
    expect(matchPoints(notStarted, true)).toEqual([0, 0]);
    expect([pointsLabel(1.5), pointsLabel(0.5), pointsLabel(2), pointsLabel(0)]).toEqual(["1½", "½", "2", "0"]);
  });

  it("plays a match on a card that is still being filled in, up to the first hole without an index", () => {
    // What testers did on 7 Oct: indexes entered hole by hole as they went.
    const partial = card.map((h) => (h.hole <= 3 ? h : { ...h, strokeIndex: null }));
    const sc = sheet({ 1: { 1: 5, 2: 4, 3: 4, 4: 3 }, 2: { 1: 3, 2: 4, 3: 4, 4: 3 }, 3: { 1: 6, 2: 5, 3: 4, 4: 3 }, 4: { 1: 4, 2: 4, 3: 5, 4: 3 } });
    const m = teamMatchState("fourball", partial, four, sc)!;
    const full = teamMatchState("fourball", card, four, sc)!;
    expect(m.holes).toEqual(full.holes.slice(0, 3)); // same answer as the full card
    expect(m.waitingForIndex).toBe(4);
    expect(full.waitingForIndex).toBeNull();
  });

  it("needs no index at all when nobody gets a shot", () => {
    const even = four.map((p) => ({ ...p, courseHandicap: 10 }));
    const m = teamMatchState("fourball", blankCard(18), even, sheet({ 1: { 1: 4 }, 2: { 1: 4 }, 3: { 1: 5 }, 4: { 1: 5 } }))!;
    expect([m.holes.length, m.margin, m.waitingForIndex]).toEqual([1, "1 UP", null]);
  });

  it("shotsSoFar reads a hole's index straight off the card, and matches the full card", () => {
    const partial = card.map((h, i) => (i % 2 ? { ...h, strokeIndex: null } : h));
    for (const hcp of [0, 5, 18, 22, -3]) {
      const sofar = shotsSoFar(hcp, partial);
      const full = shotsByHole(hcp, card)!;
      for (const [hole, s] of sofar) expect([hole, s]).toEqual([hole, full.get(hole)]);
    }
    expect(shotsSoFar(5, partial).has(2)).toBe(false); // hole 2 has no index yet
    // A 9-hole round marked from an 18-hole card can't be ranked until it's full.
    const nine: CardHole[] = [{ hole: 1, par: 4, strokeIndex: 15 }, ...blankCard(9).slice(1)];
    expect(shotsSoFar(4, nine).size).toBe(0);
  });

  it("singles through the same path matches the singles function", () => {
    const a = { id: 1, name: "Eire", playingHandicap: 19, courseHandicap: 19, side: 1, position: 1 };
    const b = { id: 2, name: "Ciarán", playingHandicap: 10, courseHandicap: 10, side: 2, position: 2 };
    const sc = sheet({ 1: { 1: 5, 2: 4, 3: 5 }, 2: { 1: 4, 2: 5, 3: 5 } });
    const t = teamMatchState("matchplay", card, [a, b], sc)!;
    const s = matchState(card, a, b, sc)!;
    expect(t.holes.map((h) => h.result)).toEqual(s.results.map((r) => r.result));
    expect(t.up).toBe(s.up);
  });
});

describe("live-scoring.ts is shared", () => {
  it("is byte-identical in the website and the app", () => {
    const site = readFileSync(join(process.cwd(), "src/lib/live-scoring.ts"), "utf8");
    const app = readFileSync(join(process.cwd(), "mobile/src/lib/live-scoring.ts"), "utf8");
    expect(app).toBe(site);
  });
});

describe("scramble (0113)", () => {
  it("four-person: 25/20/15/10 lowest first, summed then rounded once", () => {
    // 4×.25 + 10×.2 + 18×.15 + 25×.1 = 1 + 2 + 2.7 + 2.5 = 8.2 → 8
    expect(scrambleHandicap([18, 4, 25, 10])).toEqual({ team: 8, shares: [2.7, 1, 2.5, 2] });
  });
  it("two-person: 35% of the lower, 15% of the higher", () => {
    // 6×.35 + 20×.15 = 2.1 + 3 = 5.1 → 5
    expect(scrambleHandicap([20, 6]).team).toBe(5);
    // 9×.35 + 12×.15 = 3.15 + 1.8 = 4.95 → 5 (half up)
    expect(scrambleHandicap([9, 12]).team).toBe(5);
  });
  it("a plus handicapper is the lowest", () => {
    // -2×.35 + 10×.15 = -0.7 + 1.5 = 0.8 → 1
    expect(scrambleHandicap([10, -2]).team).toBe(1);
  });
  it("refuses other sizes", () => {
    expect(() => scrambleHandicap([1, 2, 3])).toThrow();
  });
  it("counts drives and works out who still owes them", () => {
    const counts = driveCounts(new Map([[1, 1], [2, 1], [3, 2], [4, 3]]), [1, 2, 3, 4]);
    expect([...counts]).toEqual([[1, 2], [2, 1], [3, 1], [4, 0]]);
    expect(driveShortfall(counts, 3, 14)).toEqual({
      needs: [{ position: 1, needed: 1 }, { position: 2, needed: 2 }, { position: 3, needed: 2 }, { position: 4, needed: 3 }],
      impossible: false,
      tight: false,
    });
    expect(driveShortfall(counts, 3, 8).tight).toBe(true);
    expect(driveShortfall(counts, 3, 7).impossible).toBe(true);
    expect(driveShortfall(counts, null, 0).needs).toEqual([]);
  });
});

describe("foursomes as a competition (0136)", () => {
  it("plays off half the pair's combined course handicaps, rounded once", () => {
    // (9 + 18) × .5 = 13.5 → 14 — not 5 + 9 = 14 by luck: 9 + 17 = 13
    expect(foursomesHandicap([9, 18])).toBe(14);
    expect(foursomesHandicap([9, 17])).toBe(13);
    expect(foursomesHandicap([-2, 5])).toBe(2); // 1.5 → 2 (half up)
    expect(() => foursomesHandicap([9])).toThrow();
  });
  it("is the same figure the foursomes match uses", () => {
    const pairs: MatchPlayer[] = [
      { id: 1, name: "A", playingHandicap: 0, courseHandicap: 9, side: 1, position: 1 },
      { id: 2, name: "B", playingHandicap: 0, courseHandicap: 18, side: 1, position: 2 },
      { id: 3, name: "C", playingHandicap: 0, courseHandicap: 3, side: 2, position: 3 },
      { id: 4, name: "D", playingHandicap: 0, courseHandicap: 4, side: 2, position: 4 },
    ];
    expect(matchCompetitors("foursomes", pairs).map((c) => c.matchHandicap)).toEqual([foursomesHandicap([9, 18]), foursomesHandicap([3, 4])]);
  });
  it("the first player tees off the odd holes, the partner the even ones", () => {
    expect([1, 2, 3, 10, 17, 18].map(foursomesTeeShot)).toEqual([1, 2, 1, 2, 1, 2]);
  });
  it("a pair on a Stableford board is one player off the pair's handicap", () => {
    const b = buildBoard("stableford", card, [{ id: 1, name: "A & B", playingHandicap: foursomesHandicap([9, 18]) }], sheet({ 1: { 1: 4, 2: 5 } }));
    // 14 shots: holes SI 7 and 13 each get one. Par 4 net 3 = 3 pts; par 4, 5 net 4 = 2 pts.
    expect(b.rows[0].points).toBe(5);
  });
});

describe("greensomes pairs (0173)", () => {
  it("plays off 60% of the lower course handicap and 40% of the higher, rounded once", async () => {
    const { greensomesHandicap, pairsLabel } = await import("./live-scoring");
    expect(greensomesHandicap([18, 9])).toBe(13); // 5.4 + 7.2 = 12.6
    expect(greensomesHandicap([10, 10])).toBe(10);
    expect(greensomesHandicap([0, 3])).toBe(1); // 1.2
    expect(() => greensomesHandicap([9])).toThrow();
    expect(pairsLabel("stableford", true)).toBe("Greensomes Stableford");
    expect(pairsLabel("stroke", false)).toBe("Foursomes stroke play");
  });
});

describe("shotgun starts (0173)", () => {
  const card = [4, 4, 3, 5, 4, 5, 4, 4, 3, 4, 3, 5, 4, 5, 3, 4, 3, 4].map((par, i) => ({ hole: i + 1, par }));

  it("one group a hole from the 1st while there are holes enough", async () => {
    const { shotgunStarts } = await import("./live-scoring");
    expect(shotgunStarts(card, 3)).toEqual([
      { hole: 1, letter: "A" },
      { hole: 2, letter: "A" },
      { hole: 3, letter: "A" },
    ]);
    expect(shotgunStarts(card, 0)).toEqual([]);
  });

  it("33 groups: every hole an A, B groups on the par 5s and 4s first, par 3s only after", async () => {
    const { shotgunStarts } = await import("./live-scoring");
    const s = shotgunStarts(card, 33);
    expect(s).toHaveLength(33);
    const bs = s.filter((x) => x.letter === "B").map((x) => x.hole);
    expect(bs).toHaveLength(15);
    // All 13 par 4s and 5s, then the first two par 3s.
    for (const h of [1, 2, 4, 5, 6, 7, 8, 10, 12, 13, 14, 16, 18, 3, 9]) expect(bs).toContain(h);
    for (const h of [11, 15, 17]) expect(bs).not.toContain(h);
    expect(shotgunStarts(card, 22).filter((x) => x.letter === "B").map((x) => x.hole)).toEqual([4, 6, 12, 14]);
    // In hole order, A before B.
    expect(s.slice(0, 4)).toEqual([
      { hole: 1, letter: "A" },
      { hole: 1, letter: "B" },
      { hole: 2, letter: "A" },
      { hole: 2, letter: "B" },
    ]);
    expect(new Set(s.map((x) => `${x.hole}${x.letter}`)).size).toBe(33);
  });

  it("36 groups at most on 18 holes", async () => {
    const { shotgunStarts } = await import("./live-scoring");
    expect(shotgunStarts(card, 36).filter((x) => x.letter === "B")).toHaveLength(18);
    expect(() => shotgunStarts(card, 37)).toThrow(/36 groups/);
  });

  it("plays from the start hole round to the one before", async () => {
    const { playOrder, startLabel } = await import("./live-scoring");
    expect(playOrder(card, 7).map((h) => h.hole)).toEqual([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 1, 2, 3, 4, 5, 6]);
    expect(playOrder(card, null).map((h) => h.hole)[0]).toBe(1);
    expect(playOrder(card, 1).map((h) => h.hole)[17]).toBe(18);
    expect(startLabel({ hole: 7, letter: "B" })).toBe("7B");
    expect(startLabel({ hole: 7, letter: "A" }, true)).toBe("7");
    expect(startLabel(null)).toBe("");
  });
});

describe("team handicaps set by hand (0189)", () => {
  it("reads and writes plus team handicaps with a plus, whole numbers only", () => {
    expect(parseTeamHandicap("9")).toBe(9);
    expect(parseTeamHandicap(" +2 ")).toBe(-2);
    expect(parseTeamHandicap("0")).toBe(0);
    expect(parseTeamHandicap("+0")).toBe(0);
    expect(parseTeamHandicap("9.5")).toBeNull();
    expect(parseTeamHandicap("55")).toBeNull();
    expect(parseTeamHandicap("+11")).toBeNull();
    expect(parseTeamHandicap("")).toBeNull();
    expect(teamHandicapLabel(-2)).toBe("+2");
    expect(teamHandicapLabel(9)).toBe("9");
    expect(stepTeamHandicap(54, 1)).toBe(54);
    expect(stepTeamHandicap(-10, -1)).toBe(-10);
    expect(stepTeamHandicap(0, -1)).toBe(-1);
  });

  it("explains a scramble team's figure, lowest handicap taking the biggest share", () => {
    const b = teamHandicapBreakdown("scramble", [14, 5, 25, 19]);
    expect(b.team).toBe(scrambleHandicap([14, 5, 25, 19]).team);
    expect(b.rows.map((r) => r.percent)).toEqual([20, 25, 10, 15]);
    expect(b.rows[1]).toEqual({ courseHandicap: 5, percent: 25, share: 1.3 });
    expect(b.rule).toMatch(/Teams of 4: 25% \/ 20% \/ 15% \/ 10%/);
    expect(teamHandicapBreakdown("scramble", [9, 20]).rows.map((r) => r.percent)).toEqual([35, 15]);
  });

  it("explains a foursomes and a greensomes pair", () => {
    const f = teamHandicapBreakdown("foursomes", [9, 18]);
    expect(f.team).toBe(foursomesHandicap([9, 18]));
    expect(f.rows.map((r) => r.share)).toEqual([4.5, 9]);
    const g = teamHandicapBreakdown("greensomes", [19, 9]);
    expect(g.team).toBe(13);
    expect(g.rows).toEqual([
      { courseHandicap: 19, percent: 40, share: 7.6 },
      { courseHandicap: 9, percent: 60, share: 5.4 },
    ]);
  });
});
