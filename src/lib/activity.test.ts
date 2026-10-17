import { describe, expect, it } from "vitest";
import { ACTIVITY_SECTIONS, SECTION_LABELS, isUntrackedPath, parseActivityPing, sectionForWebPath } from "./activity";

describe("sectionForWebPath", () => {
  it("maps pages to sections", () => {
    expect(sectionForWebPath("/")).toBe("home");
    expect(sectionForWebPath("/marketplace/123")).toBe("marketplace");
    expect(sectionForWebPath("/tee-times?x=1")).toBe("tee_times");
    expect(sectionForWebPath("/live/abc")).toBe("live");
    expect(sectionForWebPath("/society/5")).toBe("groups");
    expect(sectionForWebPath("/somewhere-new")).toBe("other");
  });
  it("every section has a label", () => {
    for (const s of ACTIVITY_SECTIONS) expect(SECTION_LABELS[s]).toBeTruthy();
  });
});

describe("isUntrackedPath", () => {
  it("leaves out admin, TV screens and auth hops", () => {
    expect(isUntrackedPath("/admin")).toBe(true);
    expect(isUntrackedPath("/admin/users")).toBe(true);
    expect(isUntrackedPath("/tv/abc")).toBe(true);
    expect(isUntrackedPath("/auth/callback")).toBe(true);
    expect(isUntrackedPath("/administrator")).toBe(false);
    expect(isUntrackedPath("/courses")).toBe(false);
  });
});

describe("parseActivityPing", () => {
  const ok = { session: "0123456789abcdef-x", platform: "web", section: "home", view: true };
  it("accepts a good ping", () => {
    expect(parseActivityPing(ok)).toEqual({ ...ok, install: null, appVersion: null });
  });
  it("rejects bad sessions and platforms", () => {
    expect(parseActivityPing({ ...ok, session: "short" })).toBeNull();
    expect(parseActivityPing({ ...ok, session: "x'; drop table--aaaaaaaa" })).toBeNull();
    expect(parseActivityPing({ ...ok, platform: "windows" })).toBeNull();
    expect(parseActivityPing(null)).toBeNull();
    expect(parseActivityPing("hi")).toBeNull();
  });
  it("files unknown sections under other", () => {
    expect(parseActivityPing({ ...ok, section: "hacker" })?.section).toBe("other");
  });
  it("keeps install ids for the app only", () => {
    const app = parseActivityPing({ ...ok, platform: "ios", install: "abcdefabcdefabcdef", appVersion: "1.0.0" });
    expect(app?.install).toBe("abcdefabcdefabcdef");
    expect(app?.appVersion).toBe("1.0.0");
    expect(parseActivityPing({ ...ok, install: "abcdefabcdefabcdef" })?.install).toBeNull();
  });
  it("only counts a view when asked", () => {
    expect(parseActivityPing({ ...ok, view: "yes" })?.view).toBe(false);
  });
});
