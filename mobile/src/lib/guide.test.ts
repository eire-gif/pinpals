import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { AUDIENCES, GUIDES, GUIDE_JOURNEY, guideById, resolveGuide, type Audience } from "./guide";

/**
 * The how-to guides (lib/guide.ts) are only worth having while they match
 * the app. These catch the ways they drift without anyone noticing.
 */

const APP_DIR = path.resolve(__dirname, "../app");

function routesOn(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      const segment = entry.startsWith("(") && entry.endsWith(")") ? "" : `/${entry}`;
      out.push(...routesOn(full, prefix + segment));
      continue;
    }
    if (!entry.endsWith(".tsx") || entry.startsWith("_")) continue;
    const name = entry.replace(/\.tsx$/, "");
    out.push(name === "index" ? prefix || "/" : `${prefix}/${name}`);
  }
  return out;
}

const audiences: Audience[] = AUDIENCES.map((a) => a.id);

describe("how-to guides", () => {
  it("every 'Take me there' opens a screen that exists", () => {
    const routes = new Set(routesOn(APP_DIR));
    for (const g of GUIDES) {
      for (const step of g.steps) {
        for (const go of [step.go, ...Object.values(step.as ?? {}).map((v) => v?.go)]) {
          if (!go) continue;
          expect(routes, `${g.id}: ${String(go.to)}`).toContain(String(go.to));
        }
      }
    }
  });

  it("every guide id is unique, and every next and journey stop is a real guide", () => {
    const ids = GUIDES.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const g of GUIDES) if (g.next) expect(guideById(g.next), g.id).toBeDefined();
    for (const a of audiences) for (const j of GUIDE_JOURNEY[a]) expect(resolveGuide(guideById(j.guide)!, a), `${a}: ${j.guide}`).not.toBeNull();
  });

  it("every guide a member can see has steps, for every kind of group", () => {
    for (const a of audiences) {
      for (const g of GUIDES) {
        const r = resolveGuide(g, a);
        if (r) expect(r.steps.length, `${g.id} for ${a}`).toBeGreaterThan(1);
      }
    }
  });

  it("friends and trips never read about society-only things", () => {
    const societyOnly = /captain|secretary|ask to join|asking to join|find a society|home club|create society/i;
    for (const a of ["friends", "trip"] as const) {
      for (const g of GUIDES) {
        const r = resolveGuide(g, a);
        if (!r || r.section !== "groups") continue;
        for (const s of r.steps) {
          const text = [s.title, s.body, s.who, s.tip, ...(s.look ?? []).map((l) => l.label)].filter(Boolean).join(" ");
          expect(text, `${g.id} for ${a}: ${s.title}`).not.toMatch(societyOnly);
        }
      }
    }
  });

  it("running a society is for societies only", () => {
    expect(resolveGuide(guideById("run")!, "friends")).toBeNull();
    expect(resolveGuide(guideById("run")!, "society")).not.toBeNull();
  });

  it("old links to the set-up guide still open it", () => {
    expect(guideById("society")?.id).toBe("start");
  });
});
