import { describe, expect, it } from "vitest";
import { bestHoleLine, playedWhen, recapCaption, recapStats, recapSubtitle, roundsToRecap, withWhom, type RecapSource } from "./round-recap";

const today = "2026-10-04";
const source: RecapSource = {
  inviteId: 12,
  course: "Portmarnock Golf Club",
  playDate: "2026-10-04",
  when: "08:30",
  players: ["Niamh Gallagher", "Conor Doyle"],
};

describe("words", () => {
  it("says when", () => {
    expect(playedWhen("2026-10-04", today)).toBe("today");
    expect(playedWhen("2026-10-03", today)).toBe("yesterday");
    expect(playedWhen("2026-09-26", today)).toBe("on Sat 26 Sep");
  });
  it("says with whom, by first name", () => {
    expect(withWhom([])).toBeNull();
    expect(withWhom(["Niamh Gallagher"])).toBe("Niamh");
    expect(withWhom(["Niamh Gallagher", "Conor Doyle", "Aoife Kelly"])).toBe("Niamh, Conor and Aoife");
  });
  it("builds the subtitle", () => {
    expect(recapSubtitle(source, { tee: "White" }, today)).toBe("Today · White tees · with Niamh and Conor");
    expect(recapSubtitle({ ...source, players: [] }, {}, today)).toBe("Today");
  });
});

describe("recapCaption", () => {
  it("writes the full recap", () => {
    expect(
      recapCaption(source, { score: 78, course_par: 72, birdies: 3, gir: 8, putts: 29, best_hole: { hole: 6, par: 4, score: 3 } }, today)
    ).toBe(
      "78 (+6) at Portmarnock Golf Club today with Niamh and Conor. 3 birdies, 8 greens in regulation and 29 putts. Best hole: a birdie on the 6th."
    );
  });
  it("says only what was filled in", () => {
    expect(recapCaption(source, {}, today)).toBe("A round at Portmarnock Golf Club today with Niamh and Conor.");
    expect(recapCaption({ ...source, players: [] }, { score: 81, putts: 33 }, today)).toBe(
      "81 at Portmarnock Golf Club today. 33 putts."
    );
    expect(recapCaption(source, { score: 74, birdies: 0, best_hole: { hole: 11, par: 3, score: 1 }, longest_drive: 290 }, today)).toBe(
      "74 at Portmarnock Golf Club today with Niamh and Conor. Best hole: an ace on the 11th. Longest drive 290 yards."
    );
  });
});

describe("recapStats", () => {
  it("fills what it has and leaves dashes for the rest", () => {
    const stats = recapStats({ score: 78, course_par: 72, front_nine: 38, back_nine: 40, gir: 8 });
    expect(stats.find((s) => s.label === "Final score")).toEqual({ label: "Final score", value: "78", accent: "+6" });
    expect(stats.find((s) => s.label === "Front 9")?.value).toBe("38");
    expect(stats.find((s) => s.label === "Putts")?.value).toBeNull();
  });
  it("a 9-hole round has no back nine", () => {
    const stats = recapStats({ score: 40, holes: 9, front_nine: 40 });
    expect(stats.find((s) => s.label === "Nine")?.value).toBe("40");
    expect(stats.find((s) => s.label === "Back 9")?.value).toBeNull();
  });
  it("describes the best hole", () => {
    expect(bestHoleLine({ best_hole: { hole: 6, par: 4, score: 3 } })).toBe("Hole 6 · Par 4 · Birdie");
    expect(bestHoleLine({})).toBeNull();
  });
});

describe("roundsToRecap", () => {
  const r = (inviteId: number, playDate: string) => ({ inviteId, playDate });
  it("offers recent, unshared, undismissed rounds, newest first", () => {
    const past = [r(1, "2026-10-01"), r(2, "2026-10-03"), r(3, "2026-09-01"), r(4, "2026-10-02"), r(5, "2026-10-05")];
    expect(roundsToRecap(past, new Set([4]), new Set(), today).map((x) => x.inviteId)).toEqual([2, 1]);
    expect(roundsToRecap(past, new Set(), new Set([2]), today).map((x) => x.inviteId)).toEqual([4, 1]);
  });
});
