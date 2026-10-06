import { describe, expect, it } from "vitest";

import { inviteAfter } from "./invite-slots";

const slots = (total: number, every: number) =>
  Array.from({ length: total }, (_, i) => i).filter((i) => inviteAfter(i, total, every));

describe("inviteAfter", () => {
  it("places a card after every fourth item", () => {
    expect(slots(13, 4)).toEqual([3, 7, 11]);
  });
  it("never after the last item", () => {
    expect(slots(8, 4)).toEqual([3]);
    expect(slots(4, 4)).toEqual([]);
  });
  it("none in a short list", () => {
    expect(slots(3, 4)).toEqual([]);
  });
  it("ignores a nonsense interval", () => {
    expect(slots(10, 0)).toEqual([]);
  });
});
