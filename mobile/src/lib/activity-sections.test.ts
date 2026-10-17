import { describe, expect, it } from "vitest";
import { sectionForSegments } from "./activity-sections";

describe("sectionForSegments", () => {
  it("maps tabs and screens to sections", () => {
    expect(sectionForSegments(["(tabs)"])).toBe("home");
    expect(sectionForSegments([])).toBe("home");
    expect(sectionForSegments(["(tabs)", "live"])).toBe("live");
    expect(sectionForSegments(["(tabs)", "marketplace", "index"])).toBe("marketplace");
    expect(sectionForSegments(["group", "[id]"])).toBe("groups");
    expect(sectionForSegments(["listing", "[id]"])).toBe("marketplace");
    expect(sectionForSegments(["something-new"])).toBe("other");
  });
});
