import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { placeOf, type Results } from "./competition-results";
import { notifyUser } from "./notifications-server";

/**
 * Competition results on the website (0137): telling everyone in the day,
 * and the public results page by share token.
 *
 * Both read the PUBLISHED copy — what the organiser published is exactly
 * what members are told and what a shared link shows. Nothing is worked
 * out again here.
 */

export type PublishedResults = {
  dayId: number;
  title: string;
  courseName: string;
  playedOn: string;
  version: number;
  publishedAt: string;
  results: Results;
};

type Row = {
  match_day_id: number;
  results: Results;
  version: number;
  published_at: string;
  live_match_days: { title: string; course_name: string; played_on: string } | null;
};

/** The published results for a share token, or null (none, or taken down). */
export async function loadPublishedResults(admin: SupabaseClient, token: string): Promise<PublishedResults | null> {
  if (!/^[0-9a-f]{32}$/.test(token)) return null;
  const { data } = await admin
    .from("competition_results")
    .select("match_day_id, results, version, published_at, live_match_days (title, course_name, played_on)")
    .eq("share_token", token)
    .eq("status", "published")
    .maybeSingle<Row>();
  if (!data || !data.live_match_days || !data.results) return null;
  return {
    dayId: data.match_day_id,
    title: data.live_match_days.title,
    courseName: data.live_match_days.course_name,
    playedOn: data.live_match_days.played_on,
    version: data.version,
    publishedAt: data.published_at,
    results: data.results,
  };
}

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;

/**
 * "Captain's Day results are in": every member in the day, with where they
 * finished. Deduped per version, so a retry sends nothing twice and an
 * update is a fresh notification ("updated").
 */
export async function notifyResults(admin: SupabaseClient, dayId: number): Promise<number> {
  const { data: row } = await admin
    .from("competition_results")
    .select("results, version, status, live_match_days (title, created_by)")
    .eq("match_day_id", dayId)
    .maybeSingle<{ results: Results | null; version: number; status: string; live_match_days: { title: string; created_by: string | null } | null }>();
  if (!row || row.status !== "published" || !row.results || !row.live_match_days) return 0;
  const results = row.results;
  const title = row.live_match_days.title;

  const { data: members } = await admin
    .from("live_round_players")
    .select("member_id, live_rounds!inner (match_day_id)")
    .eq("live_rounds.match_day_id", dayId)
    .not("member_id", "is", null)
    .overrideTypes<{ member_id: string }[]>();
  const recipients = new Set((members ?? []).map((m) => m.member_id));
  if (row.live_match_days.created_by) recipients.add(row.live_match_days.created_by);

  // Who won, in a line: "John Byrne won Division 1 on countback, Mary Kelly Division 2".
  const winners = results.prizes
    .filter((p) => p.label !== "Best gross" && p.winners.length > 0 && results.divisions.some((d) => d.label === p.label))
    .map((p, i) => {
      const w = p.winners[0];
      const cb = w.note?.startsWith("Won on countback") ? " on countback" : "";
      return results.divisions.length > 1 ? `${w.name} ${i === 0 ? "won " : ""}${p.label}${cb}` : `${w.name} won${cb}`;
    });
  const headline = winners.length > 0 ? `${winners.join(", ")}.` : "";
  const updated = row.version > 1;

  let sent = 0;
  for (const memberId of recipients) {
    const place = placeOf(results, memberId);
    let mine = "";
    if (place?.row.position != null) {
      const score = results.basis === "stableford" ? `${place.row.score} points` : `net ${place.row.score}`;
      mine = ` You finished ${place.row.positionLabel.startsWith("=") ? "joint " : ""}${ordinal(place.row.position)}${results.divisions.length > 1 ? ` in ${place.division}` : ""} with ${score}.`;
    }
    await notifyUser(admin, {
      userId: memberId,
      type: "live_match_result",
      title: updated ? `${title}: results updated` : `${title}: the results are in`,
      body: `${headline}${mine}${(results.amendments?.length ?? 0) > 0 ? " Some cards were amended by the organiser." : ""} Tap for the full results and countbacks.`.trim(),
      href: `/live/days/${dayId}/results`,
      dedupeKey: `competition_results:${dayId}:v${row.version}:${memberId}`,
    });
    sent += 1;
  }
  return sent;
}
