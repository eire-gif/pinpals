import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatPhone, normalisePhone, whatsappUrl } from "./phone";

const ok = (s: string) => {
  const r = normalisePhone(s);
  return r.ok ? r.e164 : `ERR ${r.error}`;
};

describe("normalisePhone", () => {
  it("takes Irish mobiles however they're written", () => {
    for (const s of ["087 123 4567", "0871234567", "+353 87 123 4567", "+353 (0)87 123 4567", "00353871234567", "087-123-4567"]) {
      expect(ok(s)).toBe("+353871234567");
    }
  });
  it("takes other countries with their code", () => {
    expect(ok("+44 7700 900123")).toBe("+447700900123");
    expect(ok("+44 (0)7700 900123")).toBe("+447700900123");
  });
  it("refuses what isn't a mobile number", () => {
    expect(ok("")).toMatch(/^ERR/);
    expect(ok("01 234 5678")).toMatch(/Irish mobile/);
    expect(ok("87 123 4567")).toMatch(/^ERR/);
    expect(ok("call me")).toMatch(/^ERR/);
    expect(ok("08712+34567")).toMatch(/^ERR/);
  });
});

describe("display and links", () => {
  it("formats and links", () => {
    expect(formatPhone("+353871234567")).toBe("087 123 4567");
    expect(formatPhone("+447700900123")).toBe("+44 7700 900123");
    expect(whatsappUrl("+353871234567")).toBe("https://wa.me/353871234567");
  });
  it("is byte-identical in the website and the app", () => {
    const site = readFileSync(path.join(__dirname, "phone.ts"), "utf8");
    const app = readFileSync(path.join(__dirname, "../../mobile/src/lib/phone.ts"), "utf8");
    expect(app).toBe(site);
  });
});
