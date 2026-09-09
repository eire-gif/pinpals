"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Marks one notification read. A plain RLS-bound client update — no
 * service-role client needed: `notifications`' own UPDATE policy already
 * scopes this to the caller's own row, and `prevent_notification_tampering()`
 * (0045_marketplace_rls_hardening.sql) already restricts what an
 * authenticated caller can change on it to `read_at` alone, so this action's
 * only real job is supplying that one column. The `.is("read_at", null)`
 * guard makes a repeat call (e.g. a double-click) a harmless no-op rather
 * than overwriting an earlier read_at with a later one.
 */
export async function markNotificationRead(notificationId: number): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("user_id", user.id)
    .is("read_at", null);

  revalidatePath("/notifications");
}

/** The "Mark all as read" action on /notifications — same RLS-bound update,
 * just without the single-id filter. */
export async function markAllNotificationsRead(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .is("read_at", null);

  revalidatePath("/notifications");
}
