import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  COMMON_MARGINS,
  EXTRA_HOLES,
  MORE_MARGINS,
  balancedGroups,
  challengeable,
  feeLabel,
  groupCount,
  groupTable,
  hoursUntilStands,
  knockoutBracket,
  marginHoles,
  myMatchState,
  seedOrder,
  shotsFromIndexes,
  type Entry,
  type Match,
} from "./matchplay";

const entry = (userId: string, handicapIndex = 10, extra: Partial<Entry> = {}): Entry => ({
  userId,
  name: userId.toUpperCase(),
  handicapIndex,
  groupLabel: "A",
  ladderPosition: null,
  withdrawn: false,
  ...extra,
});

let nextId = 1;
const match = (a: string, b: string, winner: Match["winner"], margin: string | null, extra: Partial<Match> = {}): Match => ({
  id: nextId++,
  stage: "group",
  groupLabel: "A",
  roundNo: 1,
  slot: 1,
  playerA: a,
  playerB: b,
  playBy: null,
  status: winner ? "confirmed" : "open",
  winner,
  margin,
  holesUp: margin ? marginHoles(margin, false) ?? 0 : 0,
  reportedBy: a,
  standsAt: null,
  ...extra,
});

const RULES = { pointsWin: 3, pointsHalf: 1, qualifiersPerGroup: 2 };

describe("margins", () => {
  it("knows a real matchplay result", () => {
    expect(marginHoles("3&2", false)).toBe(3);
    expect(marginHoles("3&1", false)).toBe(3); // won the 17th from dormie 2
    expect(marginHoles("10&8", false)).toBe(10);
    expect(marginHoles("2 up", false)).toBe(2);
    for (const bad of ["3&3", "5&2", "11&8", "03&02", "3 up", "", "AS"]) expect(marginHoles(bad, false)).toBeNull();
    expect(marginHoles("19th", false)).toBeNull();
    expect(marginHoles("21st", true)).toBe(1);
    for (const m of [...COMMON_MARGINS, ...MORE_MARGINS]) expect(marginHoles(m, false)).not.toBeNull();
    for (const m of EXTRA_HOLES) expect(marginHoles(m, true)).toBe(1);
  });

  it("matches the database's rule in 0148", () => {
    const sql = readFileSync(path.join(__dirname, "../../../supabase/migrations/0148_competitions.sql"), "utf8");
    expect(sql).toContain("if v in ('1 up', '2 up') then");
    expect(sql).toContain("if v ~ '^([1-9]|10)&[1-9]$' then");
    expect(sql).toContain("n in (m + 1, m + 2) and n + m <= 18");
    expect(sql).toContain("'^(19th|20th|21st|22nd|23rd|2[4-7]th)$'");
  });
});

describe("group tables", () => {
  const entries = ["a", "b", "c", "d"].map((x) => entry(x));

  it("adds points and holes, and marks the qualifiers", () => {
    const rows = groupTable(
      entries,
      [match("a", "b", "a", "3&2"), match("c", "d", "half", "AS"), match("a", "c", "b", "1 up"), match("b", "d", "a", "5&4")],
      "A",
      RULES,
    );
    expect(rows.map((r) => [r.userId, r.played, r.won, r.halved, r.lost, r.holes, r.points])).toEqual([
      ["c", 2, 1, 1, 0, 1, 4],
      ["a", 2, 1, 0, 1, 2, 3],
      ["b", 2, 1, 0, 1, 2, 3],
      ["d", 2, 0, 1, 1, -5, 1],
    ]);
    expect(rows.filter((r) => r.qualifies).map((r) => r.userId)).toEqual(["c", "a"]);
  });

  it("settles a straight two-way tie on the match between them", () => {
    const rows = groupTable(
      entries.slice(0, 3),
      [match("a", "b", "half", "AS"), match("a", "c", "a", "3&2"), match("b", "c", "a", "3&2")],
      "A",
      RULES,
    );
    // Level on points, holes and wins, and their match was halved: by name.
    expect(rows.map((r) => r.userId)).toEqual(["a", "b", "c"]);
    // m and n finish level on points (3), holes (+2) and wins (1); n beat m,
    // so n goes above m even though m comes first by name.
    const h2h = groupTable(
      ["m", "n", "o", "q"].map((u) => entry(u)),
      [match("m", "n", "b", "4&3"), match("m", "o", "a", "6&5"), match("n", "q", "b", "2&1"), match("o", "q", "half", "AS")],
      "A",
      RULES,
    );
    expect(h2h.map((r) => [r.userId, r.points, r.holes])).toEqual([
      ["q", 4, 2],
      ["n", 3, 2],
      ["m", 3, 2],
      ["o", 1, -6],
    ]);
    const tie = groupTable(
      ["x", "y", "z"].map((u) => entry(u)),
      [match("x", "y", "b", "2&1"), match("x", "z", "a", "2&1"), match("y", "z", "b", "2&1")],
      "A",
      RULES,
    );
    // Everyone on 3 points, level holes and wins: a three-way tie stays by name.
    expect(tie.map((r) => r.userId)).toEqual(["x", "y", "z"]);
  });

  it("counts reported results as provisional, and ignores open, disputed and void ones", () => {
    const rows = groupTable(
      entries,
      [
        match("a", "b", "a", "2 up", { status: "reported" }),
        match("c", "d", "a", "4&3", { status: "disputed" }),
        match("a", "c", null, null),
        match("b", "d", "b", "2&1", { status: "void" }),
      ],
      "A",
      RULES,
    );
    const a = rows.find((r) => r.userId === "a")!;
    expect([a.played, a.points, a.provisional]).toEqual([1, 3, true]);
    expect(rows.find((r) => r.userId === "c")!.played).toBe(0);
  });

  it("leaves out players who withdrew and other groups' matches", () => {
    const rows = groupTable([...entries, entry("e", 5, { withdrawn: true }), entry("f", 5, { groupLabel: "B" })], [match("a", "f", "a", "2&1", { groupLabel: "B" })], "A", RULES);
    expect(rows.map((r) => r.userId).sort()).toEqual(["a", "b", "c", "d"]);
    expect(rows.every((r) => r.played === 0)).toBe(true);
  });
});

describe("the draw", () => {
  it("picks a group count with groups of 3 to 8", () => {
    expect(groupCount(2)).toBe(0);
    expect(groupCount(3)).toBe(1);
    expect(groupCount(8)).toBe(2);
    expect(groupCount(10)).toBe(3); // 4, 3 and 3 is nearer fours than 5 and 5
    expect(groupCount(16)).toBe(4);
    expect(groupCount(30)).toBe(8);
    for (let n = 3; n <= 120; n++) {
      const g = groupCount(n);
      expect(Math.floor(n / g)).toBeGreaterThanOrEqual(3);
      expect(Math.ceil(n / g)).toBeLessThanOrEqual(8);
    }
  });

  it("balances groups by handicap with a snake", () => {
    const es = [2, 4, 6, 8, 10, 12, 14, 16].map((h, i) => entry(`p${i}`, h));
    const groups = balancedGroups(es, 2);
    expect(groups).toEqual([
      ["p0", "p3", "p4", "p7"],
      ["p1", "p2", "p5", "p6"],
    ]);
    expect(balancedGroups([...es, entry("w", 1, { withdrawn: true })], 2).flat()).not.toContain("w");
  });
});

describe("the knockout", () => {
  it("seeds so 1 and 2 meet only in the final", () => {
    expect(seedOrder(4)).toEqual([1, 4, 2, 3]);
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });

  it("keeps a group's winner and runner-up apart, and gives byes to the top seeds", () => {
    const t = (label: string, w: string, r: string, wPts = 9) => ({
      [label]: [
        { userId: w, points: wPts, played: 3, holes: 5 },
        { userId: r, points: 6, played: 3, holes: 1 },
      ],
    });
    const tables = { ...t("A", "a1", "a2", 9), ...t("B", "b1", "b2", 7), ...t("C", "c1", "c2", 6), ...t("D", "d1", "d2", 5) } as never;
    const bracket = knockoutBracket(tables, 2);
    expect(bracket).toEqual(["a1", "d2", "d1", "a2", "b1", "c2", "c1", "b2"]);

    const three = { ...t("A", "a1", "a2", 9), ...t("B", "b1", "b2", 7), ...t("C", "c1", "c2", 6) } as never;
    const withByes = knockoutBracket(three, 2);
    expect(withByes).toHaveLength(8);
    expect(withByes.filter((x) => x === null)).toHaveLength(2);
    // The top two seeds get the byes.
    expect(withByes.slice(0, 2)).toEqual(["a1", null]);
    expect(withByes.slice(4, 6)).toEqual(["b1", null]);
  });
});

describe("ladders", () => {
  it("lets you challenge up to the reach, if neither of you is busy", () => {
    const es = ["a", "b", "c", "d", "e"].map((u, i) => entry(u, 10, { groupLabel: null, ladderPosition: i + 1 }));
    expect(challengeable(es, [], "e", 2).map((x) => x.userId)).toEqual(["c", "d"]);
    expect(challengeable(es, [], "a", 3)).toEqual([]);
    const busy = match("d", "b", null, null, { stage: "ladder" });
    expect(challengeable(es, [busy], "e", 3).map((x) => x.userId)).toEqual(["c"]);
    expect(challengeable(es, [busy], "d", 3)).toEqual([]);
  });
});

describe("a match, for one player", () => {
  it("says what to do next", () => {
    expect(myMatchState({ ...match("a", "b", null, null), arrangedAt: null }, "a")).toBe("arrange");
    expect(myMatchState({ ...match("a", "b", null, null), arrangedAt: "2026-10-24T09:10:00Z" }, "a")).toBe("arranged");
    const reported = match("a", "b", "a", "3&2", { status: "reported", reportedBy: "b" });
    expect(myMatchState(reported, "a")).toBe("confirm");
    expect(myMatchState(reported, "b")).toBe("waiting");
    expect(myMatchState(match("a", "b", "a", "3&2"), "a")).toBe("done");
    expect(myMatchState({ ...match("a", "b", null, null), playerB: null }, "a")).toBe("waiting-for-opponent");
  });

  it("counts down to the result standing", () => {
    const now = new Date("2026-10-15T12:00:00Z");
    expect(hoursUntilStands("2026-10-17T10:30:00Z", now)).toBe(47);
    expect(hoursUntilStands("2026-10-15T11:00:00Z", now)).toBe(0);
  });

  it("estimates shots and shows fees", () => {
    expect(shotsFromIndexes(12.4, 15.0)).toBe(3);
    expect(shotsFromIndexes(18.6, 12.4, 135)).toBe(7);
    expect(feeLabel(1500)).toBe("€15");
    expect(feeLabel(1250)).toBe("€12.50");
    expect(feeLabel(null)).toBeNull();
  });
});
