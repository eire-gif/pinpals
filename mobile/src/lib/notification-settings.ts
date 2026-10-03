import { supabase } from "./supabase";

/**
 * Which alerts a member gets, by email and on this phone.
 *
 * Mirrors OPTIONAL_NOTIFICATION_CATEGORIES and its labels in
 * src/lib/notifications.ts on the site — the set the
 * notification_preferences check constraint allows (0056, 0075, 0088).
 * Payments, refunds and disputes are not here on purpose: they cannot be
 * switched off, by email or by push, because there is no row to store "off".
 *
 * Read and written straight to the table: its policies (0056) let a member
 * read and write only their own rows, and nothing follows from saving. A
 * missing row means "on" — exactly how the site's dispatch reads it — so
 * every save writes every category, as the website's form does.
 */

export const CATEGORIES = ["messages", "offers", "auctions", "reviews", "tee_times", "feed"] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  messages: "New messages",
  offers: "Offers",
  auctions: "Auctions & bids",
  reviews: "Reviews",
  tee_times: "Tee times",
  feed: "Your posts",
};

export const CATEGORY_DESCRIPTIONS: Record<Category, string> = {
  messages: "When another member sends you a new message.",
  offers: "Offers you receive, and updates on offers you've made.",
  auctions: "Outbid alerts, auctions ending soon, and results.",
  reviews: "When you're able to leave a review after a completed order.",
  tee_times: "When someone you've connected with posts a tee time.",
  feed: "When another member comments on something you posted, or replies to your comment.",
};

export type Preference = { email: boolean; push: boolean };
export type Preferences = Record<Category, Preference>;

export async function loadPreferences(userId: string): Promise<Preferences> {
  const { data, error } = await supabase
    .from("notification_preferences")
    .select("category, email_enabled, push_enabled")
    .eq("user_id", userId)
    .overrideTypes<{ category: string; email_enabled: boolean; push_enabled: boolean }[]>();
  if (error) throw new Error("Couldn't load your settings. Pull down to try again.");

  const prefs = Object.fromEntries(CATEGORIES.map((c) => [c, { email: true, push: true }])) as Preferences;
  for (const row of data ?? []) {
    if ((CATEGORIES as readonly string[]).includes(row.category)) {
      prefs[row.category as Category] = { email: row.email_enabled, push: row.push_enabled };
    }
  }
  return prefs;
}

export async function savePreferences(userId: string, prefs: Preferences): Promise<void> {
  const rows = CATEGORIES.map((category) => ({
    user_id: userId,
    category,
    email_enabled: prefs[category].email,
    push_enabled: prefs[category].push,
  }));
  const { error } = await supabase.from("notification_preferences").upsert(rows, { onConflict: "user_id,category" });
  if (error) throw new Error("Couldn't save your notification settings — please try again.");
}
