import { describe, expect, it } from "vitest";
import { buildMessagesCursorFilter, nextMessagesCursor, otherParticipantId, MESSAGES_PAGE_SIZE } from "./messaging";

describe("otherParticipantId", () => {
  it("returns the other party regardless of which side the caller is on", () => {
    const conversation = { user_a_id: "user-a", user_b_id: "user-b" };
    expect(otherParticipantId(conversation, "user-a")).toBe("user-b");
    expect(otherParticipantId(conversation, "user-b")).toBe("user-a");
  });

  it("returns null when the given id isn't actually a participant", () => {
    const conversation = { user_a_id: "user-a", user_b_id: "user-b" };
    expect(otherParticipantId(conversation, "user-c")).toBeNull();
  });
});

describe("buildMessagesCursorFilter", () => {
  it("builds a PostgREST .or() filter for strictly-older-than-cursor, with id as the tie-breaker", () => {
    const filter = buildMessagesCursorFilter({ createdAt: "2026-09-04T10:00:00.000Z", id: 42 });
    expect(filter).toBe("created_at.lt.2026-09-04T10:00:00.000Z,and(created_at.eq.2026-09-04T10:00:00.000Z,id.lt.42)");
  });
});

describe("nextMessagesCursor", () => {
  const row = (id: number, createdAt: string) => ({ id, created_at: createdAt });

  it("returns null when the page came back short (nothing older left)", () => {
    const page = [row(3, "c"), row(2, "b")];
    expect(nextMessagesCursor(page, MESSAGES_PAGE_SIZE)).toBeNull();
  });

  it("returns null for an empty page", () => {
    expect(nextMessagesCursor([], MESSAGES_PAGE_SIZE)).toBeNull();
  });

  it("cursors off the last (oldest) row of a full page", () => {
    const page = Array.from({ length: MESSAGES_PAGE_SIZE }, (_, i) => row(MESSAGES_PAGE_SIZE - i, `t${MESSAGES_PAGE_SIZE - i}`));
    const cursor = nextMessagesCursor(page, MESSAGES_PAGE_SIZE);
    const last = page[page.length - 1];
    expect(cursor).toEqual({ createdAt: last.created_at, id: last.id });
  });
});
