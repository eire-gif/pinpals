import { describe, expect, it } from "vitest";
import { DEFAULT_POST_LOGIN_PATH, postLoginPath, safeRedirectPath } from "./safe-redirect";

describe("safeRedirectPath", () => {
  it("accepts a plain internal path", () => {
    expect(safeRedirectPath("/dashboard")).toBe("/dashboard");
    expect(safeRedirectPath("/dashboard/availability/new")).toBe("/dashboard/availability/new");
    expect(safeRedirectPath("/admin")).toBe("/admin");
  });

  it("keeps a query string and fragment", () => {
    expect(safeRedirectPath("/tee-times?county=Kerry&radius=30")).toBe("/tee-times?county=Kerry&radius=30");
    expect(safeRedirectPath("/courses/ireland#list")).toBe("/courses/ireland#list");
  });

  it("trims surrounding whitespace rather than refusing over it", () => {
    expect(safeRedirectPath("  /dashboard  ")).toBe("/dashboard");
  });

  it("refuses an absolute URL", () => {
    expect(safeRedirectPath("https://evil.example/phish")).toBeNull();
    expect(safeRedirectPath("http://pinpals.ie.evil.example")).toBeNull();
  });

  it("refuses a protocol-relative URL — the one a naive startsWith('/') lets through", () => {
    expect(safeRedirectPath("//evil.example")).toBeNull();
    expect(safeRedirectPath("//evil.example/dashboard")).toBeNull();
  });

  it("refuses the backslash variant browsers normalise to //", () => {
    expect(safeRedirectPath("/\\evil.example")).toBeNull();
  });

  it("refuses a scheme, however it is dressed up", () => {
    expect(safeRedirectPath("javascript:alert(1)")).toBeNull();
    expect(safeRedirectPath("data:text/html,<script>")).toBeNull();
    // Leading slash plus an embedded colon — refused rather than reasoned about.
    expect(safeRedirectPath("/redirect:https://evil.example")).toBeNull();
  });

  it("refuses embedded control characters used to smuggle a scheme", () => {
    expect(safeRedirectPath("/\tdashboard")).toBeNull();
    expect(safeRedirectPath("/dash\nboard")).toBeNull();
    expect(safeRedirectPath("/dash board")).toBeNull();
  });

  it("refuses anything that isn't a path at all", () => {
    expect(safeRedirectPath("dashboard")).toBeNull();
    expect(safeRedirectPath("")).toBeNull();
    expect(safeRedirectPath(null)).toBeNull();
    expect(safeRedirectPath(undefined)).toBeNull();
    expect(safeRedirectPath(42)).toBeNull();
    expect(safeRedirectPath({ toString: () => "/dashboard" })).toBeNull();
  });
});

describe("postLoginPath", () => {
  it("sends a member back where they were headed", () => {
    expect(postLoginPath("/dashboard/availability/new")).toBe("/dashboard/availability/new");
  });

  it("falls back to the dashboard for anything missing or unsafe", () => {
    expect(postLoginPath(undefined)).toBe(DEFAULT_POST_LOGIN_PATH);
    expect(postLoginPath("")).toBe(DEFAULT_POST_LOGIN_PATH);
    expect(postLoginPath("https://evil.example")).toBe(DEFAULT_POST_LOGIN_PATH);
    expect(postLoginPath("//evil.example")).toBe(DEFAULT_POST_LOGIN_PATH);
  });
});
