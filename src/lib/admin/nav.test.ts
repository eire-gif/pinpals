import { describe, expect, it } from "vitest";
import { NAV_SECTIONS, activeHref, navFor } from "./nav";

describe("admin nav", () => {
  it("shows every section to a super admin, Platform included", () => {
    const titles = navFor("super_admin").map((s) => s.title);
    expect(titles).toEqual([null, "Community", "Marketplace", "Money", "Advertising", "Content", "Safety", "Platform"]);
  });

  it("hides Money, Orders and Platform from a moderator", () => {
    const sections = navFor("moderator");
    const hrefs = sections.flatMap((s) => s.items.map((i) => i.href));
    expect(sections.map((s) => s.title)).not.toContain("Money");
    expect(sections.map((s) => s.title)).not.toContain("Platform");
    expect(hrefs).not.toContain("/admin/orders");
    expect(hrefs).toContain("/admin/groups");
  });

  it("gives finance the money pages but not staff or the audit log", () => {
    const hrefs = navFor("finance").flatMap((s) => s.items.map((i) => i.href));
    expect(hrefs).toContain("/admin/payouts/ledger");
    expect(hrefs).not.toContain("/admin/staff");
    expect(hrefs).not.toContain("/admin/audit-log");
  });

  it("uses plain-English labels", () => {
    const labels = NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.label));
    expect(labels).toContain("Tee times");
    expect(labels.some((l) => l.includes("-"))).toBe(false);
  });

  it("highlights the most specific match", () => {
    const sections = navFor("super_admin");
    expect(activeHref("/admin", sections)).toBe("/admin");
    expect(activeHref("/admin/payouts/ledger/4", sections)).toBe("/admin/payouts/ledger");
    expect(activeHref("/admin/payouts/abc", sections)).toBe("/admin/payouts");
    expect(activeHref("/admin/news/sources", sections)).toBe("/admin/news/sources");
    expect(activeHref("/admin/groups/events", sections)).toBe("/admin/groups");
    expect(activeHref("/admin/usersx", sections)).toBe(null);
  });
});
