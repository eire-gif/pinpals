"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Marks one alert read.
 *
 * A plain RLS-bound update: `notifications`' own UPDATE policy scopes it to
 * the caller's row, and prevent_notification_tampering()
 * (0045_marketplace_rls_hardening.sql) already restricts an authenticated
 * caller to changing `read_at` alone — so this action's only real job is
 * supplying that one column. The `.is("read_at", null)` guard makes a repeat
 * call a harmless no-op rather than pushing an earlier read_at later.
 */
export async function markAlertRead(notificationId: number): Promise<void> {
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

  revalidatePath("/inbox");
}

/**
 * "Mark all as read" — one RPC, both streams.
 *
 * This is why mark_inbox_read() exists in 0083 rather than two updates here.
 * Clearing alerts and clearing message cursors are two statements against
 * two tables with two different tampering triggers; doing them from the
 * client half-succeeds the moment one of them errors, and a badge stuck at
 * "3" with nothing unread underneath it is the exact complaint this whole
 * change is meant to answer.
 *
 * It marks read and nothing else. No row is deleted, no thread is hidden —
 * scroll back tomorrow and the list is the same list, minus the emphasis.
 */
export async function markInboxRead(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.rpc("mark_inbox_read");

  // The badge is rendered by the site header on every route, so a stale
  // layout is a stale badge everywhere. `layout` scope re-runs the header's
  // own count query rather than just this page's.
  revalidatePath("/", "layout");
}
