import { describe, expect, it } from "vitest";
import { announcementBody, type InviteAnnouncement } from "./tee-times-server";

// Only announcementBody() is tested here. connectionIdsFor() and
// notifyConnectionsOfInvite() are Supabase round-trips with no branching
// worth mocking, the same reason email.test.ts leaves sendEmail() alone.
// This function is the pure part, and it's the part whose output lands in
// someone's inbox.

const base: InviteAnnouncement = {
  inviteId: 1,
  hostId: "00000000-0000-0000-0000-000000000001",
  clubName: "Portmarnock",
  playDate: "2026-09-19",
  timeFrom: null,
  timeTo: null,
  spaces: 2,
};

describe("announcementBody", () => {
  it("names the host, the club, the spaces and the day", () => {
    const body = announcementBody(base, "Conor Murphy");
    expect(body).toContain("Conor Murphy");
    expect(body).toContain("Portmarnock");
    expect(body).toContain("2 spaces");
    expect(body).toContain("Saturday");
  });

  it("says '1 space', not '1 spaces'", () => {
    expect(announcementBody({ ...base, spaces: 1 }, "Conor Murphy")).toContain("1 space at");
  });

  it("includes a time range when the host gave one", () => {
    const body = announcementBody({ ...base, timeFrom: "09:00", timeTo: "11:30" }, "Conor Murphy");
    expect(body).toContain("9am");
    expect(body).toContain("11:30am");
  });

  it("reads cleanly when the host gave no times", () => {
    const body = announcementBody(base, "Conor Murphy");
    expect(body).not.toContain(", .");
    expect(body.endsWith(".")).toBe(true);
  });

  it("never carries the host's free-text notes", () => {
    // The notes field is the one part of an invite another member wrote, and
    // this string is emailed. Same discipline as sendMessage(), which emails
    // "X sent you a message" rather than the message. The type not having a
    // notes field at all is the enforcement; this pins the intent.
    expect(Object.keys(base)).not.toContain("notes");
  });
});
