import { describe, expect, it } from "vitest";

import { liveSteps } from "./live-steps";

describe("liveSteps", () => {
  it("links every step from every page, marking where you are", () => {
    const s = liveSteps(9, { id: 4, drawPublishedAt: "2026-10-20T10:00:00Z", matchDayId: null }, { current: 2, inDraw: 130, published: false });
    expect(s.map((x) => x.state)).toEqual(["next", "now", "next", "next", "next"]);
    expect(s.map((x) => x.href)).toEqual(["/society/9/live/4#setup", "/society/9/events/4/draw", "/society/9/live/4#start", "/society/9/live/4", "/society/9/live/4/results"]);
    expect(s[1].sub).toBe("130 in the draw");
  });
  it("once started, set-up and start are done and lead to the control room", () => {
    const s = liveSteps(9, { id: 4, drawPublishedAt: "x", matchDayId: 77 }, { current: 5, inDraw: 8, published: true });
    expect(s.map((x) => x.state)).toEqual(["done", "done", "done", "done", "now"]);
    expect(s[0].href).toBe("/society/9/live/4");
  });
});
