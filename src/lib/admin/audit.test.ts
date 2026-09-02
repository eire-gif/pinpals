import { describe, expect, it } from "vitest";
import { pickCorrelationId, sanitizeMetadata } from "./audit";

describe("sanitizeMetadata", () => {
  it("passes through plain, non-sensitive fields unchanged", () => {
    expect(sanitizeMetadata({ previousStatus: "active", newStatus: "suspended", count: 3 })).toEqual({
      previousStatus: "active",
      newStatus: "suspended",
      count: 3,
    });
  });

  it("strips keys that look like secrets, case-insensitively", () => {
    expect(
      sanitizeMetadata({
        note: "fine",
        password: "hunter2",
        apiKey: "abc",
        api_key: "abc",
        SERVICE_ROLE_KEY: "abc",
        authToken: "abc",
        Authorization: "Bearer abc",
        sessionCookie: "abc",
        clientSecret: "abc",
      })
    ).toEqual({ note: "fine" });
  });

  it("strips sensitive keys inside nested objects", () => {
    expect(
      sanitizeMetadata({
        listing: { id: 1, title: "Driver", seller: { id: "u1", token: "abc" } },
      })
    ).toEqual({ listing: { id: 1, title: "Driver", seller: { id: "u1" } } });
  });

  it("truncates to {} past the depth limit rather than recursing forever", () => {
    let deep: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < 10; i++) deep = { nested: deep };

    let expected: Record<string, unknown> = {};
    for (let i = 0; i < 6; i++) expected = { nested: expected };

    expect(sanitizeMetadata(deep)).toEqual(expected);
  });

  it("treats non-object input as empty metadata rather than throwing", () => {
    expect(sanitizeMetadata(null)).toEqual({});
    expect(sanitizeMetadata(undefined)).toEqual({});
    expect(sanitizeMetadata("a string")).toEqual({});
    expect(sanitizeMetadata(["array", "not", "object"])).toEqual({});
  });

  it("leaves array-valued fields alone (does not recurse into arrays)", () => {
    expect(sanitizeMetadata({ tags: ["a", "b"] })).toEqual({ tags: ["a", "b"] });
  });
});

describe("pickCorrelationId", () => {
  it("uses the Vercel request id when one is present", () => {
    expect(pickCorrelationId("req_abc123")).toBe("req_abc123");
  });

  it("falls back to a generated uuid when no request id is available", () => {
    const id = pickCorrelationId(null);
    expect(id).toMatch(/^[0-9a-f-]{36}$/i);
  });
});
