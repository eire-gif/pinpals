/**
 * How inbox rows look and group — pure, no imports, so it runs under the
 * website's vitest (see the "mobile" project in vitest.config.ts).
 */

/**
 * Colour as well as shape, so the eye can tell an invitation from a like from
 * a payment before reading a word. Each pair is a pale fill with a strong
 * glyph of the same hue — the glyph clears 3:1 on its fill, which is the bar
 * for an icon that sits beside text saying the same thing.
 */
/** `icon` is an Ionicons name; kept a string so this file imports nothing. */
export type AlertLook = { icon: string; fg: string; bg: string };

export function alertLook(type: string): AlertLook {
  if (type === "tee_time_interest_received") return { icon: "person-add", fg: "#1f4f9c", bg: "#e3ecfa" };
  if (type === "tee_time_interest_declined" || type === "tee_time_cancelled" || type === "tee_time_place_withdrawn") {
    return { icon: "golf", fg: "#8a3b2c", bg: "#f6e3de" };
  }
  if (type.startsWith("tee_time_")) return { icon: "golf", fg: "#1f5c2e", bg: "#e2ede1" };
  if (type === "post_liked") return { icon: "heart", fg: "#b42d3b", bg: "#fbe4e6" };
  if (type === "post_commented" || type === "post_comment_replied") {
    return { icon: "chatbubble-ellipses", fg: "#6a3ea1", bg: "#eee6f8" };
  }
  if (type.startsWith("offer_") || type === "reservation_expired") return { icon: "pricetag", fg: "#9a4f00", bg: "#ffeed6" };
  if (type.startsWith("auction_") || type === "outbid") return { icon: "hammer", fg: "#9a4f00", bg: "#ffeed6" };
  if (
    type.startsWith("payment_") ||
    type.startsWith("refund_") ||
    type.startsWith("dispute_") ||
    type === "seller_action_required"
  ) {
    return { icon: "card", fg: "#123058", bg: "#e1e8f2" };
  }
  if (type === "review_available") return { icon: "star", fg: "#8a6212", bg: "#f8eccf" };
  return { icon: "notifications", fg: "#1f5c2e", bg: "#e2ede1" };
}

/** Which day-group a row falls in, in the phone's own time zone. */
export type DayBucket = "today" | "yesterday" | "week" | "earlier";

export const DAY_BUCKET_LABELS: Record<DayBucket, string> = {
  today: "Today",
  yesterday: "Yesterday",
  week: "This week",
  earlier: "Earlier",
};

export function dayBucket(at: string, now = new Date()): DayBucket {
  const t = new Date(at);
  if (Number.isNaN(t.getTime())) return "earlier";
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(t)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return "week";
  return "earlier";
}

