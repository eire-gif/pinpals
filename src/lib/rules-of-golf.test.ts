import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { RULES, officialUrl, searchRules } from "./rules-of-golf";

const top = (q: string) => searchRules(q)[0]?.entry.id;

describe("rules of golf lookup", () => {
  it("is byte-identical in the app", () => {
    const site = readFileSync(join(process.cwd(), "src/lib/rules-of-golf.ts"), "utf8");
    const app = readFileSync(join(process.cwd(), "mobile/src/lib/rules-of-golf.ts"), "utf8");
    expect(app).toBe(site);
  });

  it("has all 25 Rules and the Definitions, with unique ids", () => {
    const rules = RULES.filter((e) => e.kind === "rule").map((e) => e.rule).sort((a, b) => a - b);
    expect(rules).toEqual(Array.from({ length: 26 }, (_, i) => i));
    expect(new Set(RULES.map((e) => e.id)).size).toBe(RULES.length);
  });

  it("links every entry to the R&A", () => {
    for (const e of RULES) {
      expect(officialUrl(e)).toMatch(/^https:\/\/www\.randa\.org\/rog\//);
    }
    expect(officialUrl({ rule: 18 })).toBe("https://www.randa.org/rog/the-rules-of-golf/rule-18");
    expect(officialUrl({ rule: 0 })).toBe("https://www.randa.org/rog/definitions");
  });

  it("lists the Rules in order when nothing is typed", () => {
    const list = searchRules("");
    expect(list).toHaveLength(26);
    expect(list[0].entry.id).toBe("rule-1");
    expect(list[24].entry.id).toBe("rule-25");
    expect(list[25].entry.id).toBe("definitions");
  });

  it("finds a Rule by number", () => {
    expect(top("18")).toBe("rule-18");
    expect(top("Rule 12")).toBe("rule-12");
    expect(top("18.3")).toBe("provisional-ball");
    expect(searchRules("rule 19").every((h) => h.entry.rule === 19)).toBe(true);
    expect(searchRules("26")).toHaveLength(0);
  });

  it("answers the searches golfers actually make", () => {
    expect(top("lost ball")).toBe("lost-ball");
    expect(top("OB")).toBe("out-of-bounds");
    expect(top("provisional")).toBe("provisional-ball");
    expect(top("plugged")).toBe("embedded-ball");
    expect(top("cart path")).toBe("abnormal-course-conditions");
    expect(top("how to drop")).toBe("drop-procedure");
    expect(top("15 clubs")).toBe("fourteen-clubs");
    expect(top("gimme")).toBe("concessions");
    expect(top("rangefinder")).toBe("distance-devices");
    expect(searchRules("water").slice(0, 3).map((h) => h.entry.rule)).toContain(17);
    expect(searchRules("unplayable bunker")[0].entry.id).toBe("unplayable-bunker");
  });

  it("is forgiving about case and punctuation, and strict about nonsense", () => {
    expect(top("  LOST   Ball! ")).toBe("lost-ball");
    expect(searchRules("zzzzqqq")).toHaveLength(0);
  });
});
