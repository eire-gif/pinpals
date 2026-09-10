/**
 * Coordinates for the "tee times near me" search — pure, framework-free, no
 * Supabase and no Next.js, so the rounding and validation below can be
 * unit-tested directly (same shape as src/lib/notifications.ts).
 *
 * ============ Why coordinates get rounded ============
 *
 * A browser's geolocation API returns a position accurate to a few metres.
 * That is someone's house. It then travels in a URL, which means it lands in
 * the server's access logs, the CDN's logs, the browser's own history, and
 * any link the member copies to someone else. None of those are places a
 * home address belongs, and none of them are cleaned up later.
 *
 * So the position is rounded before it ever leaves the browser. Two decimal
 * places is about 1.1 km of latitude — coarse enough that the stored point is
 * a neighbourhood rather than an address, and far finer than a 30 km search
 * radius can distinguish. A member searching from home and a member searching
 * from the shop at the end of their road get the same results, which is the
 * correct behaviour for this feature and a much better privacy position than
 * logging their doorstep for the sake of precision nobody can use.
 *
 * Nothing is stored server-side. The position lives in the URL of one search
 * and is gone when the member navigates away; the browser remembers the
 * permission, this app does not remember the place.
 */

/** Decimal places kept on a shared coordinate. 2 dp ≈ 1.1 km. */
export const COORD_PRECISION = 2;

export function roundCoord(value: number): number {
  const factor = 10 ** COORD_PRECISION;
  return Math.round(value * factor) / factor;
}

/** Offered radii in km. 30 is the default because it's roughly "worth the
 * drive for a round" in Irish terms; the others are there for a city member
 * who wants to stay local and a rural one who has to travel. */
export const RADIUS_OPTIONS = [10, 30, 50, 100] as const;
export const DEFAULT_RADIUS_KM = 30;

export type Coords = { lat: number; lng: number };

/**
 * Read a coordinate pair out of URL search params.
 *
 * Returns null unless both values are present, numeric, finite and inside the
 * real range for latitude and longitude — a URL is user-editable, and
 * "?lat=banana" or "?lat=999" should quietly fall back to the unfiltered page
 * rather than reaching the database or throwing in front of the member.
 */
export function parseCoords(lat: string | undefined, lng: string | undefined): Coords | null {
  if (!lat || !lng) return null;

  const parsedLat = Number(lat);
  const parsedLng = Number(lng);

  if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) return null;
  if (parsedLat < -90 || parsedLat > 90) return null;
  if (parsedLng < -180 || parsedLng > 180) return null;

  return { lat: parsedLat, lng: parsedLng };
}

/** Clamp a radius from the URL onto one of the offered options, defaulting
 * when it's missing or nonsense. The database clamps too — this is so the UI
 * and the query agree on what was actually searched. */
export function parseRadiusKm(radius: string | undefined): number {
  const parsed = Number(radius);
  if (!Number.isFinite(parsed)) return DEFAULT_RADIUS_KM;
  return (RADIUS_OPTIONS as readonly number[]).includes(parsed) ? parsed : DEFAULT_RADIUS_KM;
}

/**
 * How a distance reads on a card.
 *
 * Under 1 km is "less than 1 km" rather than "0.4 km": the underlying
 * position is only good to about a kilometre after rounding, so a decimal
 * there would be precision this app does not actually have. Above 10 km the
 * decimal is dropped for the same reason — "24 km" is honest, "24.3 km" is
 * a false claim about a coordinate rounded to the nearest kilometre.
 */
export function formatDistance(km: number): string {
  if (!Number.isFinite(km) || km < 0) return "";
  if (km < 1) return "Less than 1 km away";
  if (km < 10) return `${km.toFixed(1)} km away`;
  return `${Math.round(km)} km away`;
}
