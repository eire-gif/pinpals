import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCOPE,
  DIRECTORY_SCOPES,
  SCOPE_DESCRIPTIONS,
  SCOPE_LABELS,
  isDirectoryScope,
  parseScope,
} from "./community";

describe("directory scopes", () => {
  it("offers everyone, club and connections in that order", () => {
    expect(DIRECTORY_SCOPES).toEqual(["everyone", "club", "connections"]);
  });

  it("defaults to everyone", () => {
    // A member on their first day has no home club and no connections. If
    // either of those were the default they'd meet an empty directory and
    // conclude nobody is here.
    expect(DEFAULT_SCOPE).toBe("everyone");
  });

  it("labels and describes every scope", () => {
    for (const scope of DIRECTORY_SCOPES) {
      expect(SCOPE_LABELS[scope]).toBeTruthy();
      expect(SCOPE_DESCRIPTIONS[scope]).toBeTruthy();
    }
  });
});

describe("isDirectoryScope", () => {
  it("accepts the three real values", () => {
    expect(isDirectoryScope("everyone")).toBe(true);
    expect(isDirectoryScope("club")).toBe(true);
    expect(isDirectoryScope("connections")).toBe(true);
  });

  it("rejects anything else", () => {
    for (const value of ["", "Everyone", "connection", "my-club", "all"]) {
      expect(isDirectoryScope(value)).toBe(false);
    }
  });
});

describe("parseScope", () => {
  it("reads a valid scope", () => {
    expect(parseScope("club")).toBe("club");
    expect(parseScope("connections")).toBe("connections");
  });

  it("falls back to the default rather than filtering on nonsense", () => {
    expect(parseScope(undefined)).toBe("everyone");
    expect(parseScope("")).toBe("everyone");
    expect(parseScope("banana")).toBe("everyone");
  });
});
