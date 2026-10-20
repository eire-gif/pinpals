import { useEffect, useState } from "react";

import { getFromSite } from "./api";
import { loadDistanceUnit } from "./distance-unit";
import { supabase } from "./supabase";
import type { Forecast } from "./weather-rules";

/**
 * Weather reads (Oct 2026): a course's forecast from the website
 * (/api/app/weather, src/lib/weather.ts) and where a club is. The sums are in
 * weather-rules.ts.
 */

const forecastCache = new Map<string, { at: number; forecast: Forecast | null }>();
const FIFTEEN_MINUTES = 15 * 60 * 1000;

/** The hour now and the next ten days at a place; null when there's none. */
export async function loadForecast(lat: number, lng: number): Promise<Forecast | null> {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  const hit = forecastCache.get(key);
  if (hit && Date.now() - hit.at < FIFTEEN_MINUTES) return hit.forecast;
  const { forecast } = await getFromSite<{ forecast: Forecast | null }>(`/api/app/weather?lat=${lat.toFixed(4)}&lng=${lng.toFixed(4)}`);
  forecastCache.set(key, { at: Date.now(), forecast });
  return forecast;
}

const clubCache = new Map<number, Promise<{ lat: number; lng: number } | null>>();

/** A club's location, from the course directory; null when it has none. */
export function clubLocation(clubId: number): Promise<{ lat: number; lng: number } | null> {
  let p = clubCache.get(clubId);
  if (!p) {
    p = Promise.resolve(
      supabase
        .from("clubs")
        .select("latitude, longitude")
        .eq("id", clubId)
        .maybeSingle<{ latitude: number | null; longitude: number | null }>()
    ).then(({ data }) => (data?.latitude != null && data.longitude != null ? { lat: data.latitude, lng: data.longitude } : null));
    p.catch(() => clubCache.delete(clubId));
    clubCache.set(clubId, p);
  }
  return p;
}

/** A club's forecast; null when the club has no location or there's no weather. */
export async function loadClubForecast(clubId: number): Promise<Forecast | null> {
  const at = await clubLocation(clubId);
  return at ? loadForecast(at.lat, at.lng) : null;
}

/** Wind in mph unless the member chose metres on the hole map (then km/h). */
export function useMph(): boolean {
  const [mph, setMph] = useState(true);
  useEffect(() => {
    let on = true;
    void loadDistanceUnit().then((u) => on && setMph(u !== "metres"));
    return () => {
      on = false;
    };
  }, []);
  return mph;
}
