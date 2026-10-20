import { authenticateAppRequest, unauthenticated } from "@/lib/app-api";
import { forecastAt } from "@/lib/weather";

/**
 * GET /api/app/weather?lat=53.42&lng=-6.13   → { forecast: Forecast | null }
 *
 * A course's weather, the hour now and the next ten days hour by hour
 * (src/lib/weather.ts): the strip on live scoring and the forecast on an
 * upcoming round. Members only, as every call spends from the weather
 * allowance. Never an error for a member — no weather is { forecast: null }
 * and the app simply leaves it off.
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
  let forecast = null;
  try {
    forecast = await forecastAt(lat, lng);
  } catch {
    forecast = null;
  }
  return Response.json({ forecast }, { headers: { "cache-control": "private, max-age=600" } });
}
