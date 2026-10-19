import { describe, expect, it } from "vitest";

import {
  CARD_NAME_COLOURS,
  asAlertLevel,
  cardNameColour,
  daysBetween,
  eventWhen,
  groupLine,
  groupTag,
  mergeTimeline,
  shortDate,
  tripCountdown,
  tripDaysLeft,
} from "./group-chat-rules";

describe("trip countdown", () => {
  it("counts whole calendar days", () => {
    expect(daysBetween("2026-10-19", "2027-05-06")).toBe(199);
    expect(daysBetween("2026-10-19", "2026-10-19")).toBe(0);
  });

  it("says days to go, tomorrow, on now, then nothing", () => {
    expect(tripCountdown("2027-05-06", "2027-05-10", "2026-10-19")).toBe("199 days to go");
    expect(tripCountdown("2027-05-06", "2027-05-10", "2027-05-05")).toBe("Tomorrow");
    expect(tripCountdown("2027-05-06", "2027-05-10", "2027-05-06")).toBe("On now");
    expect(tripCountdown("2027-05-06", "2027-05-10", "2027-05-10")).toBe("On now");
    expect(tripCountdown("2027-05-06", "2027-05-10", "2027-05-11")).toBeNull();
    expect(tripCountdown("2027-05-06", null, "2027-05-06")).toBe("On now");
    expect(tripCountdown(null, null, "2027-05-06")).toBeNull();
  });

  it("gives the badge a number only before the trip", () => {
    expect(tripDaysLeft("2027-05-06", "2026-10-19")).toBe(199);
    expect(tripDaysLeft("2027-05-06", "2027-05-06")).toBeNull();
    expect(tripDaysLeft(null, "2027-05-06")).toBeNull();
  });
});

describe("words for a group", () => {
  it("writes the gold line under the name", () => {
    expect(groupLine({ kind: "crew", memberCount: 8 }, "2026-10-19")).toBe("Golf Buddies · 8 members");
    expect(groupLine({ kind: "crew", memberCount: 1 }, "2026-10-19")).toBe("Golf Buddies · 1 member");
    expect(groupLine({ kind: "trip", memberCount: 8, startsOn: "2027-05-06", endsOn: "2027-05-10" }, "2026-10-19")).toBe(
      "Golf trip · 199 days to go",
    );
    expect(groupLine({ kind: "trip", memberCount: 8 }, "2026-10-19")).toBe("Golf trip · 8 golfers");
  });

  it("tags inbox rows", () => {
    expect(groupTag("trip")).toBe("TRIP");
    expect(groupTag("crew")).toBe("BUDDIES");
    expect(groupTag("area")).toBeNull();
  });

  it("reads alert levels, defaulting to everything", () => {
    expect(asAlertLevel("key")).toBe("key");
    expect(asAlertLevel("none")).toBe("none");
    expect(asAlertLevel(null)).toBe("all");
  });
});

describe("dates", () => {
  it("writes a calendar date without moving it", () => {
    expect(shortDate("2026-10-24")).toBe("Sat 24 Oct");
    expect(shortDate("2027-05-06")).toBe("Thu 6 May");
    expect(eventWhen("2026-10-24", "08:40:00")).toBe("Sat 24 Oct · 08:40");
    expect(eventWhen("2026-10-24", null)).toBe("Sat 24 Oct");
  });
});

describe("the chat timeline", () => {
  const m = (id: number, at: string) => ({ id, created_at: at });
  const c = (id: string, at: string) => ({ id, created_at: at });

  it("puts events among messages, newest first", () => {
    const out = mergeTimeline([m(3, "2026-10-19T20:00:00Z"), m(1, "2026-10-19T18:00:00Z")], [c("e", "2026-10-19T19:00:00Z")], false);
    expect(out.map((x) => (x.kind === "message" ? x.item.id : x.item.id))).toEqual([3, "e", 1]);
  });

  it("holds back an event older than what's loaded while more is to come", () => {
    const messages = [m(3, "2026-10-19T20:00:00Z")];
    const cards = [c("old", "2026-10-01T09:00:00Z")];
    expect(mergeTimeline(messages, cards, true)).toHaveLength(1);
    expect(mergeTimeline(messages, cards, false)).toHaveLength(2);
  });

  it("shows events in a chat with no messages yet", () => {
    expect(mergeTimeline([], [c("e", "2026-10-19T19:00:00Z")], false)).toHaveLength(1);
  });
});

describe("name colours on the chat card", () => {
  it("are steady per member and from the light set", () => {
    const a = cardNameColour("00000000-0000-0000-0000-000000000001");
    expect(cardNameColour("00000000-0000-0000-0000-000000000001")).toBe(a);
    expect(CARD_NAME_COLOURS).toContain(a);
  });
});
