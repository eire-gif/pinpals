"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { OPTIONAL_NOTIFICATION_CATEGORIES } from "@/lib/notifications";

export type NotificationPreferencesState = { error?: string; success?: boolean };

/**
 * Upserts one row per optional category (messages/offers/auctions/reviews/
 * tee_times — see OPTIONAL_NOTIFICATION_CATEGORIES) from a single settings
 * form's checkboxes. An unchecked checkbox simply doesn't appear in
 * `formData`, so absence is read as `false` here, not skipped — every submit
 * of this form writes every row, which is what makes "no row yet" (a member
 * who's never visited this page) correctly default to enabled elsewhere
 * (shouldSendEmail()/shouldSendPush() in src/lib/notifications.ts) while a
 * member who explicitly saved "off" stays off.
 *
 * Since 0075 each category carries two switches rather than one, named
 * `<category>__email` and `<category>__push`. Still ONE upsert covering
 * every row — the reason the column-per-channel shape was chosen over a
 * row-per-channel one.
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
    email_enabled: formData.get(`${category}__email`) === "on",
    push_enabled: formData.get(`${category}__push`) === "on",
  }));

  const { error } = await supabase.from("notification_preferences").upsert(rows, { onConflict: "user_id,category" });

  if (error) return { error: "Couldn't save your notification settings — please try again." };

  revalidatePath("/dashboard/notifications");
  return { success: true };
}

export type PushSubscriptionState = { error?: string };

/**
 * Stores (or re-stores) the calling member's browser push subscription.
 *
 * Everything interesting happens inside register_push_subscription() (0075),
 * which is SECURITY DEFINER and always assigns the row to auth.uid(). That
 * matters for the shared-device case: when a second member signs in on the
 * same iPad, the browser hands back the SAME endpoint, and the endpoint must
 * MOVE to them rather than producing a second row that would buzz the first
 * member's notifications on a device they no longer use. No RLS policy can
 * express "rewrite a row you don't own yet", which is why this is an RPC and
 * not an upsert.
 *
 * Called on every mount of PushOptIn where permission is already granted, so
 * it must stay cheap and idempotent.
 */
export async function savePushSubscription(input: {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
}): Promise<PushSubscriptionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You need to be signed in to turn on notifications." };

  // Shape-check before the round trip. The DB has its own CHECK constraints
  // (https-only, length bounds) — this is just a friendlier failure for the
  // one case that actually happens: a browser extension or a privacy mode
  // handing back a malformed subscription.
  if (!input.endpoint.startsWith("https://") || !input.p256dh || !input.auth) {
    return { error: "This browser returned a subscription we can't use." };
  }

  const { error } = await supabase.rpc("register_push_subscription", {
    p_endpoint: input.endpoint,
    p_p256dh: input.p256dh,
    p_auth: input.auth,
    p_user_agent: input.userAgent ?? null,
  });

  if (error) {
    console.error("[push] register_push_subscription failed:", error.message);
    return { error: "Couldn't turn on notifications for this device — please try again." };
  }

  revalidatePath("/dashboard/notifications");
  return {};
}

/**
 * Removes one device. Used both by the "turn off on this device" button and
 * by the device list's Remove buttons — a member signing out of a lost phone
 * needs to be able to do this from a different device, which is why it takes
 * an endpoint rather than acting on "the current one".
 *
 * The DELETE policy (0075) scopes this to the caller's own rows, so passing
 * somebody else's endpoint deletes nothing rather than erroring — which is
 * the right shape: it leaks no information about whether that endpoint
 * exists.
 */
export async function removePushSubscription(endpoint: string): Promise<PushSubscriptionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You need to be signed in to change notification settings." };

  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);

  if (error) return { error: "Couldn't remove that device — please try again." };

  revalidatePath("/dashboard/notifications");
  return {};
}

/** FormData wrapper for the device list's Remove buttons, so each row can be
 * its own tiny form rather than a client component. */
export async function removePushDeviceAction(formData: FormData): Promise<void> {
  const endpoint = formData.get("endpoint");
  if (typeof endpoint === "string" && endpoint.length > 0) {
    await removePushSubscription(endpoint);
  }
}
