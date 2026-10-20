import { NextResponse } from "next/server";

import { isCronAuthorised } from "@/lib/cron-auth";
import { fillScorecardWeather } from "@/lib/scorecard-weather";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Saves the weather on scorecards that are waiting for it (0182,
 * src/lib/scorecard-weather.ts). Called every ten minutes by pg_cron (job
 * 'pinpals-scorecard-weather') while any card is waiting, with the
 * scheduled-jobs secret from the vault: 'weather_cron_secret' if it has been
 * set up (matching WEATHER_CRON_SECRET here), otherwise
 * 'account_deletion_cron_secret' (ACCOUNT_DELETION_CRON_SECRET), as the
 * society alerts do. Unset, the route is off.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!isCronAuthorised(request, process.env.WEATHER_CRON_SECRET || process.env.ACCOUNT_DELETION_CRON_SECRET, "scorecard-weather")) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  try {
    const result = await fillScorecardWeather(createAdminClient(), 60);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("[scorecard-weather] run failed", error);
    return NextResponse.json({ error: "Run failed" }, { status: 500 });
  }
}

export function GET() {
  return NextResponse.json({ error: "Use POST" }, { status: 405 });
}
