import { describe, expect, it } from "vitest";
import {
  buildMessagesCursorFilter,
  nextMessagesCursor,
  otherParticipantId,
  myLastReadAt,
  isConversationUnread,
  isConversationArchived,
  conversationRole,
  matchesInboxFilter,
  containsSensitiveData,
  MESSAGES_PAGE_SIZE,
} from "./messaging";

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

describe("myLastReadAt / isConversationUnread", () => {
  const base = {
    user_a_id: "user-a",
    user_b_id: "user-b",
    user_a_last_read_at: "2026-09-01T00:00:00.000Z",
    user_b_last_read_at: null,
  };

  it("returns each side's own cursor", () => {
    expect(myLastReadAt(base, "user-a")).toBe("2026-09-01T00:00:00.000Z");
    expect(myLastReadAt(base, "user-b")).toBeNull();
    expect(myLastReadAt(base, "user-c")).toBeNull();
  });

  it("a conversation with no messages yet is never unread", () => {
    expect(isConversationUnread({ last_message_at: null }, base, "user-a")).toBe(false);
  });

  it("unread when the last message landed after my read cursor", () => {
    expect(isConversationUnread({ last_message_at: "2026-09-02T00:00:00.000Z" }, base, "user-a")).toBe(true);
  });

  it("read when my cursor is at or after the last message", () => {
    expect(isConversationUnread({ last_message_at: "2026-08-31T00:00:00.000Z" }, base, "user-a")).toBe(false);
  });

  it("unread when I've never read it at all", () => {
    expect(isConversationUnread({ last_message_at: "2026-09-02T00:00:00.000Z" }, base, "user-b")).toBe(true);
  });
});

describe("isConversationArchived", () => {
  const base = {
    user_a_id: "user-a",
    user_b_id: "user-b",
    user_a_archived_at: "2026-09-01T00:00:00.000Z",
    user_b_archived_at: null,
  };

  it("is per-side — one participant archiving never affects the other", () => {
    expect(isConversationArchived(base, "user-a")).toBe(true);
    expect(isConversationArchived(base, "user-b")).toBe(false);
  });
});

describe("conversationRole", () => {
  it("is null for a non-marketplace conversation (no listing)", () => {
    expect(conversationRole({ listingId: null, listingSellerId: null, userId: "user-a" })).toBeNull();
  });

  it("is 'selling' when the viewer is the listing's own seller", () => {
    expect(conversationRole({ listingId: 1, listingSellerId: "user-a", userId: "user-a" })).toBe("selling");
  });

  it("is 'buying' when the viewer is not the listing's seller", () => {
    expect(conversationRole({ listingId: 1, listingSellerId: "user-a", userId: "user-b" })).toBe("buying");
  });
});

describe("matchesInboxFilter", () => {
  const buying = { role: "buying" as const, archived: false };
  const selling = { role: "selling" as const, archived: false };
  const general = { role: null, archived: false };
  const archivedBuying = { role: "buying" as const, archived: true };

  it("'all' includes every non-archived role, including non-marketplace threads", () => {
    expect(matchesInboxFilter("all", buying)).toBe(true);
    expect(matchesInboxFilter("all", selling)).toBe(true);
    expect(matchesInboxFilter("all", general)).toBe(true);
  });

  it("an archived conversation only ever shows under 'archived', never 'all'", () => {
    expect(matchesInboxFilter("all", archivedBuying)).toBe(false);
    expect(matchesInboxFilter("archived", archivedBuying)).toBe(true);
  });

  it("'buying'/'selling' only match their own role", () => {
    expect(matchesInboxFilter("buying", buying)).toBe(true);
    expect(matchesInboxFilter("buying", selling)).toBe(false);
    expect(matchesInboxFilter("selling", selling)).toBe(true);
    expect(matchesInboxFilter("buying", general)).toBe(false);
  });
});

describe("containsSensitiveData", () => {
  it("allows ordinary conversation", () => {
    expect(containsSensitiveData("Is this still available? Can you do 150?")).toEqual({ blocked: false });
  });

  it("flags a card-number-shaped run of digits, spaced or dashed", () => {
    expect(containsSensitiveData("4111 1111 1111 1111").blocked).toBe(true);
    expect(containsSensitiveData("4111-1111-1111-1111").blocked).toBe(true);
    expect(containsSensitiveData("4111111111111111").blocked).toBe(true);
  });

  it("does not flag a short, ordinary number", () => {
    expect(containsSensitiveData("Meet at 3pm, my number is 087 1234567").blocked).toBe(false);
  });

  it("flags an IBAN-shaped token", () => {
    expect(containsSensitiveData("IE29 AIBK 9311 5212 3456 78").blocked).toBe(true);
  });

  it("flags a verification-sounding word near a number", () => {
    expect(containsSensitiveData("my passport number is 123456").blocked).toBe(true);
    expect(containsSensitiveData("here's my sort code 12-34-56").blocked).toBe(true);
  });
});
