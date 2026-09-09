"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { OPTIONAL_NOTIFICATION_CATEGORIES } from "@/lib/notifications";

export type NotificationPreferencesState = { error?: string; success?: boolean };

/**
 * Upserts one row per optional category (messages/offers/auctions/reviews —
 * see OPTIONAL_NOTIFICATION_CATEGORIES) from a single settings form's
 * checkboxes. An unchecked checkbox simply doesn't appear in `formData`, so
 * absence is read as `false` here, not skipped — every submit of this form
 * writes all four rows, which is what makes "no row yet" (a member who's
 * never visited this page) correctly default to enabled elsewhere
 * (shouldSendEmail() in src/lib/notifications.ts) while a member who
 * explicitly saved "off" stays off.
 *
 * A plain RLS-bound client upsert, no service-role client — `notification_
 * preferences`' own policies (0056) already scope every one of insert/
 * update/select/delete to the caller's own user_id.
 */
export async function updateNotificationPreferences(
  _prev: NotificationPreferencesState,
  formData: FormData
): Promise<NotificationPreferencesState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You need to be signed in to change notification settings." };

  const rows = OPTIONAL_NOTIFICATION_CATEGORIES.map((category) => ({
    user_id: user.id,
    category,
    email_enabled: formData.get(category) === "on",
  }));

  const { error } = await supabase.from("notification_preferences").upsert(rows, { onConflict: "user_id,category" });

  if (error) return { error: "Couldn't save your notification settings — please try again." };

  revalidatePath("/dashboard/notifications");
  return { success: true };
}
