/**
 * Competition results from the society console (Oct 2026): the day's cards
 * as entrants for competition-results.ts, exactly as the app's
 * competition-data.ts makes them — the same keys ("p<player id>" for a
 * player, "r<round id>" for a pair's or team's card), so an amendment made
 * on the phone and one made here mean the same card.
 *
 * Pure, tested in live-results.test.ts. The Server Actions work the results
 * out here from the database, never from figures a browser sends.
 */

import { buildResults, DEFAULT_SETTINGS, type Amendment, type ResultEntrant, type Results, type ResultsBasis, type ResultsSettings, type TieRule } from "@/lib/competition-results";
import type { TvGame } from "@/lib/tv-board";
import { teamHandicapLabel } from "@/lib/live-scoring";

export type DayKind = "fourballs" | "scramble" | "match";

/** Does this kind of day have a results page? A match day's result is its team score. */
export const hasResults = (kind: DayKind): boolean => kind === "fourballs" || kind === "scramble";

/** What ranks the day: a pairs day's own scoring; a team day net stroke play; a society day its format. */
export function basisOf(kind: DayKind, games: readonly TvGame[]): ResultsBasis {
  if (kind === "scramble") return games.find((g) => g.round.scramble?.foursomes)?.round.scramble?.foursomes ?? "stroke";
  return games.some((g) => g.round.format === "stroke") ? "stroke" : "stableford";
}

const firstName = (name: string) => name.split(" ")[0];

/** Every card in the day: a player in a society day; a pair or team (one ball, on its first player) in a scramble day. */
export function entrantsOf(kind: DayKind, games: readonly TvGame[], certified: ReadonlyMap<string, boolean>): ResultEntrant[] {
  const out: ResultEntrant[] = [];
  for (const g of games) {
    const scoresOf = (playerId: number) => Object.fromEntries([...(g.scores.get(playerId) ?? new Map<number, number | null>())]);
    const scr = g.round.scramble;
    if (kind === "scramble" && scr) {
      const ordered = [...g.players].sort((a, b) => a.position - b.position);
      const lead = ordered[0];
      if (!lead) continue;
      const first = ordered.map((p) => firstName(p.name));
      out.push({
        key: `r${g.round.id}`,
        name: scr.teamName ?? first.join(" & "),
        // A handicap set by hand (0189) says so, with the worked-out figure — as the app's results do.
        detail: first.join(" · ") + (scr.teamHandicapAuto != null ? ` · handicap set by hand (worked out ${teamHandicapLabel(scr.teamHandicapAuto)})` : ""),
        memberIds: ordered.map((p) => p.memberId).filter((x): x is string => !!x),
        guest: false,
        handicap: scr.teamHandicap,
        card: g.card,
        scores: scoresOf(lead.id),
        roundId: g.round.id,
        group: g.round.matchNumber ?? scr.teamNumber,
        certified: ordered.some((p) => p.memberId && certified.get(`${g.round.id}:${p.memberId}`)) || null,
      });
      continue;
    }
    for (const p of g.players) {
      out.push({
        key: `p${p.id}`,
        name: p.name,
        detail: null,
        memberIds: p.memberId ? [p.memberId] : [],
        guest: p.memberId == null,
        handicap: p.playingHandicap,
        card: g.card,
        scores: scoresOf(p.id),
        roundId: g.round.id,
        group: g.round.matchNumber,
        certified: p.memberId ? (certified.get(`${g.round.id}:${p.memberId}`) ?? false) : null,
      });
    }
  }
  return out;
}

/** The day's results with these settings — what the organiser sees before publishing, and what's published. */
export function workOut(dayId: number, kind: DayKind, games: readonly TvGame[], certified: ReadonlyMap<string, boolean>, settings: ResultsSettings): Results {
  const foursomes = games.some((g) => g.round.scramble?.foursomes);
  return buildResults({
    basis: basisOf(kind, games),
    team: kind === "scramble",
    teamWord: foursomes ? "Pairs" : "Teams",
    entrants: entrantsOf(kind, games, certified),
    settings,
    seed: `day-${dayId}`,
  });
}

/** Settings as stored (or posted), made safe: the app's settingsFrom, plus caps. */
export function settingsFrom(raw: unknown): ResultsSettings {
  const s = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof ResultsSettings, unknown>>;
  const amendments = Array.isArray(s.amendments) ? s.amendments : [];
  const extras = Array.isArray(s.extras) ? s.extras : [];
  return {
    tieRule: s.tieRule === "share" ? "share" : "draw",
    divisionCuts: Array.isArray(s.divisionCuts)
      ? [...new Set(s.divisionCuts.filter((x): x is number => typeof x === "number" && Number.isFinite(x) && x > -10 && x < 60))].sort((a, b) => a - b).slice(0, 3)
      : [],
    bestGross: typeof s.bestGross === "boolean" ? s.bestGross : DEFAULT_SETTINGS.bestGross,
    onePrizePerPlayer: typeof s.onePrizePerPlayer === "boolean" ? s.onePrizePerPlayer : DEFAULT_SETTINGS.onePrizePerPlayer,
    guestsCanWin: typeof s.guestsCanWin === "boolean" ? s.guestsCanWin : DEFAULT_SETTINGS.guestsCanWin,
    amendments: amendments
      .filter((a): a is Record<string, unknown> => !!a && typeof a === "object" && typeof (a as { key?: unknown }).key === "string")
      .slice(0, 200)
      .map(
        (a): Amendment => ({
          key: String(a.key).slice(0, 40),
          hole: typeof a.hole === "number" && Number.isInteger(a.hole) ? a.hole : null,
          strokes: typeof a.strokes === "number" && Number.isInteger(a.strokes) ? a.strokes : null,
          dq: !!a.dq,
          reason: String(a.reason ?? "").slice(0, 200),
        })
      ),
    extras: extras
      .filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && typeof (x as { label?: unknown }).label === "string")
      .slice(0, 20)
      .map((x) => ({ label: String(x.label).slice(0, 60), winner: String(x.winner ?? "").slice(0, 80) })),
  };
}

export const isTieRule = (v: unknown): v is TieRule => v === "share" || v === "draw";

/** "Stableford", "Foursomes · stroke play"… for headings. */
export function basisLabel(kind: DayKind, games: readonly TvGame[]): string {
  const basis = basisOf(kind, games);
  if (kind === "scramble") {
    const lead = games[0]?.round.scramble;
    const what = lead?.foursomes ? (lead.greensomes ? "Greensomes" : "Foursomes") : "Scramble";
    return `${what} · ${basis === "stableford" ? "Stableford" : "stroke play"}`;
  }
  return basis === "stableford" ? "Stableford" : "Stroke play (net)";
}
