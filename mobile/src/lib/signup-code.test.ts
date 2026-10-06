import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { cleanCode, codeErrorMessage, isCompleteCode } from "./signup-code";

describe("cleanCode", () => {
  it("keeps digits only, so a pasted '123 456' or '123-456' works", () => {
    expect(cleanCode("123 456")).toBe("123456");
    expect(cleanCode("123-456")).toBe("123456");
    expect(cleanCode(" 12a34b56 ")).toBe("123456");
  });

  it("stops at the longest code Supabase can send", () => {
    expect(cleanCode("123456789012")).toBe("1234567890");
  });
});

describe("isCompleteCode", () => {
  it("accepts 6 to 10 digits", () => {
    expect(isCompleteCode("12345")).toBe(false);
    expect(isCompleteCode("123456")).toBe(true);
    expect(isCompleteCode("12345678")).toBe(true);
    expect(isCompleteCode("1234567890")).toBe(true);
  });
});

describe("codeErrorMessage", () => {
  it("explains a wrong or expired code", () => {
    expect(codeErrorMessage("Token has expired or is invalid")).toMatch(/isn't right or has expired/);
  });

  it("explains being rate limited", () => {
    expect(codeErrorMessage("Too many requests")).toMatch(/Too many tries/);
  });

  it("never shows a raw error", () => {
    expect(codeErrorMessage("connection reset at 10.0.0.4")).not.toContain("10.0.0.4");
    expect(codeErrorMessage(undefined)).toMatch(/Couldn't confirm/);
  });
});
