import { NextResponse } from "next/server";
import { searchClubsInCountry } from "@/lib/courses";
import { isCountryCode } from "@/lib/regions";

/**
 * Club suggestions for the home-club picker.
 *
 * This route exists because the picker stopped being able to hold its own
 * data. It used to import a JSON array of 373 club names and filter it in the
 * browser; at ~3,000 clubs across five countries that array is a payload
 * nobody should be downloading to type three letters into a box.
 *
 * Deliberately public and unauthenticated: `clubs` is world-readable by
 * design (the course directory is browsable logged-out), so requiring a
 * session here would protect nothing and would break the picker on the signup
 * path, where there isn't one yet. Results are capped at 20 and require a
 * country, so it can't be used to walk the whole table cheaply — and the
 * whole table is on /courses anyway.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const country = url.searchParams.get("country") ?? "";
  const q = (url.searchParams.get("q") ?? "").slice(0, 80);

  if (!isCountryCode(country)) {
    return NextResponse.json({ error: "unknown country" }, { status: 400 });
  }

  const clubs = await searchClubsInCountry(country, q);

  return NextResponse.json(
    { clubs },
    {
      // The club list changes only when an import or a staff edit runs, so a
      // short shared cache is safe and takes the repeated-keystroke load off
      // the database. Not `private`: there is nothing user-specific here.
      headers: { "Cache-Control": "public, max-age=60, s-maxage=300" },
    }
  );
}
