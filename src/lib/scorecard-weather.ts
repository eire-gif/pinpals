import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { pastHours, weatherCredit } from "@/lib/weather";
import { readyForWeather, roundWindow, summariseRound, type RoundWeather } from "@/lib/weather-rules";

/**
 * Saves the weather a round was played in on its scorecards (0182). Run by
 * pg_cron every ten minutes while cards are waiting: new cards a few minutes
 * after a round finishes, and every older card — past society outings
 * included — newest first, until all have been looked at.
 *
 * A card is looked at once. weather_checked_at is set whether or not weather
 * was found (no course location, nothing from the service), so nothing is
 * asked for twice; a failed call to the service leaves the card for the next
 * run. The four cards from one fourball share one call.
 *
 * WeatherKit keeps history from August 2021; older cards are marked looked
 * at with no weather.
 */

type CardRow = {
  id: number;
  played_on: string;
  club: { latitude: number | null; longitude: number | null } | null;
  round: { created_at: string; finished_at: string | null } | null;
};

const EARLIEST = "2021-08-01";

export async function fillScorecardWeather(
  admin: SupabaseClient,
  limit = 60,
  now = new Date()
): Promise<{ saved: number; none: number; waiting: number; failed: number }> {
  const credit = weatherCredit();
  if (!credit) return { saved: 0, none: 0, waiting: 0, failed: 0 };

  const { data, error } = await admin
    .from("scorecards")
    .select("id, played_on, club:clubs(latitude, longitude), round:live_rounds(created_at, finished_at)")
    .is("weather_checked_at", null)
    .lte("played_on", now.toISOString().slice(0, 10))
    .order("played_on", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit)
    .overrideTypes<CardRow[]>();
  if (error) throw new Error(error.message);

  let saved = 0;
  let none = 0;
  let waiting = 0;
  let failed = 0;
  const done = new Map<string, RoundWeather | null | "failed">();

  const mark = async (id: number, weather: RoundWeather | null) => {
    const { error: e } = await admin
      .from("scorecards")
      .update({ weather, weather_checked_at: now.toISOString() })
      .eq("id", id);
    if (e) throw new Error(e.message);
  };

  for (const card of data ?? []) {
    const lat = card.club?.latitude;
    const lng = card.club?.longitude;
    const timing = { playedOn: card.played_on, startedAt: card.round?.created_at ?? null, finishedAt: card.round?.finished_at ?? null };
    if (lat == null || lng == null || card.played_on < EARLIEST) {
      await mark(card.id, null);
      none++;
      continue;
    }
    if (!readyForWeather(timing, now)) {
      waiting++;
      continue;
    }
    const { from, to } = roundWindow(timing);
    const key = `${lat.toFixed(2)},${lng.toFixed(2)}:${from.toISOString()}:${to.toISOString()}`;
    if (!done.has(key)) {
      try {
        const hours = await pastHours(lat, lng, from, to);
        done.set(key, hours == null ? "failed" : summariseRound(hours, credit.credit));
      } catch {
        done.set(key, "failed");
      }
    }
    const weather = done.get(key);
    if (weather === "failed" || weather === undefined) {
      failed++;
      continue;
    }
    await mark(card.id, weather);
    if (weather) saved++;
    else none++;
  }
  return { saved, none, waiting, failed };
}
