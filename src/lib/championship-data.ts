import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  type ChampionshipDay,
  type ChampionshipDayInfo,
  type ChampionshipPayload,
  type ChampionshipRule,
  type DayRow,
  type Player,
  dayFormat,
  fromTripFormat,
} from "@/lib/championship";
import type { Results } from "@/lib/competition-results";
import { buildBoard as liveBoard } from "@/lib/live-scoring";
import { loadTvGames } from "@/lib/tv-data";
import type { TvGame } from "@/lib/tv-board";
import { secretFor } from "@/lib/widget-data";

/**
 * Loads a multi-day championship (0187) for the app, the website's board and
 * the widgets: each day's course and format, and every side's score so far,
 * read the way the TV board reads a day (tv-data.ts). Added up in
 * championship.ts, so the app can switch between "after day 1, 2, 3" without
 * another request.
 *
 * `member` reads the championship row with the member's OWN client first, so
 * RLS decides who may see it; the days' scores are then read with the
 * service client (a member of the group sees the whole leaderboard, as on
 * the day's board). A day whose organiser keeps the leaderboard secret
 * (0174) shows no scores until its results are published, unless the viewer
 * is that day's organiser.
 */

type ChampRow = { id: number; group_id: number; title: string; rule: ChampionshipRule; trip_outing_id: number | null; status: "open" | "cancelled" };
type OutingRow = { id: number; championship_round: number; plays_on: string; course_name: string | null; first_tee: string | null; championship_format: string | null; match_day_id: number | null };
type ItemRow = { id: number; on_date: string; starts_at: string | null; title: string | null; club_id: number | null; play_format: string | null; match_day_id: number | null };
type Plan = Pick<ChampionshipDayInfo, "round" | "playsOn" | "courseName" | "firstTee" | "outingId" | "itemId" | "matchDayId"> & { planned: string | null };
type DayRowDb = { id: number; leaderboard_hidden: boolean | null; created_by: string | null; kind: string | null; foursomes_scoring: string | null; greensomes: boolean | null; scramble_size?: number | null };

export async function championshipFor(member: SupabaseClient, admin: SupabaseClient, id: number, viewer: string, now = new Date()): Promise<ChampionshipPayload | null> {
  const { data: c, error } = await member.from("group_championships").select("id, group_id, title, rule, trip_outing_id, status").eq("id", id).maybeSingle<ChampRow>();
  if (error) throw error;
  if (!c) return null;

  const plans: Plan[] = [];
  if (c.trip_outing_id != null) {
    const { data, error: e } = await admin
      .from("society_outing_items")
      .select("id, on_date, starts_at, title, club_id, play_format, match_day_id")
      .eq("outing_id", c.trip_outing_id)
      .eq("kind", "round")
      .order("on_date")
      .order("starts_at", { nullsFirst: false });
    if (e) throw e;
    const items = (data ?? []) as ItemRow[];
    const clubIds = [...new Set(items.map((i) => i.club_id).filter((x): x is number => x != null))];
    const clubs = new Map<number, string>();
    if (clubIds.length) {
      const { data: cl } = await admin.from("clubs").select("id, name").in("id", clubIds);
      for (const r of (cl ?? []) as { id: number; name: string }[]) clubs.set(r.id, r.name);
    }
    items.slice(0, 4).forEach((i, k) =>
      plans.push({
        round: k + 1,
        playsOn: i.on_date,
        courseName: (i.club_id != null ? clubs.get(i.club_id) : null) ?? i.title ?? "Round",
        firstTee: i.starts_at ? i.starts_at.slice(0, 5) : null,
        outingId: null,
        itemId: i.id,
        matchDayId: i.match_day_id,
        planned: i.play_format === "matchplay" ? "matchplay" : fromTripFormat(i.play_format),
      })
    );
  } else {
    const { data, error: e } = await admin
      .from("society_outings")
      .select("id, championship_round, plays_on, course_name, first_tee, championship_format, match_day_id")
      .eq("championship_id", c.id)
      .eq("status", "open")
      .order("championship_round");
    if (e) throw e;
    for (const o of (data ?? []) as OutingRow[])
      plans.push({
        round: o.championship_round,
        playsOn: o.plays_on,
        courseName: o.course_name ?? "Course",
        firstTee: o.first_tee ? o.first_tee.slice(0, 5) : null,
        outingId: o.id,
        itemId: null,
        matchDayId: o.match_day_id,
        planned: o.championship_format,
      });
  }

  const players = new Map<string, Player>();
  const days: ChampionshipDayInfo[] = [];
  const scoring: ChampionshipDay[] = [];

  for (const plan of plans) {
    const fmt = plan.planned === "matchplay" ? null : dayFormat(plan.planned);
    const info: ChampionshipDayInfo = {
      round: plan.round,
      playsOn: plan.playsOn,
      courseName: plan.courseName,
      firstTee: plan.firstTee,
      formatLabel: fmt?.label ?? "Matchplay",
      short: fmt?.short ?? "MP",
      kind: fmt?.kind ?? "points",
      team: fmt?.team ?? false,
      status: "upcoming",
      outingId: plan.outingId,
      itemId: plan.itemId,
      matchDayId: plan.matchDayId,
      hidden: false,
      excluded: plan.planned === "matchplay",
    };
    let rows: DayRow[] = [];
    if (plan.matchDayId != null) {
      const loaded = await loadTvGames(admin, { kind: "day", id: plan.matchDayId });
      const { data: dd } = await admin
        .from("live_match_days")
        .select("id, leaderboard_hidden, created_by, kind, foursomes_scoring, greensomes")
        .eq("id", plan.matchDayId)
        .maybeSingle<DayRowDb>();
      if (loaded && dd) {
        const scored = scoreDay(loaded.games, dd);
        info.excluded = scored.excluded;
        info.kind = scored.kind;
        info.team = scored.team;
        info.formatLabel = scored.label;
        info.short = scored.short;
        const allIn = loaded.games.length > 0 && loaded.games.every((g) => g.round.status === "finished");
        info.status = loaded.published || allIn ? "final" : "live";
        const secret = !loaded.published && (await secretFor(admin, dd, viewer));
        info.hidden = secret;
        rows = secret ? [] : scored.rows;
        if (loaded.published && !secret) applyPublished(rows, await publishedResults(admin, plan.matchDayId));
        for (const g of loaded.games)
          for (const p of g.players) {
            const key = p.memberId ? `m:${p.memberId}` : `g:${p.name.trim().toLowerCase()}`;
            if (!players.has(key)) players.set(key, { key, name: p.name, detail: p.club ?? (p.memberId ? null : "Guest"), memberId: p.memberId });
          }
      }
    }
    days.push(info);
    if (!info.excluded) scoring.push({ round: info.round, kind: info.kind, team: info.team, status: info.status, rows });
  }

  return {
    v: 1,
    id: c.id,
    groupId: c.group_id,
    title: c.title,
    rule: c.rule,
    tripOutingId: c.trip_outing_id,
    status: c.status,
    days,
    scoring,
    players: [...players.values()],
    updatedAt: now.toISOString(),
  };
}

/** Every side's score on a live day: points or net to par, as the day is played. */
export function scoreDay(games: readonly TvGame[], day: Pick<DayRowDb, "kind" | "foursomes_scoring" | "greensomes">) {
  const lead = games[0];
  if (day.kind === "match" || (!lead?.round.scramble && lead?.round.format === "matchplay")) {
    return { excluded: true, kind: "points" as const, team: false, label: "Matchplay", short: "MP", rows: [] as DayRow[] };
  }
  const rowOf = (g: TvGame, ids: { memberId: string | null; name: string }[], thru: number, points: number, netToPar: number, onPoints: boolean): DayRow => ({
    memberIds: ids.map((p) => p.memberId).filter((m): m is string => !!m),
    guestNames: ids.filter((p) => !p.memberId).map((p) => p.name),
    score: thru === 0 ? null : onPoints ? points : netToPar,
    thru,
    finished: g.round.status === "finished" || thru >= g.card.length,
  });

  if (day.kind === "scramble" || lead?.round.scramble) {
    const fours = lead?.round.scramble?.foursomes ?? null;
    const onPoints = fours === "stableford";
    const greens = !!lead?.round.scramble?.greensomes;
    const rows = games.map((g) => {
      const scr = g.round.scramble;
      const ball = [...g.players].sort((a, b) => a.position - b.position)[0];
      const r = ball ? liveBoard(scr?.foursomes ?? "stroke", g.card, [{ id: ball.id, name: "side", playingHandicap: scr?.teamHandicap ?? 0 }], g.scores).rows[0] : null;
      return rowOf(g, g.players, r?.thru ?? 0, r?.points ?? 0, r?.netToPar ?? 0, onPoints);
    });
    const label = fours ? `${greens ? "Greensomes" : "Foursomes"} · ${onPoints ? "Stableford" : "stroke"}` : `Texas scramble (${lead?.players.length ?? 4})`;
    return { excluded: false, kind: onPoints ? ("points" as const) : ("net" as const), team: true, label, short: fours ? (greens ? "GRN" : "4S") : "SCR", rows };
  }

  const stroke = games.some((g) => g.round.format === "stroke");
  const rows = games.flatMap((g) => {
    const b = liveBoard(stroke ? "stroke" : "stableford", g.card, g.players.map((p) => ({ id: p.id, name: p.name, playingHandicap: p.playingHandicap })), g.scores);
    return b.rows.map((r) => {
      const p = g.players.find((x) => x.id === r.playerId)!;
      return rowOf(g, [p], r.thru, r.points, r.netToPar, !stroke);
    });
  });
  return { excluded: false, kind: stroke ? ("net" as const) : ("points" as const), team: false, label: stroke ? "Net stroke play" : "Stableford", short: stroke ? "NET" : "STB", rows };
}

async function publishedResults(admin: SupabaseClient, matchDayId: number): Promise<Results | null> {
  const { data } = await admin.from("competition_results").select("results, status").eq("match_day_id", matchDayId).maybeSingle<{ results: Results | null; status: string }>();
  return data?.status === "published" ? data.results : null;
}

/**
 * Published results take over a finished day: their scores (amendments
 * included) and, when there's one division, their places (countbacks
 * included). Disqualified and no-return cards drop off the day.
 */
export function applyPublished(rows: DayRow[], results: Results | null): void {
  if (!results) return;
  const one = results.divisions.length === 1;
  const byMember = new Map<string, (typeof results.divisions)[number]["ranking"]["rows"][number]>();
  for (const d of results.divisions) for (const r of d.ranking.rows) for (const m of r.memberIds) byMember.set(m, r);
  for (const row of rows) {
    const r = row.memberIds.map((m) => byMember.get(m)).find(Boolean);
    if (!r) continue;
    row.finished = true;
    if (r.status === "dq" || r.status === "nr") {
      row.score = null;
      row.position = null;
      continue;
    }
    if (results.basis === "stableford" && r.points != null) row.score = r.points;
    row.position = one ? r.position : null;
  }
}
