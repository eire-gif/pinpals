import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { notifyUser } from "./notifications-server";
import { ALERT_PREF, wordAlert, type AlertRow } from "./society-alert-wording";

/**
 * Sends what's waiting in the society alert outbox (0142–0144) and marks it
 * sent. Called by the pg_cron job every few minutes and by the app straight
 * after a member's change (POST /api/app/societies/alerts), so most alerts go
 * out within seconds and none is lost if that call never comes.
 *
 * The member's own switches for that society (society_alert_prefs) and a
 * muted group are honoured for the optional kinds; alerts about their own
 * place and messages from the officers always go. The app only (Inbox and
 * phone push): society news isn't email.
 *
 * Each alert is marked sent before it's delivered, in its own update that
 * only succeeds while it's still unsent, so two runs at once never send the
 * same alert twice.
 */
export async function sendSocietyAlerts(admin: SupabaseClient, limit = 400): Promise<{ sent: number; skipped: number }> {
  const { data: rows, error } = await admin
    .from("society_alerts")
    .select("id, group_id, outing_id, member_id, kind, payload, dedupe_key")
    .is("sent_at", null)
    .order("id")
    .limit(limit)
    .overrideTypes<AlertRow[]>();
  if (error || !rows?.length) return { sent: 0, skipped: 0 };

  const groupIds = [...new Set(rows.map((r) => r.group_id))];
  const memberIds = [...new Set(rows.map((r) => r.member_id))];
  const whoIds = [
    ...new Set(
      rows
        .map((r) => (r.kind === "request_received" ? r.payload?.member : r.kind === "message" ? r.payload?.sender : null))
        .filter((x): x is string => typeof x === "string")
    ),
  ];

  const [groups, prefs, mutes, names] = await Promise.all([
    admin.from("groups").select("id, name").in("id", groupIds).overrideTypes<{ id: number; name: string }[]>(),
    admin
      .from("society_alert_prefs")
      .select("group_id, member_id, kind, enabled")
      .in("group_id", groupIds)
      .in("member_id", memberIds)
      .eq("enabled", false)
      .overrideTypes<{ group_id: number; member_id: string; kind: string }[]>(),
    admin.from("group_members").select("group_id, member_id").in("group_id", groupIds).in("member_id", memberIds).eq("muted", true).overrideTypes<{ group_id: number; member_id: string }[]>(),
    whoIds.length
      ? admin.from("profiles").select("id, first_name").in("id", whoIds).overrideTypes<{ id: string; first_name: string | null }[]>()
      : Promise.resolve({ data: [] as { id: string; first_name: string | null }[] }),
  ]);

  const groupName = new Map((groups.data ?? []).map((g) => [g.id, g.name]));
  const off = new Set((prefs.data ?? []).map((p) => `${p.group_id}:${p.member_id}:${p.kind}`));
  const muted = new Set((mutes.data ?? []).map((m) => `${m.group_id}:${m.member_id}`));
  const firstName = new Map((names.data ?? []).map((n) => [n.id, n.first_name?.trim() || null]));

  let sent = 0;
  let skipped = 0;
  for (const row of rows) {
    // Claim it: only the run whose update still finds it unsent goes on.
    const { data: claimed } = await admin
      .from("society_alerts")
      .update({ sent_at: new Date().toISOString() })
      .eq("id", row.id)
      .is("sent_at", null)
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    const pref = ALERT_PREF[row.kind];
    const optional = pref !== null && pref !== undefined;
    if (optional && (off.has(`${row.group_id}:${row.member_id}:${pref}`) || muted.has(`${row.group_id}:${row.member_id}`))) {
      skipped += 1;
      continue;
    }
    const whoId = row.kind === "request_received" ? row.payload?.member : row.kind === "message" ? row.payload?.sender : null;
    const worded = wordAlert(row, groupName.get(row.group_id) ?? "Your society", typeof whoId === "string" ? firstName.get(whoId) ?? null : null);
    if (!worded) {
      skipped += 1;
      continue;
    }
    await notifyUser(admin, {
      userId: row.member_id,
      type: worded.type,
      title: worded.title,
      body: worded.body,
      pushBody: worded.pushBody,
      href: worded.href,
      data: { groupId: row.group_id, outingId: row.outing_id, kind: row.kind },
      dedupeKey: `society:${row.dedupe_key}`,
      appOnly: true,
    });
    sent += 1;
  }
  return { sent, skipped };
}
