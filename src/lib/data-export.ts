/**
 * "Download my data" — a member's copy of what PinPals holds about them
 * (GDPR Article 15 access, Article 20 portability). Pure: the list of what is
 * included and the scrubbing rules. data-export-server.ts runs it.
 *
 * WHAT IS IN. Every table with a column naming the member, read for that
 * member only: their profile and private details, posts, comments, likes,
 * messages they sent, listings, offers, orders, reviews, tee times, groups,
 * rounds, scorecards, notifications, support cases and reports they made.
 *
 * WHAT IS LEFT OUT, and why:
 *   - other people's messages to them — those are the other person's words.
 *     The conversations are listed; the app shows the full thread.
 *   - staff notes, fraud flags and the admin audit log — internal records,
 *     released by the Data Protection contact on request (privacy policy).
 *   - secrets: push keys, invite and certification tokens, card details
 *     (PinPals never holds a card number — Stripe does).
 *
 * When a migration adds a table that names a member, add it here. The
 * test (data-export.test.ts) checks the list is well-formed.
 */

export type ExportSource = {
  /** Section name in the file. */
  section: string;
  table: string;
  /** The column that names the member. */
  column: string;
  /** What this is, in the file's own words. */
  about: string;
};

export const EXPORT_SOURCES: readonly ExportSource[] = [
  { section: "profile", table: "profiles", column: "id", about: "Your profile as other members see it." },
  { section: "private_details", table: "member_private", column: "member_id", about: "Your handicap and Golf Ireland number — only you can see these." },
  { section: "date_of_birth", table: "member_birthdates", column: "user_id", about: "Your date of birth — only you can see it." },
  { section: "mobile_number", table: "member_phones", column: "member_id", about: "Your mobile number." },
  { section: "mobile_sharing", table: "member_phone_shares", column: "member_id", about: "The groups whose captain and secretary can see your mobile." },
  { section: "addresses", table: "addresses", column: "user_id", about: "Delivery addresses." },
  { section: "notification_settings", table: "notification_preferences", column: "user_id", about: "Which notifications you get." },
  { section: "devices", table: "push_subscriptions", column: "user_id", about: "Devices that get your notifications." },
  { section: "notifications", table: "notifications", column: "user_id", about: "Notifications sent to you." },

  { section: "connections_sent", table: "connections", column: "requester_id", about: "Connection requests you sent." },
  { section: "connections_received", table: "connections", column: "recipient_id", about: "Connection requests you received." },
  { section: "blocked", table: "blocked_users", column: "blocker_id", about: "Members you blocked." },
  { section: "muted", table: "muted_users", column: "muter_id", about: "Members you muted." },
  { section: "invite_codes", table: "member_invite_codes", column: "member_id", about: "Your invite codes." },

  { section: "favourite_clubs", table: "club_favourites", column: "member_id", about: "Clubs you follow." },
  { section: "courses_played", table: "member_courses", column: "member_id", about: "Courses you have played." },
  { section: "course_reviews", table: "course_reviews", column: "member_id", about: "Course reviews you wrote." },
  { section: "my_bag", table: "member_bag", column: "member_id", about: "Your clubs and how far you said you hit them (My bag)." },
  { section: "hole_tips", table: "hole_tips", column: "member_id", about: "Tips you left for holes (local knowledge)." },
  { section: "hole_tip_votes", table: "hole_tip_votes", column: "member_id", about: "Tips you marked useful." },

  { section: "posts", table: "posts", column: "author_id", about: "Your posts." },
  { section: "comments", table: "post_comments", column: "author_id", about: "Your comments." },
  { section: "post_likes", table: "post_likes", column: "user_id", about: "Posts you liked." },
  { section: "comment_likes", table: "post_comment_likes", column: "user_id", about: "Comments you liked." },
  { section: "saved_posts", table: "post_saves", column: "user_id", about: "Posts you saved." },

  { section: "conversations", table: "conversation_members", column: "member_id", about: "Conversations you are in." },
  { section: "messages_sent", table: "messages", column: "sender_id", about: "Messages you sent." },
  { section: "message_reactions", table: "message_reactions", column: "member_id", about: "Your reactions to messages." },

  { section: "listings", table: "listings", column: "seller_id", about: "Things you listed for sale." },
  { section: "listing_favourites", table: "listing_favourites", column: "user_id", about: "Listings you saved." },
  { section: "listing_promotions", table: "listing_promotions", column: "seller_id", about: "Promotions you bought." },
  { section: "bids", table: "bids", column: "bidder_id", about: "Your auction bids." },
  { section: "offers", table: "offers", column: "buyer_id", about: "Offers you made." },
  { section: "purchases", table: "orders", column: "buyer_id", about: "Things you bought." },
  { section: "sales", table: "orders", column: "seller_id", about: "Things you sold." },
  { section: "payouts", table: "payouts", column: "user_id", about: "Payouts to you." },
  { section: "payout_account", table: "stripe_connected_accounts", column: "user_id", about: "Your payout account (held by Stripe)." },
  { section: "reviews_written", table: "reviews", column: "reviewer_id", about: "Reviews you wrote." },
  { section: "reviews_received", table: "reviews", column: "reviewee_id", about: "Reviews about you." },
  { section: "stores", table: "stores", column: "owner_id", about: "Your store." },

  { section: "tee_times_posted", table: "tee_time_invites", column: "member_id", about: "Tee times you posted." },
  { section: "tee_time_requests", table: "tee_time_interests", column: "member_id", about: "Tee times you asked to join." },
  { section: "tee_time_invitations", table: "tee_time_invitations", column: "member_id", about: "Tee-time places you were invited to." },

  { section: "groups_started", table: "groups", column: "created_by", about: "Groups and societies you started." },
  { section: "group_memberships", table: "group_members", column: "member_id", about: "Groups and societies you are in." },
  { section: "group_invitations", table: "group_invitations", column: "member_id", about: "Invitations to groups." },
  { section: "event_entries", table: "society_outing_entries", column: "member_id", about: "Events you entered." },
  { section: "event_payments", table: "society_outing_payments", column: "member_id", about: "Event payments marked against you." },
  { section: "event_payment_claims", table: "society_outing_payment_claims", column: "member_id", about: "Event payments you said you made." },

  { section: "rounds_started", table: "live_rounds", column: "created_by", about: "Live rounds you started." },
  { section: "rounds_played", table: "live_round_players", column: "member_id", about: "Live rounds you played in." },
  { section: "scorecards", table: "scorecards", column: "member_id", about: "Your scorecards." },
  { section: "scorecard_certifications", table: "scorecard_certifications", column: "owner_id", about: "Certifications of your scorecards." },
  { section: "scorecards_certified", table: "scorecard_certifications", column: "certifier_id", about: "Scorecards you certified for others." },

  { section: "support_cases", table: "support_cases", column: "requester_id", about: "Help requests you made." },
  { section: "reports_made", table: "reports", column: "reporter_id", about: "Reports you made." },
  { section: "account_deletion", table: "account_deletion_requests", column: "user_id", about: "Requests to delete your account." },
];

/** Column names that never leave the database, in any table. */
const SECRET_COLUMNS = new Set([
  "p256dh",
  "auth",
  "auth_key",
  "keys",
  "token",
  "token_hash",
  "code_hash",
  "secret",
  "key_hash",
  "certify_key",
  "share_token",
  "invite_token",
  "link_token",
]);

/** Fields only staff use — moderation notes about the member stay internal. */
const STAFF_COLUMNS = new Set(["moderation_note", "admin_note", "internal_note", "review_note", "redacted_by", "hidden_by", "assigned_admin", "resolved_by", "escalated_by"]);

export function scrubRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (SECRET_COLUMNS.has(key) || STAFF_COLUMNS.has(key)) continue;
    if (/(_token|_secret|_hash)$/.test(key)) continue;
    out[key] = value;
  }
  return out;
}

/** Rows per section. Past this the section is marked truncated, and the member can ask for the rest. */
export const EXPORT_ROW_LIMIT = 5000;

export type ExportSection = { about: string; rows: Record<string, unknown>[]; truncated?: true; unavailable?: true };

export type DataExport = {
  generated_at: string;
  member_id: string;
  account: { email: string | null; phone: string | null; created_at: string | null; last_sign_in_at: string | null };
  notes: string[];
  sections: Record<string, ExportSection>;
};

export const EXPORT_NOTES = [
  "This is a copy of the personal data PinPals holds about you, made at your request.",
  "Messages other members sent you are theirs and are not included; the conversations you are in are listed.",
  "Card details are held by Stripe, not PinPals. Staff notes are available on request: privacy@pinpals.ie.",
  "Questions, corrections or objections: privacy@pinpals.ie. You can also complain to the Data Protection Commission (dataprotection.ie).",
];

export function exportFileName(memberId: string, at: Date): string {
  return `pinpals-my-data-${at.toISOString().slice(0, 10)}-${memberId.slice(0, 8)}.json`;
}
