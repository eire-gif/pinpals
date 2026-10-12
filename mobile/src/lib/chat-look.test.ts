import { describe, expect, it } from "vitest";

import {
  SENDER_COLOURS,
  canDeleteForEveryone,
  draftQuote,
  quoteLines,
  reactionChips,
  reactionsByMessage,
  readBy,
  senderColour,
  tickState,
  typingLine,
} from "./chat-look";
import type { Message } from "./messages";

const msg = (over: Partial<Message> = {}): Message => ({
  id: 1,
  conversation_id: 9,
  sender_id: "me",
  body: "See you on the 1st tee",
  created_at: "2026-10-12T09:00:00.000Z",
  image_path: null,
  hidden_at: null,
  ...over,
});

const members = (aRead: string | null, bRead: string | null) => [
  { id: "me", name: "Eire Byrne", lastReadAt: null },
  { id: "a", name: "Seán Kelly", lastReadAt: aRead },
  { id: "b", name: "Aoife Ryan", lastReadAt: bRead },
];

describe("ticks and seen-by", () => {
  it("is ✓ until everyone else has read past it, then ✓✓", () => {
    expect(tickState(msg(), members(null, null))).toBe("sent");
    expect(tickState(msg(), members("2026-10-12T09:01:00+00:00", null))).toBe("sent");
    expect(tickState(msg(), members("2026-10-12T09:01:00+00:00", "2026-10-12T09:00:00.5+00:00"))).toBe("seen");
  });

  it("compares as times, not strings", () => {
    // "09:00:00.5" sorts before "09:00:00.000Z" as text but is later in time.
    expect(readBy(msg(), members("2026-10-12T09:00:00.5+00:00", null))[0].seenAt).not.toBeNull();
    expect(readBy(msg(), members("2026-10-12T08:59:59+00:00", null))[0].seenAt).toBeNull();
  });

  it("leaves the sender out of Info", () => {
    expect(readBy(msg(), members(null, null)).map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("reactions", () => {
  const r = [
    { messageId: 1, memberId: "a", emoji: "😂" },
    { messageId: 1, memberId: "b", emoji: "⛳" },
    { messageId: 2, memberId: "a", emoji: "👍" },
    { messageId: 1, memberId: "me", emoji: "⛳" },
  ];
  it("groups by message", () => {
    expect(reactionsByMessage(r).get(1)).toHaveLength(3);
    expect(reactionsByMessage(r).get(2)).toHaveLength(1);
  });
  it("counts each emoji once, most used first, and marks mine", () => {
    expect(reactionChips(reactionsByMessage(r).get(1)!, "me")).toEqual([
      { emoji: "⛳", count: 2, mine: true },
      { emoji: "😂", count: 1, mine: false },
    ]);
  });
});

describe("quotes", () => {
  const names = (id: string) => ({ a: "Seán Kelly" })[id as "a"] ?? null;
  it("names the sender, or You, and the group on a private reply", () => {
    expect(quoteLines({ sender_id: "a", body: "Spare putter?", group: null }, "me", names)).toEqual({ who: "Seán Kelly", text: "Spare putter?" });
    expect(quoteLines({ sender_id: "me", body: "x" }, "me", names).who).toBe("You");
    expect(quoteLines({ sender_id: "a", body: "", photo: true, group: "Sat fourball" }, "me", names)).toEqual({
      who: "Seán Kelly · Sat fourball",
      text: "📷 Photo",
    });
  });
  it("says so when the original is gone", () => {
    expect(quoteLines({ deleted: true }, "me", names).text).toBe("This message was deleted");
    expect(quoteLines({ removed: true }, "me", names).text).toBe("This message was removed");
  });
  it("builds the draft quote from the message being answered", () => {
    expect(draftQuote(msg({ sender_id: "a" }), "Society")).toEqual({
      sender_id: "a",
      body: "See you on the 1st tee",
      photo: false,
      group: "Society",
    });
  });
});

describe("delete for everyone", () => {
  const now = Date.parse("2026-10-12T10:00:00Z");
  it("is offered on my own live message under 48 hours old", () => {
    expect(canDeleteForEveryone(msg(), "me", now)).toBe(true);
    expect(canDeleteForEveryone(msg({ sender_id: "a" }), "me", now)).toBe(false);
    expect(canDeleteForEveryone(msg({ deleted_at: "2026-10-12T09:30:00Z" }), "me", now)).toBe(false);
    expect(canDeleteForEveryone(msg({ created_at: "2026-10-10T09:00:00Z" }), "me", now)).toBe(false);
  });
});

describe("names and typing", () => {
  it("gives a member the same colour every time, from the palette", () => {
    expect(senderColour("abc")).toBe(senderColour("abc"));
    expect(SENDER_COLOURS).toContain(senderColour("00000000-0000-0000-0000-000000000003"));
  });
  it("words the typing line", () => {
    expect(typingLine([])).toBeNull();
    expect(typingLine(["Seán Kelly"])).toBe("Seán is typing…");
    expect(typingLine(["Seán Kelly", "Aoife Ryan"])).toBe("Seán and Aoife are typing…");
    expect(typingLine(["A", "B", "C"])).toBe("3 people are typing…");
  });
});
