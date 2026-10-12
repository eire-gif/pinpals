import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { membershipLabel } from "./membership-number";

describe("membershipLabel", () => {
  it("names the number for each country", () => {
    expect(membershipLabel("ireland").title).toBe("Golf Ireland membership number");
    expect(membershipLabel("northern-ireland").aka).toMatch(/GUI/);
    expect(membershipLabel("england").title).toBe("England Golf membership number");
    expect(membershipLabel("scotland").title).toBe("Scottish Golf ID");
    expect(membershipLabel("wales").aka).toBeNull();
    expect(membershipLabel("spain").title).toBe("Número de licencia");
    expect(membershipLabel("portugal").title).toBe("Número de federado");
  });

  it("falls back to Ireland's wording", () => {
    expect(membershipLabel(null)).toEqual(membershipLabel("ireland"));
    expect(membershipLabel("france")).toEqual(membershipLabel("ireland"));
  });

  it("is byte-identical in the website and the app", () => {
    const site = readFileSync(path.join(__dirname, "membership-number.ts"), "utf8");
    const app = readFileSync(path.join(__dirname, "../../mobile/src/lib/membership-number.ts"), "utf8");
    expect(app).toBe(site);
  });
});
