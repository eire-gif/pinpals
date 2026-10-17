import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashParentToken, newParentToken, parentTokenFromRequest } from "./parent-link-token";

describe("parent link secrets", () => {
  it("makes a 43-character base64url secret whose SHA-256 hex is what's stored", () => {
    const { token, hash } = newParentToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashParentToken(token)).toBe(hash);
  });

  it("never hashes anything that isn't a well-formed secret", () => {
    expect(hashParentToken("")).toBeNull();
    expect(hashParentToken("short")).toBeNull();
    expect(hashParentToken(null)).toBeNull();
    expect(hashParentToken("a".repeat(42) + "!")).toBeNull();
  });

  it("reads the secret from an Authorization: Parent header only", () => {
    const token = "a".repeat(43);
    expect(parentTokenFromRequest(new Request("https://x.test", { headers: { authorization: `Parent ${token}` } }))).toBe(token);
    expect(parentTokenFromRequest(new Request("https://x.test", { headers: { authorization: `Bearer ${token}` } }))).toBeNull();
    expect(parentTokenFromRequest(new Request("https://x.test"))).toBeNull();
  });
});
