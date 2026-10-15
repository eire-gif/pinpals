import type { SupabaseClient } from "@supabase/supabase-js";

import { notifyUser } from "./notifications-server";

type AlertRow = { id: number; member_id: string; title: string; body: string; href: string; dedupe_key: string };

/**
 * Sends what's waiting in the competition alert outbox (0148) and marks it
 * sent: a draw, a result to confirm, a challenge, a dispute to settle, a
 * place in the next round. Called by the pg_cron job every few minutes and
 * by the app straight after a member's change (POST
 * /api/app/competitions/alerts), so most go out within seconds and none is
 * lost if that call never comes.
 *
 * The app only (Inbox and phone push), under the member's tee times
 * switch. The words were built by the database from names, competition
 * names and margins — never free text a member typed.
 *
 * Each alert is claimed (marked sent) before it is delivered, in an update
 * that only succeeds while it is still unsent, so two runs at once never
 * send the same alert twice.
 */
export async function sendCompetitionAlerts(admin: SupabaseClient, limit = 400): Promise<{ sent: number }> {
  const { data: rows, error } = await admin
    .from("competition_alerts")
    .select("id, member_id, title, body, href, dedupe_key")
    .is("sent_at", null)
    .order("id")
    .limit(limit)
    .overrideTypes<AlertRow[]>();
  if (error || !rows?.length) return { sent: 0 };

  let sent = 0;
  for (const row of rows) {
    const { data: claimed } = await admin
      .from("competition_alerts")
      .update({ sent_at: new Date().toISOString() })
      .eq("id", row.id)
      .is("sent_at", null)
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    await notifyUser(admin, {
      userId: row.member_id,
      type: "competition",
      title: row.title,
      body: row.body,
      href: row.href,
      dedupeKey: `competition:${row.dedupe_key}`,
      appOnly: true,
    });
    sent += 1;
  }
  return { sent };
}
