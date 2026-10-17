/**
 * The line beside a post's reaction discs — "Seán Byrne and 11 others" —
 * and the counts beside it. Pure, so it's tested on its own
 * (reaction-summary.test.ts). No imports.
 *
 * `me`: whether the viewer reacted. `other`: one other member who reacted
 * (the most recent one the viewer can see), or null when none can be named.
 */
export function reactionSummary(total: number, me: boolean, other: string | null): string {
  if (total <= 0) return "";
  const named = (me ? 1 : 0) + (other ? 1 : 0);
  const rest = Math.max(0, total - named);
  const others = (n: number) => `${n} ${n === 1 ? "other" : "others"}`;

  if (me) {
    if (total === 1) return "You";
    if (other) return rest === 0 ? `You and ${other}` : `You, ${other} and ${others(rest)}`;
    return `You and ${others(total - 1)}`;
  }
  if (other) return rest === 0 ? other : `${other} and ${others(rest)}`;
  return String(total);
}

/** "4 comments · 2 shares", leaving out a zero. */
export function engagementLine(comments: number, shares: number): string {
  const parts: string[] = [];
  if (comments > 0) parts.push(`${comments} ${comments === 1 ? "comment" : "comments"}`);
  if (shares > 0) parts.push(`${shares} ${shares === 1 ? "share" : "shares"}`);
  return parts.join(" · ");
}

/**
 * Where a share went, as recorded by record_post_share() (0166) — the
 * database's list, minus 'feed', which a repost records itself.
 */
export const SHARE_CHANNELS = ["pinpals", "whatsapp", "messages", "email", "facebook", "x", "copy_link", "other"] as const;
export type ShareChannel = (typeof SHARE_CHANNELS)[number];

/**
 * The address that opens an app with the post's link ready to send, or
 * null for the phone's own share sheet. Each is the app's public, documented
 * share address; none needs that app's SDK.
 */
export function shareAddress(channel: ShareChannel, text: string, url: string, platform: "ios" | "android" | "web"): string | null {
  const both = encodeURIComponent(`${text}\n${url}`);
  switch (channel) {
    case "whatsapp":
      return `whatsapp://send?text=${both}`;
    case "messages":
      // iOS reads the body after "&", Android after "?".
      return platform === "ios" ? `sms:&body=${both}` : `sms:?body=${both}`;
    case "email":
      return `mailto:?subject=${encodeURIComponent(text)}&body=${both}`;
    case "facebook":
      return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
    case "x":
      return `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
    default:
      return null;
  }
}
