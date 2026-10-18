import { describe, expect, it } from "vitest";

import { parseVoiceStats, voiceStatsLine } from "./voice-stats";
import type { VoicePlayer } from "./voice-scores";

const ME: VoicePlayer = { id: 1, name: "Eire Duffy", isMe: true, shots: 1 };
const NIAMH: VoicePlayer = { id: 2, name: "Niamh Byrne", isMe: false, shots: 1 };
const DEC: VoicePlayer = { id: 3, name: "Declan Ryan", isMe: false, shots: 0 };
const SOLO = [ME];
const GROUP = [ME, NIAMH, DEC];

const heard = (t: string, players: VoicePlayer[] = SOLO) => parseVoiceStats(t, players).patch;

describe("putts", () => {
  it.each([
    ["five, two putts", 2],
    ["five two putted", 2],
    ["four, one-putt", 1],
    ["six, three putted it", 3],
    ["5 2 putts", 2],
    ["par, chipped in", 0],
    ["birdie, holed out from the bunker", 0],
    ["four putts, a seven", 4],
  ])("“%s” → %i", (t, n) => {
    expect(heard(t).putts).toBe(n);
  });
});

describe("missed greens", () => {
  it.each([
    ["five, missed it short", "short"],
    ["bogey, missed the green left", "left"],
    ["came up short, bogey", "short"],
    ["five, short of the green", "short"],
    ["went long, double", "long"],
    ["over the back, five", "long"],
    ["missed right, two putts", "right"],
  ])("“%s” → %s", (t, d) => {
    expect(heard(t).greenMiss).toBe(d);
  });

  it("isn't a short putt or a missed fairway", () => {
    expect(heard("five, missed a short putt").greenMiss).toBeUndefined();
    expect(heard("bogey, missed the fairway left").greenMiss).toBeUndefined();
  });
});

describe("tee shots", () => {
  it.each([
    ["par, hit the fairway", "fairway"],
    ["found the fairway, bogey", "fairway"],
    ["missed the fairway left, five", "left"],
    ["right of the fairway, bogey", "right"],
    ["drive went right, double", "right"],
    ["tee shot left, five", "left"],
  ])("“%s” → %s", (t, d) => {
    expect(heard(t).tee).toBe(d);
  });
});

describe("penalties", () => {
  it.each([
    ["seven, out of bounds", 1],
    ["six, penalty", 1],
    ["eight, two penalty shots", 2],
    ["double, lost ball", 1],
    ["six, in the water", 1],
    ["five, OB off the tee", 1],
  ])("“%s” → %i", (t, n) => {
    expect(heard(t).penalties).toBe(n);
  });
});

describe("whose stats", () => {
  it("takes the speaker's after I or me, up to the next name", () => {
    expect(heard("Niamh bogey, I had a five, two putts, missed it short, Dec par", GROUP)).toEqual({ putts: 2, greenMiss: "short" });
  });

  it("never takes someone else's", () => {
    const r = parseVoiceStats("I had par, Niamh three putted", GROUP);
    expect(r.patch).toEqual({});
    expect(r.unclear).toBe(false);
  });

  it("takes stats said with no names at all as the speaker's", () => {
    expect(heard("five, two putts, hit the fairway", GROUP)).toEqual({ putts: 2, tee: "fairway" });
  });

  it("says when stats can't be pinned on anyone", () => {
    const r = parseVoiceStats("two putts, Niamh bogey, Dec par", GROUP);
    expect(r.patch).toEqual({});
    expect(r.unclear).toBe(true);
  });

  it("takes your own name as you", () => {
    expect(heard("Eire five, two putts, Niamh par", GROUP)).toEqual({ putts: 2 });
  });

  it("hears nothing in a plain score", () => {
    expect(heard("Niamh bogey, I made par", GROUP)).toEqual({});
  });
});

describe("the check line", () => {
  it("reads back what was heard", () => {
    expect(voiceStatsLine({ putts: 2, greenMiss: "short", tee: "left", penalties: 1 })).toBe("tee shot left · 2 putts · missed short · 1 penalty");
    expect(voiceStatsLine({ putts: 0, tee: "fairway" })).toBe("fairway · no putts");
  });
});

describe("the score itself is still read right", () => {
  it.each([
    ["eight, two penalty shots", 8],
    ["five, two putts, missed it short", 5],
    ["I had a six, three putted, out of bounds", 6],
    ["four, one putt", 4],
  ])("“%s” scores %i", async (t, n) => {
    const { parseVoiceScores } = await import("./voice-scores");
    const r = parseVoiceScores(t, 4, SOLO);
    expect(r.scores[0]?.strokes).toBe(n);
  });
});
