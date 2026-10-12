import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { notifyUser } from "./notifications-server";

/**
 * Scorecard certification notifications (0128), sent with the admin client
 * after the app has written the request or the answer itself.
 *
 *   asked      → the certifier: "Eire asks you to certify their card"
 *   certified  → the owner: "John certified your card"
 *   queried    → the owner: "John queried the 7th on your card"
 *   declined   → the owner: "John didn't certify your card"
 *
 * App only (Inbox and phone push), never email: certifying needs the app,
 * and the website has no page for either end of it. Each carries a dedupe
 * key, so a retried request never buzzes anyone twice.
 *
 * The certifier's note on a query is the other member's own words, so it
 * stays in the in-app Inbox and never reaches a lock screen.
 */

type Row = {
  id: number;
  scorecard_id: number;
  owner_id: string;
  certifier_id: string | null;
  status: string;
  method: string | null;
  query_hole: number | null;
  expires_at: string;
};

const METHOD_LABEL: Record<string, string> = {
  face_id: "Face ID",
  touch_id: "Touch ID",
  biometric: "fingerprint or face unlock",
  in_app: "the PinPals app",
};

const ordinal = (n: number) => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
};

const shortDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Dublin" });

async function firstName(admin: SupabaseClient, id: string | null): Promise<string> {
  if (!id) return "A PinPal";
  const { data } = await admin.from("profiles").select("first_name").eq("id", id).maybeSingle<{ first_name: string | null }>();
  return data?.first_name?.trim() || "A PinPal";
}

/**
 * Sends whatever the request's current state calls for, if `callerId` is the
 * person whose move produced it: the owner for a pending request, the
 * certifier for an answer. Anything else sends nothing. Returns the type sent.
 */
export async function notifyCertification(admin: SupabaseClient, certificationId: number, callerId: string): Promise<string | null> {
  const { data: row } = await admin
    .from("scorecard_certifications")
    .select("id, scorecard_id, owner_id, certifier_id, status, method, query_hole, expires_at")
    .eq("id", certificationId)
    .maybeSingle<Row>();
  if (!row || !row.certifier_id) return null;

  // Nothing between two people where either has blocked the other.
  // (Both ids in both columns matches exactly the two directions: nobody can block themselves.)
  const pair = [row.owner_id, row.certifier_id];
  const { count: blocks } = await admin
    .from("blocked_users")
    .select("blocker_id", { count: "exact", head: true })
    .in("blocker_id", pair)
    .in("blocked_id", pair);
  if ((blocks ?? 0) > 0) return null;

  const { data: card } = await admin
    .from("scorecards")
    .select("course_name, played_on")
    .eq("id", row.scorecard_id)
    .maybeSingle<{ course_name: string; played_on: string }>();
  if (!card) return null;
  const where = `${card.course_name}, ${shortDate(card.played_on)}`;

  if (row.status === "pending" && callerId === row.owner_id) {
    if (new Date(row.expires_at).getTime() <= Date.now()) return null;
    const owner = await firstName(admin, row.owner_id);
    await notifyUser(admin, {
      userId: row.certifier_id,
      type: "scorecard_certify_request",
      title: `${owner} asks you to certify their card`,
      body: `${where}. Check the scores hole by hole, then certify or query a hole.`,
      href: `/scorecards/certify/${row.id}`,
      dedupeKey: `scorecard_certify_request:${row.id}`,
      appOnly: true,
    });
    return "scorecard_certify_request";
  }

  if (callerId !== row.certifier_id) return null;
  const who = await firstName(admin, row.certifier_id);
  const base = { userId: row.owner_id, type: "scorecard_certify_result" as const, href: `/scorecards/${row.scorecard_id}`, appOnly: true };

  if (row.status === "certified") {
    await notifyUser(admin, {
      ...base,
      title: `✓ ${who} certified your card`,
      body: `${where} · with ${METHOD_LABEL[row.method ?? ""] ?? "the PinPals app"}.`,
      dedupeKey: `scorecard_certify_result:${row.id}:certified`,
    });
  } else if (row.status === "queried") {
    await notifyUser(admin, {
      ...base,
      title: `${who} queried the ${ordinal(row.query_hole ?? 1)} on your card`,
      body: `${where}. Open the card to see their note, fix it if needed, and ask again.`,
      dedupeKey: `scorecard_certify_result:${row.id}:queried`,
    });
  } else if (row.status === "declined") {
    await notifyUser(admin, {
      ...base,
      title: `${who} didn't certify your card`,
      body: `${where}. You can ask someone else who played with you.`,
      dedupeKey: `scorecard_certify_result:${row.id}:declined`,
    });
  } else {
    return null;
  }
  return "scorecard_certify_result";
}
