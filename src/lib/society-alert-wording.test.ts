import { describe, expect, it } from "vitest";

import { ALERT_PREF, dayLabel, euro, wordAlert, type AlertRow } from "./society-alert-wording";
import { NOTIFICATION_TYPES } from "./notifications";

const row = (kind: string, payload: Record<string, unknown> = {}): AlertRow => ({
  id: 1,
  group_id: 7,
  outing_id: 42,
  member_id: "00000000-0000-0000-0000-000000000001",
  kind,
  payload: { title: "Captain's Prize", plays_on: "2026-11-14", ...payload },
  dedupe_key: "k",
});

describe("society alert wording", () => {
  it("formats days and money", () => {
    expect(dayLabel("2026-11-14")).toBe("Sat 14 Nov");
    expect(euro(7000)).toBe("€70");
    expect(euro(6550)).toBe("€65.50");
    expect(euro(0)).toBeNull();
  });

  it("words every kind the database writes, to a real type and an event link", () => {
    for (const kind of Object.keys(ALERT_PREF)) {
      const w = wordAlert(row(kind), "Fairways GS", "Ruth");
      expect(w, kind).not.toBeNull();
      expect(NOTIFICATION_TYPES as readonly string[]).toContain(w!.type);
      expect(w!.href.startsWith("/groups/7")).toBe(true);
      expect(w!.title.length).toBeGreaterThan(0);
    }
  });

  it("keeps a committee message's text off the lock screen", () => {
    const w = wordAlert(row("message", { title: "2027 membership", body: "Pay by 31 Jan please" }), "Fairways GS", "Ciarán")!;
    expect(w.body).toContain("Pay by 31 Jan please");
    expect(w.pushBody).toBe("From Ciarán — tap to read it.");
    expect(w.href).toBe("/groups/7");
  });

  it("says what a place offer is and links to the event", () => {
    const w = wordAlert(row("place_offered", { expires_at: "2026-11-10T21:00:00Z" }), "Fairways GS", null)!;
    expect(w.title).toBe("A place opened: Captain's Prize");
    expect(w.body).toMatch(/take it by 9pm Tue 10 Nov/);
    expect(w.href).toBe("/groups/7/events/42");
  });

  it("returns nothing for a kind it doesn't know", () => {
    expect(wordAlert(row("mystery"), "x", null)).toBeNull();
  });
});
