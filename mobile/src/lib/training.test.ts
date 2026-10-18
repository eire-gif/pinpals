import { describe, expect, it } from "vitest";

import { RULES } from "./rules-of-golf";
import {
  DRILLS,
  LIES,
  LIE_CATEGORIES,
  PLANS,
  WARM_UPS,
  drillById,
  forHand,
  isBetter,
  lieById,
  nextSession,
  planSessions,
  scoreLabel,
  searchLies,
  sessionMinutes,
} from "./training";

const allText = (o: unknown): string[] =>
  typeof o === "string" ? [o] : Array.isArray(o) ? o.flatMap(allText) : o && typeof o === "object" ? Object.values(o).flatMap(allText) : [];

describe("lie guides", () => {
  it("has fourteen, each with a unique id and four keys", () => {
    expect(LIES).toHaveLength(14);
    expect(new Set(LIES.map((l) => l.id)).size).toBe(LIES.length);
    for (const l of LIES) {
      expect(l.keys, l.id).toHaveLength(4);
      expect(l.onCourse, l.id).toHaveLength(3);
      expect(LIE_CATEGORIES.map((c) => c.id)).toContain(l.category);
    }
  });

  it("only links to rules that exist", () => {
    const ids = new Set(RULES.map((r) => r.id));
    for (const l of LIES) if (l.rule) expect(ids.has(l.rule.id), `${l.id} → ${l.rule.id}`).toBe(true);
  });

  it("never says a bare left or right that should flip for a left-hander", () => {
    // Handed directions are written {left}/{right}. A bare word is allowed
    // only where it is about the body, not the direction of the shot.
    const allowed = /\b(left|right)\b/i;
    for (const l of LIES) {
      for (const t of allText({ ...l, rule: undefined })) {
        const bare = t.replace(/\{(left|right)\}/g, "");
        expect(allowed.test(bare), `${l.id}: "${t}"`).toBe(false);
      }
    }
  });

  it("flips sides for a left-hander and leaves a right-hander alone", () => {
    const l = lieById("uphill")!;
    expect(forHand(l.aim, "right")).toBe("A little right");
    expect(forHand(l.aim, "left")).toBe("A little left");
    expect(forHand("turn {left}, aim {right}", "left")).toBe("turn right, aim left");
  });

  it("finds lies by what golfers type", () => {
    expect(searchLies("ball above my feet")[0]?.id).toBe("above-feet");
    expect(searchLies("fried egg")[0]?.id).toBe("plugged");
    expect(searchLies("headwind")[0]?.id).toBe("into-wind");
    expect(searchLies("")).toEqual([]);
  });
});

describe("Putting Lab", () => {
  it("has unique drills, each scored sensibly", () => {
    expect(new Set(DRILLS.map((d) => d.id)).size).toBe(DRILLS.length);
    for (const d of DRILLS) {
      expect(d.steps.length, d.id).toBeGreaterThanOrEqual(3);
      expect(d.scoring.target, d.id).toBeGreaterThan(0);
    }
    expect(DRILLS.some((d) => d.home)).toBe(true);
  });

  it("knows which way is better", () => {
    const out = drillById("gate")!.scoring;
    const streak = drillById("clock")!.scoring;
    expect(isBetter(out, 16, 15)).toBe(true);
    expect(isBetter(out, 14, 15)).toBe(false);
    expect(isBetter(streak, 12, 19)).toBe(true);
    expect(isBetter(streak, 20, 19)).toBe(false);
    expect(isBetter(streak, 20, null)).toBe(true);
  });

  it("reads scores the way a golfer says them", () => {
    expect(scoreLabel(drillById("gate")!.scoring, 17)).toBe("17/20 clean through the gate");
    expect(scoreLabel(drillById("clock")!.scoring, 11)).toBe("11 putts");
    expect(scoreLabel(drillById("par-18")!.scoring, 16)).toBe("16 putts (−2)");
    expect(scoreLabel(drillById("par-18")!.scoring, 18)).toBe("18 putts (level)");
  });
});

describe("plans", () => {
  it("only use drills and lies that exist", () => {
    for (const p of PLANS) {
      for (const { session } of planSessions(p)) {
        for (const i of session.items) {
          if ("drill" in i) expect(drillById(i.drill), `${p.id}: ${i.drill}`).toBeDefined();
          if ("lie" in i) expect(lieById(i.lie), `${p.id}: ${i.lie}`).toBeDefined();
        }
      }
    }
  });

  it("number sessions in order and find the next one", () => {
    const p = PLANS.find((x) => x.id === "kill-3-putt")!;
    const all = planSessions(p);
    expect(all).toHaveLength(12);
    expect(all.map((s) => s.index)).toEqual([...Array(12).keys()]);
    expect(nextSession(p, new Set())).toBe(0);
    expect(nextSession(p, new Set([0, 1, 2, 3, 4]))).toBe(5);
    expect(nextSession(p, new Set([...Array(12).keys()]))).toBeNull();
    expect(sessionMinutes(all[0].session)).toBe(25);
  });

  it("home plans use only drills that work at home", () => {
    for (const p of PLANS.filter((x) => x.home)) {
      for (const { session } of planSessions(p)) for (const i of session.items) if ("drill" in i) expect(drillById(i.drill)!.home, i.drill).toBe(true);
    }
  });
});

describe("warm-ups", () => {
  it("add up to the minutes they promise", () => {
    for (const w of Object.values(WARM_UPS)) expect(w.steps.reduce((n, s) => n + s.minutes, 0)).toBe(w.minutes);
  });
});
