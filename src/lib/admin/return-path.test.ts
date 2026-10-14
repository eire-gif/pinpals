import { describe, expect, it } from "vitest";
import { adminReturnPath } from "./return-path";

describe("adminReturnPath", () => {
  it("returns to admin pages", () => {
    expect(adminReturnPath("/admin/advertising")).toBe("/admin/advertising");
    expect(adminReturnPath("/admin/advertising/12?saved=1")).toBe("/admin/advertising/12?saved=1");
    expect(adminReturnPath("/admin")).toBe("/admin");
  });

  it("falls back to the Overview for anything else", () => {
    for (const bad of ["", "/", "/login", "https://evil.example/admin", "//evil.example/admin", "/admin//evil", "/administrator", "/admin/\\evil", "/admin/<script>", "/admin/" + "x".repeat(400)]) {
      expect(adminReturnPath(bad)).toBe("/admin");
    }
  });
});
