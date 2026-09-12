// Pure, framework-free domain model for marketplace notifications — mirrors
// src/lib/admin/reports.ts's own header comment ("no Supabase, no Next.js,
// trivial to unit test") for the same reason: this vocabulary is shared
// between the server-only dispatch helper (notifications-server.ts, which
// decides whether to also send an email or a push) and the in-app
// notification list UI, and needs to stay in lockstep with what
// supabase/migrations/0056_marketplace_notifications_reviews.sql's
// notification-writing functions actually produce.
//
// See that migration's own header comment for the full "why" — in short:
// every notification is ALWAYS recorded in-app (notify_user() has no
// preference gate of its own); the outbound channels are preference-aware,
// and only for the five OPTIONAL categories below. 'payments'/
// 'disputes_refunds' are deliberately not representable in
// notification_preferences at all (its own check constraint only allows the
// optional values) — there is no row to look up for those two, so delivery
// for them is unconditional by construction, never by an app-code check
// that could be forgotten or bypassed.
//
// Since 0075 there are TWO channels, email and push, and
// notification_preferences carries one boolean per channel per category.
// Both obey the identical rule — see channelEnabled() below — so that a
// transactional category is exactly as unsilenceable on a lock screen as it
// is in an inbox.

export const NOTIFICATION_CATEGORIES = [
  "messages",
  "offers",
  "auctions",
  "payments",
  "disputes_refunds",
  "reviews",
  "tee_times",
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

// Exactly the set notification_preferences.category's check constraint
// allows — see design decision 3 in the migration.
export const OPTIONAL_NOTIFICATION_CATEGORIES = ["messages", "offers", "auctions", "reviews", "tee_times"] as const;
export type OptionalNotificationCategory = (typeof OPTIONAL_NOTIFICATION_CATEGORIES)[number];

/** The delivery channels notification_preferences models, one boolean
 * column each. Named here so the settings form, the upsert and the dispatch
 * helper cannot drift apart. */
export const NOTIFICATION_CHANNELS = ["email", "push"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export function isOptionalCategory(category: NotificationCategory): category is OptionalNotificationCategory {
  return (OPTIONAL_NOTIFICATION_CATEGORIES as readonly string[]).includes(category);
}

export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  messages: "New messages",
  offers: "Offers",
  auctions: "Auctions & bids",
  payments: "Payments",
  disputes_refunds: "Refunds & disputes",
  reviews: "Reviews",
  tee_times: "Tee times",
};

export const NOTIFICATION_CATEGORY_DESCRIPTIONS: Record<OptionalNotificationCategory, string> = {
  messages: "When another member sends you a new message.",
  offers: "Offers you receive, and updates on offers you've made.",
  auctions: "Outbid alerts, auctions ending soon, and results.",
  reviews: "When you're able to leave a review after a completed order.",
  tee_times: "When someone you've connected with posts a tee time.",
};

// Every `type` value any part of this app writes to `notifications.type` —
// kept as one flat list so a stray typo at a call site fails a unit test
// (notifications.test.ts) rather than silently producing an un-categorised
// notification that would fall through to a made-up default.
export const NOTIFICATION_TYPES = [
  "offer_received",
  "offer_withdrawn",
  "offer_declined",
  "offer_countered",
  "offer_accepted",
  "reservation_expired",
  "offer_invalidated",
  "outbid",
  "auction_ending_soon",
  "auction_won",
  "auction_ended",
  "auction_lost",
  "new_message",
  "payment_succeeded",
  "payment_failed",
  "seller_action_required",
  "refund_requested",
  "refund_succeeded",
  "refund_failed",
  "dispute_opened",
  "dispute_updated",
  "review_available",
  // The first broadcast type: written once per connection when a member
  // posts availability, rather than once for a single recipient about
  // something that happened to them. See notifyConnectionsOfInvite() in
  // src/lib/tee-times-server.ts.
  "tee_time_posted",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_TYPE_CATEGORY: Record<NotificationType, NotificationCategory> = {
  offer_received: "offers",
  offer_withdrawn: "offers",
  offer_declined: "offers",
  offer_countered: "offers",
  offer_accepted: "offers",
  reservation_expired: "offers",
  offer_invalidated: "offers",
  outbid: "auctions",
  auction_ending_soon: "auctions",
  auction_won: "auctions",
  auction_ended: "auctions",
  auction_lost: "auctions",
  new_message: "messages",
  payment_succeeded: "payments",
  payment_failed: "payments",
  seller_action_required: "payments",
  refund_requested: "disputes_refunds",
  refund_succeeded: "disputes_refunds",
  refund_failed: "disputes_refunds",
  dispute_opened: "disputes_refunds",
  dispute_updated: "disputes_refunds",
  review_available: "reviews",
  tee_time_posted: "tee_times",
};

/** Which preference category (if any) governs delivery for this notification
 * type — `null` for a type this app has never seen (defensive; every real
 * call site uses a NotificationType literal, so this only matters for a
 * malformed/legacy row). */
export function categoryForType(type: string): NotificationCategory | null {
  return (NOTIFICATION_TYPE_CATEGORY as Record<string, NotificationCategory>)[type] ?? null;
}

/** The one rule both channels obey, factored out so they cannot diverge.
 * Transactional categories are always true, matching the DB's own inability
 * to store a disabled row for them. An optional category with no stored
 * preference defaults to enabled — silence isn't opt-out. An unknown type
 * sends nothing at all. */
function channelEnabled(type: string, enabled: boolean | null): boolean {
  const category = categoryForType(type);
  if (category === null) return false;
  if (!isOptionalCategory(category)) return true;
  return enabled ?? true;
}

/** Pure predicate: should an email actually be sent for this (type,
 * preference-row) pair? */
export function shouldSendEmail(type: string, emailEnabled: boolean | null): boolean {
  return channelEnabled(type, emailEnabled);
}

/** Pure predicate: should a push actually be sent for this (type,
 * preference-row) pair? Identical rule to email by design (0075) — a member
 * who cannot switch off payment email cannot switch off payment push
 * either. Note this says nothing about whether the member HAS any
 * registered device: that is a separate question, answered by
 * push_subscriptions, and "enabled but no devices" is the normal state for
 * most members. */
export function shouldSendPush(type: string, pushEnabled: boolean | null): boolean {
  return channelEnabled(type, pushEnabled);
}

/** Builds a stable '::'-joined dedupe key from parts — used at every
 * app-code (as opposed to SQL-side) notify call site, e.g.
 * buildDedupeKey(["stripe", event.id, "payment_succeeded", "buyer"]). Plain
 * string join, kept as a named helper so every call site is guaranteed the
 * same separator and can't accidentally collide two conceptually different
 * keys that happen to concatenate identically. */
export function buildDedupeKey(parts: (string | number)[]): string {
  return parts.map((p) => String(p)).join("::");
}

/** Fallback link for a notification row whose `data.href` is missing —
 * only ever needed for a handful of pre-0056 rows (every notify_user() call
 * site now populates it, per the migration's own design decision 2).
 * Falls back to a generic, always-safe destination rather than guessing a
 * specific id it doesn't actually have. */
export function notificationHref(data: Record<string, unknown> | null | undefined): string {
  const href = data?.href;
  return typeof href === "string" && href.startsWith("/") ? href : "/dashboard";
}
