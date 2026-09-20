import { postToSite } from "./api";
import { SITE_URL } from "./config";
import { supabase } from "./supabase";

/**
 * Everything the post-a-tee-time form needs.
 *
 * Reads go straight to Supabase — `clubs` is world-readable, it is the same
 * table /courses browses. The write goes through the site, because posting
 * emails every one of the host's connections and that fan-out lives in
 * TypeScript on the server.
 */

export type ClubHit = {
  id: number;
  name: string;
  town: string | null;
  country: string;
};

export const COUNTRY_NAMES: Record<string, string> = {
  ireland: "Ireland",
  "northern-ireland": "Northern Ireland",
  england: "England",
  scotland: "Scotland",
  wales: "Wales",
};

/**
 * Club suggestions.
 *
 * Searched across all five countries at once rather than making the member
 * choose a country first, the way the website's picker does. On a phone that
 * is one fewer control, and the club's own row carries the country — so
 * picking "Portmarnock" settles the country question without asking it.
 */
export async function searchClubs(query: string): Promise<ClubHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const { data, error } = await supabase
    .from("clubs")
    .select("id, name, town, country")
    .ilike("name", `%${q}%`)
    .order("name")
    .limit(20)
    .overrideTypes<ClubHit[]>();

  if (error) throw error;
  return data ?? [];
}

/**
 * The counties in a country.
 *
 * Fetched rather than bundled: `clubs.region` is null for almost every club
 * outside England, so it cannot be derived from the chosen club, and a copy of
 * the list inside the app would be a second source of truth shipped in a
 * binary that takes a week to update. Unauthenticated, like the endpoint.
 */
export async function regionsFor(country: string): Promise<string[]> {
  const response = await fetch(
    `${SITE_URL}/api/regions?country=${encodeURIComponent(country)}`
  );
  if (!response.ok) return [];
  const { regions } = (await response.json()) as { regions?: string[] };
  return regions ?? [];
}

export type NewInvite = {
  clubId: number;
  country: string;
  county: string;
  playDate: string;
  timeFrom: string | null;
  timeTo: string | null;
  exactTeeTime: string | null;
  spaces: number;
  hasTeeTime: boolean;
  handicapLimit: number | null;
  notes: string | null;
  visibility: "everyone" | "connections";
  ladiesOnly: boolean;
};

export async function postTeeTime(invite: NewInvite): Promise<number> {
  const { invite_id } = await postToSite<{ invite_id: number }>(
    "/api/app/tee-times/invites",
    {
      club_id: invite.clubId,
      country: invite.country,
      county: invite.county,
      play_date: invite.playDate,
      time_from: invite.timeFrom,
      time_to: invite.timeTo,
      exact_tee_time: invite.exactTeeTime,
      spaces: invite.spaces,
      has_tee_time: invite.hasTeeTime,
      handicap_limit: invite.handicapLimit,
      notes: invite.notes,
      visibility: invite.visibility,
      ladies_only: invite.ladiesOnly,
    }
  );
  return invite_id;
}

// ===========================================================================
// Dates and times, without a native picker
// ===========================================================================
//
// A wheel picker would mean adding @react-native-community/datetimepicker,
// which is a native module — every member would need a new build of the app
// before they could post a round. Lists of real options cost nothing, and on a
// phone "Sat 27 Sep" in a list is quicker to hit than three spinning columns.

export type DayOption = { iso: string; label: string };

/** Local calendar dates, not UTC: `toISOString()` rolls over at midnight UTC,
 *  which is 1am in Ireland during BST and would offer yesterday as today. */
export function nextDays(count = 42, from = new Date()): DayOption[] {
  const days: DayOption[] = [];

  for (let i = 0; i < count; i += 1) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");

    days.push({
      iso: `${d.getFullYear()}-${m}-${day}`,
      label:
        i === 0
          ? "Today"
          : i === 1
            ? "Tomorrow"
            : d.toLocaleDateString("en-IE", {
                weekday: "short",
                day: "numeric",
                month: "short",
              }),
    });
  }

  return days;
}

/** Half-hourly from first light to last, which is the whole of a playable day
 *  in Ireland in midsummer and more than covers December. */
export const TIME_SLOTS: string[] = (() => {
  const slots: string[] = [];
  for (let h = 6; h <= 20; h += 1) {
    slots.push(`${String(h).padStart(2, "0")}:00`);
    if (h < 20) slots.push(`${String(h).padStart(2, "0")}:30`);
  }
  return slots;
})();

export const clockLabel = (value: string): string => {
  const [h, m] = value.split(":");
  const hour = Number.parseInt(h, 10);
  const suffix = hour >= 12 ? "pm" : "am";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return m === "00" ? `${twelve}${suffix}` : `${twelve}:${m}${suffix}`;
};
