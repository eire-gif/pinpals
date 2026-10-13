import { describe, expect, it } from "vitest";
import {
  BULK_LIMIT,
  CONTROL_ENTITIES,
  ENTITY_CONTROLS,
  bulkConfirmationPhrase,
  bulkVerbsFor,
  canEdit,
  canUseVerb,
  checkPermanentDelete,
  confirmationMatches,
  confirmationName,
  diffValues,
  parseEdit,
  parseIds,
  readReason,
  verbsFor,
} from "./controls";
import type { StaffRole } from "./roles";

const as = (role: StaffRole, status = "active") => ({ role, status });

describe("permissions", () => {
  it("only super admins can delete anything permanently", () => {
    for (const entity of CONTROL_ENTITIES) {
      if (!ENTITY_CONTROLS[entity].verbs.delete) continue;
      expect(canUseVerb(as("super_admin"), entity, "delete")).toBe(true);
      for (const role of ["support", "moderator", "finance", "admin"] as const) {
        expect(canUseVerb(as(role), entity, "delete"), `${role} deleting ${entity}`).toBe(false);
      }
    }
  });

  it("moderators can hide and restore member content", () => {
    for (const entity of ["post", "post_comment", "course_review", "review", "listing", "tee_time", "group", "outing"] as const) {
      expect(canUseVerb(as("moderator"), entity, "hide")).toBe(true);
      expect(canUseVerb(as("moderator"), entity, "restore")).toBe(true);
    }
  });

  it("support is read-only", () => {
    for (const entity of CONTROL_ENTITIES) {
      for (const verb of ["hide", "restore", "remove", "add_back", "delete"] as const) {
        expect(canUseVerb(as("support"), entity, verb)).toBe(false);
      }
      if (entity !== "article") expect(canEdit(as("support"), entity)).toBe(false);
    }
  });

  it("admins edit; moderators don't", () => {
    for (const entity of ["listing", "group", "outing", "post", "store", "club"] as const) {
      expect(canEdit(as("admin"), entity)).toBe(true);
      expect(canEdit(as("moderator"), entity)).toBe(false);
    }
  });

  it("member profiles are edited by super admins only, as before", () => {
    expect(canEdit(as("admin"), "user")).toBe(false);
    expect(canEdit(as("super_admin"), "user")).toBe(true);
  });

  it("force-removing a listing stays super admin only", () => {
    expect(canUseVerb(as("admin"), "listing", "remove")).toBe(false);
    expect(canUseVerb(as("super_admin"), "listing", "remove")).toBe(true);
  });

  it("courses are hidden by admins, not moderators", () => {
    expect(canUseVerb(as("moderator"), "club", "hide")).toBe(false);
    expect(canUseVerb(as("admin"), "club", "hide")).toBe(true);
  });

  it("pro shops keep the finance roles they already had", () => {
    expect(canUseVerb(as("finance"), "store", "hide")).toBe(true);
    expect(canUseVerb(as("moderator"), "store", "hide")).toBe(false);
  });

  it("a disabled staff member can do nothing", () => {
    expect(canUseVerb(as("super_admin", "disabled"), "post", "hide")).toBe(false);
    expect(canEdit(as("super_admin", "disabled"), "post")).toBe(false);
    expect(canUseVerb(null, "post", "hide")).toBe(false);
  });
});

describe("verbsFor", () => {
  it("offers hide on a visible row and restore on a hidden one", () => {
    expect(verbsFor(as("moderator"), "post", { hidden: false })).toEqual(["hide"]);
    expect(verbsFor(as("moderator"), "post", { hidden: true })).toEqual(["restore"]);
    expect(verbsFor(as("super_admin"), "post", { hidden: false })).toEqual(["hide", "delete"]);
  });

  it("offers cancel / re-open for events", () => {
    expect(verbsFor(as("moderator"), "outing", { hidden: false, removed: false })).toEqual(["hide", "remove"]);
    expect(verbsFor(as("moderator"), "outing", { hidden: false, removed: true })).toEqual(["hide", "add_back"]);
  });

  it("offers remove on a live listing to super admins only", () => {
    expect(verbsFor(as("admin"), "listing", { hidden: false })).toEqual(["hide"]);
    expect(verbsFor(as("super_admin"), "listing", { hidden: false })).toEqual(["hide", "remove", "delete"]);
    expect(verbsFor(as("super_admin"), "listing", { hidden: true })).toEqual(["restore", "delete"]);
  });

  it("doesn't offer Hide where it doesn't apply", () => {
    expect(verbsFor(as("super_admin"), "listing", { hidden: false, hideable: false })).toEqual(["remove", "delete"]);
  });

  it("bulk offers every verb the role may use", () => {
    expect(bulkVerbsFor(as("moderator"), "post")).toEqual(["hide", "restore"]);
    expect(bulkVerbsFor(as("support"), "post")).toEqual([]);
  });
});

describe("checkPermanentDelete", () => {
  it("never hard-deletes a member: it starts account deletion", () => {
    expect(
      checkPermanentDelete({ entity: "user", isStaff: false, isSelf: false, blockedReason: null, pendingDeletion: false })
    ).toEqual({ allowed: true, mode: "account_deletion" });
  });

  it("refuses a member with money in motion, a staff member, yourself, or one already going", () => {
    const base = { entity: "user" as const, isStaff: false, isSelf: false, blockedReason: null, pendingDeletion: false };
    expect(checkPermanentDelete({ ...base, blockedReason: "Order #4 is in dispute." })).toEqual({
      allowed: false,
      reason: "Order #4 is in dispute.",
    });
    expect(checkPermanentDelete({ ...base, isStaff: true }).allowed).toBe(false);
    expect(checkPermanentDelete({ ...base, isSelf: true }).allowed).toBe(false);
    expect(checkPermanentDelete({ ...base, pendingDeletion: true }).allowed).toBe(false);
  });

  it("refuses a listing linked to an order, a paid promotion, offers or an auction", () => {
    const clean = { entity: "listing" as const, orders: 0, offers: 0, auctions: 0, promotions: 0 };
    expect(checkPermanentDelete(clean)).toEqual({ allowed: true, mode: "hard" });
    for (const key of ["orders", "offers", "auctions", "promotions"] as const) {
      const check = checkPermanentDelete({ ...clean, [key]: 1 });
      expect(check.allowed, key).toBe(false);
      if (!check.allowed) expect(check.reason).toMatch(/instead/);
    }
  });

  it("refuses a course anyone uses, and says where", () => {
    const check = checkPermanentDelete({
      entity: "club",
      references: [
        { label: "home-club members", count: 3 },
        { label: "tee times", count: 0 },
      ],
    });
    expect(check.allowed).toBe(false);
    if (!check.allowed) {
      expect(check.reason).toContain("3 home-club members");
      expect(check.reason).not.toContain("tee times");
    }
    expect(checkPermanentDelete({ entity: "club", references: [{ label: "tee times", count: 0 }] }).allowed).toBe(true);
  });

  it("refuses groups and events with payment records", () => {
    expect(checkPermanentDelete({ entity: "group", payments: 2, results: 0 }).allowed).toBe(false);
    expect(checkPermanentDelete({ entity: "group", payments: 0, results: 1 }).allowed).toBe(false);
    expect(checkPermanentDelete({ entity: "group", payments: 0, results: 0 }).allowed).toBe(true);
    expect(checkPermanentDelete({ entity: "outing", payments: 1 }).allowed).toBe(false);
    expect(checkPermanentDelete({ entity: "outing", payments: 0 }).allowed).toBe(true);
  });

  it("refuses a shop with orders or listings", () => {
    expect(checkPermanentDelete({ entity: "store", orders: 1, listings: 0 }).allowed).toBe(false);
    expect(checkPermanentDelete({ entity: "store", orders: 0, listings: 2 }).allowed).toBe(false);
    expect(checkPermanentDelete({ entity: "store", orders: 0, listings: 0 }).allowed).toBe(true);
  });

  it("keeps published and retracted articles on the record", () => {
    expect(checkPermanentDelete({ entity: "article", status: "published" }).allowed).toBe(false);
    expect(checkPermanentDelete({ entity: "article", status: "retracted" }).allowed).toBe(false);
    expect(checkPermanentDelete({ entity: "article", status: "draft" }).allowed).toBe(true);
  });

  it("lets member content go", () => {
    for (const entity of ["post", "post_comment", "course_review", "review", "tee_time"] as const) {
      expect(checkPermanentDelete({ entity }).allowed).toBe(true);
    }
  });
});

describe("confirmation", () => {
  it("matches case-insensitively with whitespace collapsed", () => {
    expect(confirmationMatches("Ping G425 Driver", "  ping   g425 driver ")).toBe(true);
    expect(confirmationMatches("Ping G425 Driver", "Ping G425")).toBe(false);
    expect(confirmationMatches("", "")).toBe(false);
  });

  it("falls back to noun and id when there's no usable title", () => {
    expect(confirmationName("post_comment", 12, null)).toBe("comment #12");
    expect(confirmationName("listing", 3, "Driver")).toBe("Driver");
    expect(confirmationName("post", 9, "x".repeat(200))).toBe("post #9");
    expect(bulkConfirmationPhrase(4)).toBe("delete 4");
  });
});

describe("parseEdit", () => {
  const fields = ENTITY_CONTROLS.group.edit!.fields!;

  it("accepts a valid edit and nulls an empty optional field", () => {
    expect(parseEdit(fields, { name: " Tuesday Crew ", about: "  " })).toEqual({
      ok: true,
      values: { name: "Tuesday Crew", about: null },
    });
  });

  it("enforces required and length", () => {
    expect(parseEdit(fields, { name: "" })).toEqual({ ok: false, error: "Name is required." });
    expect(parseEdit(fields, { name: "x".repeat(61) }).ok).toBe(false);
  });

  it("only accepts listed values for a select", () => {
    const select = [{ name: "p", label: "P", kind: "select" as const, required: true, options: [{ value: "a", label: "A" }] }];
    expect(parseEdit(select, { p: "a" })).toEqual({ ok: true, values: { p: "a" } });
    expect(parseEdit(select, { p: "b" }).ok).toBe(false);
  });

  it("checks number ranges", () => {
    const review = ENTITY_CONTROLS.review.edit!.fields!;
    expect(parseEdit(review, { rating: "6", body: "" }).ok).toBe(false);
    expect(parseEdit(review, { rating: "2.5", body: "" }).ok).toBe(false);
    expect(parseEdit(review, { rating: "4", body: "Fine" })).toEqual({ ok: true, values: { rating: 4, body: "Fine" } });
  });

  it("keeps a non-nullable empty text as an empty string", () => {
    const post = ENTITY_CONTROLS.post.edit!.fields!;
    expect(parseEdit(post, { body: "" })).toEqual({ ok: true, values: { body: "" } });
  });
});

describe("diffValues", () => {
  it("records only what changed, numbers compared as numbers", () => {
    expect(diffValues({ rating: "4", body: "a" }, { rating: 4, body: "b" })).toEqual({ body: { from: "a", to: "b" } });
    expect(diffValues({ about: "" }, { about: null })).toEqual({});
    expect(diffValues({ about: null }, { about: "x" })).toEqual({ about: { from: null, to: "x" } });
  });
});

describe("readReason / parseIds", () => {
  it("requires a bounded reason", () => {
    expect(readReason("  ")).toEqual({ ok: false, error: "A reason is required." });
    expect(readReason("x".repeat(501)).ok).toBe(false);
    expect(readReason(" spam ")).toEqual({ ok: true, reason: "spam" });
  });

  it("parses, de-duplicates and validates ids", () => {
    expect(parseIds(["1,2", "2", " 3 "], "bigint")).toEqual({ ok: true, ids: ["1", "2", "3"] });
    expect(parseIds(["0"], "bigint").ok).toBe(false);
    expect(parseIds(["1; drop"], "bigint").ok).toBe(false);
    expect(parseIds([], "bigint").ok).toBe(false);
    expect(parseIds(["8b7c0f7e-2d7a-4a8e-9a55-0c3f2b9d1e11"], "uuid").ok).toBe(true);
    expect(parseIds(["not-a-uuid"], "uuid").ok).toBe(false);
    const many = Array.from({ length: BULK_LIMIT + 1 }, (_, i) => String(i + 1));
    expect(parseIds(many, "bigint").ok).toBe(false);
  });
});
