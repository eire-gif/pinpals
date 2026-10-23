import { getFromSite } from "@/lib/api";
import { DAY_FORMATS, MAX_DAYS, MIN_DAYS, type ChampionshipPayload, type ChampionshipRule, type DayFormat } from "@/lib/championship";
import { flushSocietyAlerts } from "@/lib/outings";
import { supabase } from "@/lib/supabase";

/**
 * Multi-day championships (0187): 2–4 days, a course and format each day,
 * one leaderboard. Each day is an ordinary day out (entries, draw, live
 * day, results); on a trip the itinerary's rounds are the days. Reads the
 * scores from the website (GET /api/app/championships/[id]) and adds them
 * up here with championship.ts. Writes go through the database functions.
 */

export type Championship = { id: number; groupId: number; title: string; rule: ChampionshipRule; tripOutingId: number | null; status: "open" | "cancelled" };

type Row = { id: number; group_id: number; title: string; rule: ChampionshipRule; trip_outing_id: number | null; status: "open" | "cancelled" };
const COLS = "id, group_id, title, rule, trip_outing_id, status";
const toChamp = (r: Row): Championship => ({ id: r.id, groupId: r.group_id, title: r.title, rule: r.rule, tripOutingId: r.trip_outing_id, status: r.status });

/** "relation … does not exist": the database hasn't had 0187 yet — nothing to show. */
const missing = (e: { code?: string; message: string } | null) => !!e && (e.code === "42P01" || e.code === "42703" || e.code === "PGRST202" || /does not exist/i.test(e.message));

function fail(error: { message: string } | null, fallback: string): never {
  throw new Error(error?.message || fallback);
}

/** A group's open championships, newest first (not a trip's own leaderboard). */
export async function listChampionships(groupId: number): Promise<Championship[]> {
  const { data, error } = await supabase.from("group_championships").select(COLS).eq("group_id", groupId).eq("status", "open").is("trip_outing_id", null).order("created_at", { ascending: false });
  if (missing(error)) return [];
  if (error) fail(error, "Couldn't load the championships.");
  return ((data ?? []) as Row[]).map(toChamp);
}

/** A trip's leaderboard, if it's on. */
export async function tripChampionship(outingId: number): Promise<Championship | null> {
  const { data, error } = await supabase.from("group_championships").select(COLS).eq("trip_outing_id", outingId).maybeSingle<Row>();
  if (missing(error)) return null;
  if (error) fail(error, "Couldn't load the trip's leaderboard.");
  return data ? toChamp(data) : null;
}

/** The leaderboard: every day and every side's score so far. */
export function loadChampionship(id: number): Promise<ChampionshipPayload> {
  return getFromSite<ChampionshipPayload>(`/api/app/championships/${id}`);
}

export type ChampionshipDayInput = { playsOn: string; clubId: number | null; courseName: string; firstTee: string | null; format: DayFormat };
export type ChampionshipInput = { title: string; rule: ChampionshipRule; entryFeeCents: number | null; maxEntries: number | null; details: string; days: ChampionshipDayInput[] };

/** Checks it as the database will, so the set-up screen can say what's wrong before saving. */
export function championshipProblem(input: ChampionshipInput): string | null {
  if (!input.title.trim()) return "Give the championship a name.";
  if (input.title.trim().length > 80) return "That name is too long — 80 characters at most.";
  if (input.days.length < MIN_DAYS || input.days.length > MAX_DAYS) return "A championship is 2, 3 or 4 days.";
  let prev = "";
  for (const [i, d] of input.days.entries()) {
    if (!d.courseName.trim()) return `Choose the course for day ${i + 1}.`;
    if (prev && d.playsOn <= prev) return "Each day comes after the one before.";
    prev = d.playsOn;
  }
  const first = Date.parse(`${input.days[0].playsOn}T12:00:00Z`);
  const last = Date.parse(`${input.days[input.days.length - 1].playsOn}T12:00:00Z`);
  if ((last - first) / 86_400_000 > 20) return "A championship is three weeks at most.";
  return null;
}

export async function saveChampionship(groupId: number, id: number | null, input: ChampionshipInput): Promise<number> {
  const p = {
    title: input.title.trim(),
    rule: input.rule,
    entry_fee_cents: input.entryFeeCents,
    max_entries: input.maxEntries,
    details: input.details.trim() || null,
    days: input.days.map((d) => ({
      plays_on: d.playsOn,
      club_id: d.clubId,
      course_name: d.courseName.trim(),
      first_tee: d.firstTee,
      format: d.format,
      format_label: DAY_FORMATS.find((f) => f.id === d.format)?.label ?? null,
    })),
  };
  const { data, error } = await supabase.rpc("save_championship", { p_group_id: groupId, p_id: id, p });
  if (error) fail(error, "Couldn't save the championship.");
  flushSocietyAlerts();
  return Number(data);
}

export async function cancelChampionship(id: number): Promise<void> {
  const { error } = await supabase.rpc("cancel_championship", { p_id: id });
  if (error) fail(error, "Couldn't cancel the championship.");
  flushSocietyAlerts();
}

/** Join (true) or leave (false) every day still open; returns how many days changed. */
export async function setChampionshipEntry(id: number, inIt: boolean, memberId?: string): Promise<number> {
  const { data, error } = await supabase.rpc("set_championship_entry", { p_id: id, p_in: inIt, p_member: memberId ?? null });
  if (error) fail(error, inIt ? "Couldn't put you in." : "Couldn't take you out.");
  flushSocietyAlerts();
  return Number(data ?? 0);
}

/** The trip toggle: "Run a leaderboard across the trip". */
export async function setTripChampionship(outingId: number, on: boolean, rule: ChampionshipRule = "auto"): Promise<number | null> {
  const { data, error } = await supabase.rpc("set_trip_championship", { p_outing_id: outingId, p_on: on, p_rule: rule });
  if (error) fail(error, "Couldn't change the trip's leaderboard.");
  return data == null ? null : Number(data);
}

/** A trip round's live day, so its scores count on the trip's leaderboard. */
export async function linkItemMatchDay(itemId: number, matchDayId: number): Promise<void> {
  const { error } = await supabase.rpc("link_outing_item_match_day", { p_item_id: itemId, p_match_day_id: matchDayId });
  if (error && !missing(error)) fail(error, "Couldn't link the round to the trip.");
}
