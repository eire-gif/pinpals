import { NextResponse } from "next/server";
import { isCountryCode, regionsForCountry } from "@/lib/regions";

/**
 * The counties in a country, for the app's post-a-tee-time form.
 *
 * The app cannot derive this from the club it picked: `clubs.region` is null
 * for almost every club outside England — Ireland has 429 clubs and no regions
 * at all — which is precisely why the website asks the member rather than
 * inferring it. So the app needs the list, and the list is a hand-maintained
 * constant in src/lib/regions.ts.
 *
 * Served rather than copied into the app deliberately. A duplicated county
 * list would be a second source of truth shipped inside a binary that takes a
 * week to update, and the first time a region is renamed or added the two
 * would disagree with no way to tell which was right.
 *
 * Public and unauthenticated, like /api/clubs, and for the same reason: it is
 * a static list of place names, already on every page of /courses.
 */
export async function GET(request: Request) {
  const country = new URL(request.url).searchParams.get("country") ?? "";

  if (!isCountryCode(country)) {
    return NextResponse.json({ error: "unknown country" }, { status: 400 });
  }

  return NextResponse.json(
    { regions: regionsForCountry(country) },
    {
      // Changes only when someone edits a constant and redeploys, so a long
      // shared cache is free and keeps repeated form opens off the server.
      headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" },
    }
  );
}
