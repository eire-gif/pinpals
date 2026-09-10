import { describe, it, expect } from "vitest";
import { parseRobots, isPathAllowed, robotsPath } from "./robots";

const allows = (robotsTxt: string, path: string) =>
  isPathAllowed(parseRobots(robotsTxt), path);

describe("parseRobots / isPathAllowed", () => {
  it("allows everything when the file is empty", () => {
    expect(allows("", "/anything")).toBe(true);
  });

  it("honours the real CPG robots.txt, which is a launch source", () => {
    // Fetched from https://cpg.golf/robots.txt, September 2026.
    const cpg = `User-agent: *
Disallow: /wp-admin/
Allow: /wp-admin/admin-ajax.php

Sitemap: https://cpg.golf/sitemap.xml`;

    expect(allows(cpg, "/feed/")).toBe(true);
    expect(allows(cpg, "/wp-admin/")).toBe(false);
    // Longest match wins, so the explicit Allow beats the Disallow above it.
    expect(allows(cpg, "/wp-admin/admin-ajax.php")).toBe(true);
  });

  it("treats an empty Disallow as allow-all, not deny-all", () => {
    expect(allows("User-agent: *\nDisallow:", "/feed/")).toBe(true);
  });

  it("treats a bare slash as deny-all", () => {
    expect(allows("User-agent: *\nDisallow: /", "/feed/")).toBe(false);
  });

  it("prefers the longest matching rule", () => {
    const txt = `User-agent: *
Disallow: /news/
Allow: /news/public/`;
    expect(allows(txt, "/news/private/x")).toBe(false);
    expect(allows(txt, "/news/public/x")).toBe(true);
  });

  it("lets a group naming us replace the wildcard group entirely", () => {
    const txt = `User-agent: *
Disallow: /

User-agent: PinpalsNewsBot
Disallow: /admin/`;
    expect(allows(txt, "/feed/")).toBe(true);
    expect(allows(txt, "/admin/")).toBe(false);
  });

  it("does not let a group for some other bot apply to us", () => {
    const txt = `User-agent: SomeOtherBot
Disallow: /

User-agent: *
Disallow: /admin/`;
    expect(allows(txt, "/feed/")).toBe(true);
    expect(allows(txt, "/admin/")).toBe(false);
  });

  it("supports wildcards and the end-of-path anchor", () => {
    expect(allows("User-agent: *\nDisallow: /*.pdf$", "/files/report.pdf")).toBe(false);
    expect(allows("User-agent: *\nDisallow: /*.pdf$", "/files/report.pdf?x=1")).toBe(true);
    expect(allows("User-agent: *\nDisallow: /a/*/c", "/a/b/c")).toBe(false);
  });

  it("ignores comments and blank lines", () => {
    const txt = `# a comment
User-agent: *   # trailing comment
Disallow: /private/`;
    expect(allows(txt, "/private/x")).toBe(false);
    expect(allows(txt, "/public/x")).toBe(true);
  });

  it("applies consecutive user-agent lines to one shared group", () => {
    const txt = `User-agent: PinpalsNewsBot
User-agent: OtherBot
Disallow: /nope/`;
    expect(allows(txt, "/nope/")).toBe(false);
    expect(allows(txt, "/yep/")).toBe(true);
  });

  it("matches rules against the path and query, as robots is specified", () => {
    // The USGA feed carries its selector in the query string, so a rule
    // targeting a query has to be able to match it.
    expect(robotsPath("https://x.com/press-releases?pagetemplate=rss")).toBe(
      "/press-releases?pagetemplate=rss",
    );
    expect(robotsPath("https://x.com/feed/")).toBe("/feed/");
  });

  it("blocks a path a wildcard rule covers via the query string", () => {
    const txt = "User-agent: *\nDisallow: /*?pagetemplate=";
    expect(allows(txt, "/press-releases?pagetemplate=rss")).toBe(false);
    expect(allows(txt, "/press-releases")).toBe(true);
  });
});
