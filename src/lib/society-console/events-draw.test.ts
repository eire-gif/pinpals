import { describe, expect, it } from "vitest";

import { drawPayload, parseDrawGroups, publishedGroups, publishedTimes, publishedTiming, type Seat } from "./events-draw";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

const seat = (key: string, group: number | null, position: number | null, time: string | null): Seat => ({ key, name: key, index: null, guest: key.startsWith("g:"), group, position, time });

describe("a published draw read back", () => {
  const seats = [seat(`m:${A}`, 2, 1, "09:10:00"), seat("g:7", 1, 2, "09:00:00"), seat(`m:${B}`, 1, 1, "09:00:00"), seat("m:x", null, null, null)];
  it("groups in tee order, players in position order", () => {
    expect(publishedGroups(seats).map((g) => g.map((s) => s.key))).toEqual([[`m:${B}`, "g:7"], [`m:${A}`]]);
  });
  it("first tee, gap and times", () => {
    expect(publishedTiming(seats, [8, 9, 10, 12])).toEqual({ first: "09:00", gap: 10 });
    expect(publishedTimes(seats, 2)).toEqual(["09:00", "09:10"]);
  });
});

describe("the publish payload", () => {
  it("is what the app sends", () => {
    const p = drawPayload([[{ key: `m:${A}` }, { key: "g:7" }], [{ key: `m:${B}` }]], ["09:00", ""]);
    expect(p).toEqual([
      { tee_time: "09:00", members: [A, { guest: 7 }] },
      { tee_time: null, members: [B] },
    ]);
    expect(parseDrawGroups(JSON.stringify(p))).toEqual({ groups: p });
  });
  it("refuses a bad shape or someone twice", () => {
    expect(parseDrawGroups("nope")).toEqual({ error: "That draw doesn't look right." });
    expect(parseDrawGroups(JSON.stringify([{ tee_time: "9am", members: [A] }]))).toEqual({ error: "A tee time doesn't look right." });
    expect(parseDrawGroups(JSON.stringify([{ members: [A] }, { members: [A] }]))).toEqual({ error: "Someone is in two groups." });
    expect(parseDrawGroups(JSON.stringify([{ members: ["not-a-uuid"] }]))).toEqual({ error: "That draw doesn't look right." });
  });
});
