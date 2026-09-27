import { describe, expect, it } from "vitest";

import {
  alertFamily,
  inboxTime,
  inboxTotal,
  isDeliveryOnlyAlert,
  isInboxFilter,
  isInboxItemUnread,
  matchesInboxFilter,
  mergeInbox,
  type InboxAlert,
  type InboxConversation,
} from "./inbox";
import { NOTIFICATION_TYPES } from "./notifications";

const conversation = (
  over: Partial<InboxConversation> & Pick<InboxConversation, "id" | "at">
): InboxConversation => ({
  kind: "conversation",
  otherName: "Aoife Byrne",
  otherAvatarColor: null,
  listingTitle: null,
  listingImageUrl: null,
  unreadCount: 0,
  archived: false,
  href: `/conversations/${over.id}`,
  ...over,
});

const alert = (
  over: Partial<InboxAlert> & Pick<InboxAlert, "id" | "at">
): InboxAlert => ({
  kind: "alert",
  type: "offer_received",
  title: "New offer",
  body: "€180 for your Stealth 2",
  href: "/marketplace/1",
  unread: true,
  ...over,
});

describe("mergeInbox", () => {
  it("interleaves both streams newest first", () => {
    const merged = mergeInbox(
      [conversation({ id: 1, at: "2026-09-27T10:00:00Z" }), conversation({ id: 2, at: "2026-09-25T10:00:00Z" })],
      [alert({ id: 10, at: "2026-09-26T10:00:00Z" })]
    );

    expect(merged.map((i) => `${i.kind}:${i.id}`)).toEqual([
      "conversation:1",
      "alert:10",
      "conversation:2",
    ]);
  });

  it("breaks ties deterministically rather than leaving it to sort stability", () => {
    const at = "2026-09-27T10:00:00Z";
    const forwards = mergeInbox([conversation({ id: 3, at })], [alert({ id: 9, at })]);
    const backwards = mergeInbox([conversation({ id: 3, at })], [alert({ id: 9, at })]);

    expect(forwards.map((i) => i.kind)).toEqual(["conversation", "alert"]);
    expect(backwards).toEqual(forwards);
  });

  it("orders same-kind ties by id, newest id first", () => {
    const at = "2026-09-27T10:00:00Z";
    const merged = mergeInbox([], [alert({ id: 4, at }), alert({ id: 11, at })]);
    expect(merged.map((i) => i.id)).toEqual([11, 4]);
  });

  it("survives an unparseable timestamp without throwing or dropping rows", () => {
    const merged = mergeInbox([conversation({ id: 1, at: "not a date" })], [alert({ id: 2, at: "2026-09-27T10:00:00Z" })]);
    expect(merged).toHaveLength(2);
  });
});

describe("matchesInboxFilter", () => {
  const open = conversation({ id: 1, at: "2026-09-27T10:00:00Z" });
  const archived = conversation({ id: 2, at: "2026-09-27T10:00:00Z", archived: true });
  const anAlert = alert({ id: 3, at: "2026-09-27T10:00:00Z" });

  it("keeps archived conversations out of All", () => {
    expect(matchesInboxFilter(open, "all")).toBe(true);
    expect(matchesInboxFilter(archived, "all")).toBe(false);
    expect(matchesInboxFilter(anAlert, "all")).toBe(true);
  });

  it("splits the two kinds", () => {
    expect(matchesInboxFilter(open, "messages")).toBe(true);
    expect(matchesInboxFilter(anAlert, "messages")).toBe(false);
    expect(matchesInboxFilter(anAlert, "alerts")).toBe(true);
    expect(matchesInboxFilter(open, "alerts")).toBe(false);
  });

  it("shows archived conversations only under Archived", () => {
    expect(matchesInboxFilter(archived, "archived")).toBe(true);
    expect(matchesInboxFilter(open, "archived")).toBe(false);
    // An alert is never archived — there is nothing to archive it with.
    expect(matchesInboxFilter(anAlert, "archived")).toBe(false);
  });

  it("recognises its own filter names and nothing else", () => {
    expect(isInboxFilter("alerts")).toBe(true);
    expect(isInboxFilter("buying")).toBe(false);
    expect(isInboxFilter(null)).toBe(false);
  });
});

describe("unread", () => {
  it("counts a conversation unread only when messages are waiting", () => {
    expect(isInboxItemUnread(conversation({ id: 1, at: "x", unreadCount: 2 }))).toBe(true);
    expect(isInboxItemUnread(conversation({ id: 1, at: "x", unreadCount: 0 }))).toBe(false);
  });

  it("adds the two streams for the badge", () => {
    expect(inboxTotal({ messages: 3, alerts: 2 })).toBe(5);
    expect(inboxTotal({ messages: 0, alerts: 0 })).toBe(0);
  });

  it("treats new_message as delivery-only so a message is never counted twice", () => {
    expect(isDeliveryOnlyAlert("new_message")).toBe(true);
    expect(isDeliveryOnlyAlert("offer_received")).toBe(false);
  });
});

describe("alertFamily", () => {
  it("gives every known notification type a family", () => {
    for (const type of NOTIFICATION_TYPES) {
      expect(alertFamily(type)).toBeTruthy();
    }
  });

  it("files the families it has icons for", () => {
    expect(alertFamily("tee_time_place_offered")).toBe("tee-time");
    expect(alertFamily("offer_countered")).toBe("offer");
    expect(alertFamily("auction_won")).toBe("auction");
    expect(alertFamily("outbid")).toBe("auction");
    expect(alertFamily("payment_failed")).toBe("payment");
    expect(alertFamily("refund_requested")).toBe("payment");
    expect(alertFamily("dispute_opened")).toBe("payment");
    expect(alertFamily("review_available")).toBe("review");
    expect(alertFamily("new_message")).toBe("message");
  });

  it("falls back rather than throwing on a type added later", () => {
    expect(alertFamily("something_nobody_has_written_yet")).toBe("other");
  });
});

describe("inboxTime", () => {
  const now = new Date("2026-09-27T14:30:00Z");

  it("says Just now inside a minute", () => {
    expect(inboxTime("2026-09-27T14:29:30Z", now)).toBe("Just now");
  });

  it("uses a 24-hour clock for today", () => {
    // Explicit hour12: false — en-IE happens to default that way, and the
    // app's own dayLabel() was once broken by trusting exactly that.
    expect(inboxTime("2026-09-27T09:41:00Z", now)).toMatch(/^\d{2}:\d{2}$/);
    expect(inboxTime("2026-09-27T09:41:00Z", now)).not.toMatch(/[ap]m/i);
  });

  it("uses a weekday inside the last week", () => {
    expect(inboxTime("2026-09-24T09:41:00Z", now)).toMatch(/^[A-Z][a-z]{2}$/);
  });

  it("uses a date beyond a week, and adds the year only when it differs", () => {
    expect(inboxTime("2026-08-12T09:41:00Z", now)).toMatch(/12/);
    expect(inboxTime("2026-08-12T09:41:00Z", now)).not.toMatch(/2026/);
    expect(inboxTime("2025-08-12T09:41:00Z", now)).toMatch(/2025/);
  });

  it("returns an empty string rather than 'Invalid Date' for junk", () => {
    expect(inboxTime("not a date", now)).toBe("");
  });
});
