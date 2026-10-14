import { NextResponse } from "next/server";

import { isCronAuthorised } from "@/lib/cron-auth";
import { sendSocietyAlerts } from "@/lib/society-alerts";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Sends the society alert outbox (0142–0144). Called every few minutes by
 * pg_cron (0143, job 'pinpals-society-alerts') with the bearer token in
 * vault secret 'society_alerts_cron_secret' — the same value as
 * SOCIETY_ALERTS_CRON_SECRET here. The secret is the whole of its access
 * control; an unset secret disables the route.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!isCronAuthorised(request, process.env.SOCIETY_ALERTS_CRON_SECRET, "society-alerts")) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  try {
    const result = await sendSocietyAlerts(createAdminClient(), 600);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("[society-alerts] run failed", error);
    return NextResponse.json({ error: "Run failed" }, { status: 500 });
  }
}

export function GET() {
  return NextResponse.json({ error: "Use POST" }, { status: 405 });
}
