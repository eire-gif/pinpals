import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { NotificationPreference, PushSubscriptionRecord } from "@/lib/types";
import { OPTIONAL_NOTIFICATION_CATEGORIES, type OptionalNotificationCategory } from "@/lib/notifications";
import { describeDevice } from "@/lib/push";
import NotificationPreferencesForm, { type ChannelPreferences } from "./preferences-form";
import PushOptIn from "@/components/push-opt-in";
import { removePushDeviceAction } from "./actions";

/**
 * The settings page NOTIFICATION_CATEGORY_LABELS/DESCRIPTIONS exist for —
 * a switch per channel per optional category (messages/offers/auctions/
 * reviews/tee_times). Absence of a stored row means "on" for BOTH channels
 * (see shouldSendEmail()/shouldSendPush() in src/lib/notifications.ts) —
 * this page reads that same default so a member who's never visited it sees
 * every switch already on, matching what they've actually been receiving.
 *
 * "Push is on for this category" and "this member has a device that can
 * receive push" are deliberately separate questions. Most members will have
 * every push switch on and no devices at all, which is why the opt-in card
 * sits below the table rather than gating it.
 */
export default async function NotificationSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/notifications");

  const [{ data: prefs }, { data: devices }] = await Promise.all([
    supabase.from("notification_preferences").select("*").eq("user_id", user.id).returns<NotificationPreference[]>(),
    supabase
      .from("push_subscriptions")
      .select("id, endpoint, user_agent, created_at, last_success_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .returns<PushSubscriptionRecord[]>(),
  ]);

  const prefByCategory = new Map((prefs ?? []).map((p) => [p.category, p]));
  const initialValues = Object.fromEntries(
    OPTIONAL_NOTIFICATION_CATEGORIES.map((category) => {
      const pref = prefByCategory.get(category);
      return [category, { email: pref?.email_enabled ?? true, push: pref?.push_enabled ?? true }];
    })
  ) as Record<OptionalNotificationCategory, ChannelPreferences>;

  return (
    <div className="max-w-xl mx-auto px-6 py-12">
      <Link href="/notifications" className="text-sm text-green-700 font-bold">
        &larr; Back to notifications
      </Link>
      <h1 className="font-display font-bold text-2xl mt-3 mb-1">Notification settings</h1>
      <p className="text-ink-500 mb-6">Choose how each kind of activity reaches you.</p>

      <NotificationPreferencesForm initialValues={initialValues} />

      <div className="mt-6">
        <PushOptIn />
      </div>

      {devices && devices.length > 0 && (
        <div className="mt-6 bg-surface border border-line rounded-2xl p-6">
          <h2 className="font-display font-bold text-lg text-ink-900">Your devices</h2>
          <p className="mt-1 text-sm text-ink-500">
            Remove a device to stop notifications reaching it — useful if you&rsquo;ve lost a phone or signed in on
            someone else&rsquo;s.
          </p>

          <ul className="mt-4 flex flex-col divide-y divide-line">
            {devices.map((device) => (
              <li key={device.id} className="py-3 flex items-center gap-4">
                <span className="flex-1">
                  <span className="block text-sm font-bold text-ink-900">{describeDevice(device.user_agent)}</span>
                  <span className="block text-xs text-ink-500 mt-0.5">
                    Added{" "}
                    {new Date(device.created_at).toLocaleDateString("en-IE", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                    {device.last_success_at ? " · active" : " · not used yet"}
                  </span>
                </span>
                <form action={removePushDeviceAction}>
                  <input type="hidden" name="endpoint" value={device.endpoint} />
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-full text-sm font-bold border border-line text-ink-900 hover:bg-cream-100 transition"
                  >
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
