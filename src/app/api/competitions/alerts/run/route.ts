import { NextResponse } from "next/server";

import { sendCompetitionAlerts } from "@/lib/competition-alerts";
import { isCronAuthorised } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Sends the competition alert outbox (0148). Called every few minutes by
 * pg_cron (job 'pinpals-competition-alerts') with the same bearer token as
 * the society alerts: SOCIETY_ALERTS_CRON_SECRET if set, otherwise
 * ACCOUNT_DELETION_CRON_SECRET. The secret is the whole of its access
 * control; unset, the route is off.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!isCronAuthorised(request, process.env.SOCIETY_ALERTS_CRON_SECRET || process.env.ACCOUNT_DELETION_CRON_SECRET, "competition-alerts")) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  try {
    const result = await sendCompetitionAlerts(createAdminClient(), 600);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("[competition-alerts] run failed", error);
    return NextResponse.json({ error: "Run failed" }, { status: 500 });
  }
}

export function GET() {
  return NextResponse.json({ error: "Use POST" }, { status: 405 });
}
