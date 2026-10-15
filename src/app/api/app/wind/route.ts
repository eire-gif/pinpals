import { authenticateAppRequest, unauthenticated } from "@/lib/app-api";
import { windAt } from "@/lib/wind";

/**
 * GET /api/app/wind?lat=53.42&lng=-6.13   → { wind: Wind | null }
 *
 * The wind at a course for the hole map (src/lib/wind.ts). Members only:
 * every call spends from the weather allowance. Never an error for a member
 * — no wind is { wind: null } and the map simply leaves it off.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();
  const url = new URL(request.url);
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return Response.json({ error: "lat and lng are needed" }, { status: 400 });
  }
  let wind = null;
  try {
    wind = await windAt(lat, lng);
  } catch {
    wind = null;
  }
  return Response.json({ wind }, { headers: { "cache-control": "private, max-age=300" } });
}
