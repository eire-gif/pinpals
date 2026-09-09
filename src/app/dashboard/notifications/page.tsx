import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { NotificationPreference } from "@/lib/types";
import { OPTIONAL_NOTIFICATION_CATEGORIES, type OptionalNotificationCategory } from "@/lib/notifications";
import NotificationPreferencesForm from "./preferences-form";

/**
 * The settings page NOTIFICATION_CATEGORY_LABELS/DESCRIPTIONS exist for —
 * toggles for the 4 optional email categories (messages/offers/auctions/
 * reviews). Absence of a stored row means "on" (see shouldSendEmail() in
 * src/lib/notifications.ts) — this page reads that same default so a
 * member who's never visited it sees every toggle already on, matching what
 * they've actually been receiving.
 */
export default async function NotificationSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/notifications");

  const { data: prefs } = await supabase
    .from("notification_preferences")
    .select("*")
    .eq("user_id", user.id)
    .returns<NotificationPreference[]>();

  const prefByCategory = new Map((prefs ?? []).map((p) => [p.category, p.email_enabled]));
  const initialValues = Object.fromEntries(
    OPTIONAL_NOTIFICATION_CATEGORIES.map((category) => [category, prefByCategory.get(category) ?? true])
  ) as Record<OptionalNotificationCategory, boolean>;

  return (
    <div className="max-w-xl mx-auto px-6 py-12">
      <Link href="/notifications" className="text-sm text-green-700 font-bold">
        &larr; Back to notifications
      </Link>
      <h1 className="font-display font-bold text-2xl mt-3 mb-1">Notification settings</h1>
      <p className="text-ink-500 mb-6">Choose which activity emails you a notification for.</p>

      <NotificationPreferencesForm initialValues={initialValues} />
    </div>
  );
}
