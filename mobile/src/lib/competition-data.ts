import { postToSite } from "./api";
import { SITE_URL } from "./config";
import {
  DEFAULT_SETTINGS,
  buildResults,
  type ResultEntrant,
  type Results,
  type ResultsBasis,
  type ResultsSettings,
} from "./competition-results";
import type { MatchDayData } from "./live-match-days";
import { supabase } from "./supabase";

/**
 * Competition results (0137): the day's cards turned into entrants for the
 * rules in competition-results.ts, and the organiser's settings, publish
 * and withdraw.
 *
 * Which days have results: a society day (individual Stableford or stroke
 * play) and a scramble or foursomes day (teams or pairs on one ball). A
 * match day's result is its team score, already on its board.
 */

export type ResultsRow = {
  settings: ResultsSettings;
  status: "draft" | "published";
  results: Results | null;
  version: number;
  shareToken: string | null;
  publishedAt: string | null;
  /** The group whose page lists the results (0138). */
  groupId: number | null;
};

export type ResultsState = {
  row: ResultsRow | null;
  /** "<round id>:<member id>" → certified by a playing partner. */
  certified: Map<string, boolean>;
};

/** Does this day get a results page? */
export const hasResults = (data: MatchDayData): boolean => data.day.kind === "fourballs" || data.day.kind === "scramble";

/** What ranks the day. */
export function basisOf(data: MatchDayData): ResultsBasis {
  if (data.day.kind === "scramble") return data.day.foursomes ?? "stroke";
  return data.matches.some((m) => m.round.format === "stroke") ? "stroke" : "stableford";
}

const settingsFrom = (raw: unknown): ResultsSettings => {
  const s = (raw && typeof raw === "object" ? raw : {}) as Partial<ResultsSettings>;
  return {
    tieRule: s.tieRule === "share" ? "share" : "draw",
    divisionCuts: Array.isArray(s.divisionCuts) ? s.divisionCuts.filter((x) => typeof x === "number").sort((a, b) => a - b) : [],
    bestGross: s.bestGross ?? DEFAULT_SETTINGS.bestGross,
    onePrizePerPlayer: s.onePrizePerPlayer ?? DEFAULT_SETTINGS.onePrizePerPlayer,
    guestsCanWin: s.guestsCanWin ?? DEFAULT_SETTINGS.guestsCanWin,
    amendments: Array.isArray(s.amendments)
      ? s.amendments
          .filter((a) => a && typeof a.key === "string")
          .map((a) => ({ key: a.key, hole: typeof a.hole === "number" ? a.hole : null, strokes: typeof a.strokes === "number" ? a.strokes : null, dq: !!a.dq, reason: String(a.reason ?? "") }))
      : [],
    extras: Array.isArray(s.extras) ? s.extras.filter((x) => x && typeof x.label === "string").map((x) => ({ label: x.label, winner: String(x.winner ?? "") })) : [],
  };
};

export async function loadResultsState(dayId: number): Promise<ResultsState> {
  const [{ data: row }, { data: cards }] = await Promise.all([
    supabase
      .from("competition_results")
      .select("settings, status, results, version, share_token, published_at, group_id")
      .eq("match_day_id", dayId)
      .maybeSingle<{ settings: unknown; status: "draft" | "published"; results: Results | null; version: number; share_token: string | null; published_at: string | null; group_id: number | null }>(),
    supabase.rpc("competition_card_status", { p_day_id: dayId }),
  ]);
  const certified = new Map<string, boolean>();
  for (const c of (cards ?? []) as { round_id: number; member_id: string; certified: boolean }[]) certified.set(`${c.round_id}:${c.member_id}`, c.certified);
  return {
    row: row
      ? {
          settings: settingsFrom(row.settings),
          status: row.status,
          results: row.results,
          version: row.version,
          shareToken: row.share_token,
          publishedAt: row.published_at,
          groupId: row.group_id,
        }
      : null,
    certified,
  };
}

/** Every card in the day as an entrant: a player in a society day, a team
 *  or pair (one ball, scored on its first player) in a scramble day. */
export function entrantsOf(data: MatchDayData, certified: Map<string, boolean>): ResultEntrant[] {
  const out: ResultEntrant[] = [];
  for (const m of data.matches) {
    const scoresOf = (playerId: number) => Object.fromEntries([...(m.scores.get(playerId) ?? new Map<number, number | null>())]);
    const scr = m.round.scramble;
    if (data.day.kind === "scramble" && scr) {
      const ordered = [...m.players].sort((a, b) => a.position - b.position);
      const lead = ordered[0];
      if (!lead) continue;
      const first = ordered.map((p) => p.name.split(" ")[0]);
      out.push({
        key: `r${m.round.id}`,
        name: scr.teamName ?? first.join(" & "),
        detail: first.join(" · "),
        memberIds: ordered.map((p) => p.memberId).filter((x): x is string => !!x),
        guest: false,
        handicap: scr.teamHandicap,
        card: m.card,
        scores: scoresOf(lead.id),
        roundId: m.round.id,
        group: m.round.matchNumber ?? scr.teamNumber,
        // A side's card (0138) is certified by the other side, on either
        // partner's copy.
        certified: ordered.some((p) => p.memberId && certified.get(`${m.round.id}:${p.memberId}`)) || null,
      });
      continue;
    }
    for (const p of m.players) {
      out.push({
        key: `p${p.id}`,
        name: p.name,
        detail: null,
        memberIds: p.memberId ? [p.memberId] : [],
        guest: p.memberId == null,
        handicap: p.playingHandicap,
        card: m.card,
        scores: scoresOf(p.id),
        roundId: m.round.id,
        group: m.round.matchNumber,
        certified: p.memberId ? (certified.get(`${m.round.id}:${p.memberId}`) ?? false) : null,
      });
    }
  }
  return out;
}

export function workOut(data: MatchDayData, state: ResultsState, settings: ResultsSettings): Results {
  return buildResults({
    basis: basisOf(data),
    team: data.day.kind === "scramble",
    teamWord: data.day.foursomes ? "Pairs" : "Teams",
    entrants: entrantsOf(data, state.certified),
    settings,
    seed: `day-${data.day.id}`,
  });
}

export async function saveResultsSettings(dayId: number, settings: ResultsSettings): Promise<void> {
  const { error } = await supabase.rpc("competition_results_save", { p_day_id: dayId, p_settings: settings });
  if (error) throw error;
}

/** Publishes (or republishes) and tells everyone in the day. */
/** The group whose page should list the results: already chosen, or the
 *  database's suggestion (the event's group, or the organiser's group with
 *  most of the day's players). */
export async function suggestedGroup(dayId: number): Promise<number | null> {
  const { data } = await supabase.rpc("competition_results_group_suggestion", { p_day_id: dayId });
  return typeof data === "number" ? data : data == null ? null : Number(data);
}

export async function setResultsGroup(dayId: number, groupId: number | null): Promise<void> {
  const { error } = await supabase.rpc("competition_results_set_group", { p_day_id: dayId, p_group_id: groupId });
  if (error) throw error;
}

export type GroupResult = {
  dayId: number;
  title: string;
  courseName: string;
  playedOn: string;
  amended: boolean;
  updated: boolean;
  /** "John Byrne (38 pts)" per division. */
  winners: { label: string; name: string; score: string }[];
};

/** A group's past results, newest first (0138: members of the group read
 *  them, whether or not they played). */
export async function loadGroupResults(groupId: number): Promise<GroupResult[]> {
  const { data, error } = await supabase
    .from("competition_results")
    .select("match_day_id, version, published_at, results")
    .eq("group_id", groupId)
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(30)
    .overrideTypes<{ match_day_id: number; version: number; published_at: string; results: Results }[]>();
  if (error) throw error;
  return (data ?? []).map((r) => {
    const res = r.results;
    const divisionLabels = new Set(res.divisions.map((d) => d.label));
    return {
      dayId: r.match_day_id,
      title: res.event?.title ?? "Competition",
      courseName: res.event?.courseName ?? "",
      playedOn: res.event?.playedOn ?? r.published_at.slice(0, 10),
      amended: (res.amendments ?? []).length > 0,
      updated: r.version > 1,
      winners: res.prizes
        .filter((p) => divisionLabels.has(p.label) && p.winners.length > 0)
        .map((p) => {
          const w = p.winners[0];
          // A team or pair with no name of its own ("Team 2"): say who.
          const plain = /^(Team|Pair) \d+$/.test(w.name) && w.detail;
          return { label: p.label, name: plain ? `${w.name} (${w.detail!.split(" · ").join(" & ")})` : w.name, score: w.score };
        }),
    };
  });
}

export async function publishResults(dayId: number, results: Results): Promise<{ version: number; shareToken: string }> {
  const { data, error } = await supabase.rpc("competition_results_publish", { p_day_id: dayId, p_results: results });
  if (error) throw error;
  const row = ((data ?? []) as { version: number; share_token: string }[])[0];
  // Best effort: the results are published either way.
  void postToSite(`/api/app/live/match-days/${dayId}/results`, {}).catch(() => undefined);
  return { version: row?.version ?? 1, shareToken: row?.share_token ?? "" };
}

export async function withdrawResults(dayId: number): Promise<void> {
  const { error } = await supabase.rpc("competition_results_withdraw", { p_day_id: dayId });
  if (error) throw error;
}

export const resultsLink = (token: string): string => `${SITE_URL}/results/${token}`;

/** The results as a message: WhatsApp, Messages, the society chat. */
export function resultsShareText(title: string, courseName: string, results: Results, link: string | null): string {
  const lines = [`${title} — ${courseName}`, ""];
  for (const p of results.prizes) {
    if (p.winners.length === 0) continue;
    lines.push(p.label);
    for (const w of p.winners) lines.push(`${w.place ? `${w.place} ` : ""}${w.name}${w.score ? ` · ${w.score}` : ""}${w.note?.startsWith("Won on countback") ? " (countback)" : ""}`);
    lines.push("");
  }
  lines.push(results.rule);
  if (link) lines.push("", link);
  return lines.join("\n");
}
