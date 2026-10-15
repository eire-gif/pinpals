/**
 * A society's order of merit (0145), from its published results.
 *
 * Pure: results and rules in, standings out. Tested in order-of-merit.test.ts.
 *
 *   - Each published result on the society's page in the season counts as
 *     one event. In each division, 1st takes points[0], 2nd points[1], and
 *     so on; a shared place takes that place's points (two "=3"s both take
 *     3rd's). Places beyond the table score nothing for the place.
 *   - Everyone who returned a card gets attendance points too.
 *   - Guests never score. Team and pairs events count when the rules say so:
 *     each player in the team scores the team's points.
 *   - best_of: only a member's best N events count; their others are shown
 *     as dropped.
 *   - Ties in the table: more wins, then more top-3s, then more events, then
 *     the name, so the order is always the same.
 */

import type { Results } from "@/lib/competition-results";

export type MeritRules = {
  points: number[];
  attendancePoints: number;
  bestOf: number | null;
  includeTeam: boolean;
  seasonStartMonth: number;
};

export const DEFAULT_MERIT_RULES: MeritRules = {
  points: [25, 20, 16, 13, 11, 10, 9, 8, 7, 6],
  attendancePoints: 2,
  bestOf: null,
  includeTeam: true,
  seasonStartMonth: 1,
};

export type MeritEvent = { id: number; results: Results; playedOn: string };

export type MeritScore = { eventId: number; title: string; playedOn: string; place: string | null; points: number; counted: boolean };

export type MeritRow = {
  memberId: string;
  name: string;
  points: number;
  events: number;
  wins: number;
  podiums: number;
  scores: MeritScore[];
  /** 1-based; level rows share it. */
  position: number;
  positionLabel: string;
};

/** The season a date falls in, by the year it starts, and its dates. */
export function meritSeason(startMonth: number, today: string): { season: number; from: string; to: string; label: string } {
  const [y, m] = today.split("-").map(Number);
  const season = m < startMonth ? y - 1 : y;
  const mm = String(startMonth).padStart(2, "0");
  return {
    season,
    from: `${season}-${mm}-01`,
    to: `${season + 1}-${mm}-01`,
    label: startMonth === 1 ? String(season) : `${season}–${String((season + 1) % 100).padStart(2, "0")}`,
  };
}

export function orderOfMerit(events: readonly MeritEvent[], rules: MeritRules, names: ReadonlyMap<string, string> = new Map()): MeritRow[] {
  const table = new Map<string, { name: string; scores: MeritScore[]; wins: number; podiums: number }>();
  const row = (id: string, fallback: string) => {
    let r = table.get(id);
    if (!r) {
      r = { name: names.get(id) ?? fallback, scores: [], wins: 0, podiums: 0 };
      table.set(id, r);
    }
    return r;
  };

  for (const ev of events) {
    const res = ev.results;
    if (!res || (res.team && !rules.includeTeam)) continue;
    const title = res.event?.title ?? "Event";
    const seen = new Set<string>();
    for (const division of res.divisions ?? []) {
      for (const r of division.ranking.rows) {
        if (r.guest || r.status !== "ok") continue;
        const placePoints = r.position != null && r.position >= 1 && r.position <= rules.points.length ? rules.points[r.position - 1] : 0;
        const total = placePoints + rules.attendancePoints;
        for (const memberId of r.memberIds ?? []) {
          if (seen.has(memberId)) continue;
          seen.add(memberId);
          const t = row(memberId, res.team ? memberId : r.name);
          t.scores.push({ eventId: ev.id, title, playedOn: ev.playedOn, place: r.position != null ? r.positionLabel : null, points: total, counted: true });
          if (r.position === 1) t.wins += 1;
          if (r.position != null && r.position <= 3) t.podiums += 1;
        }
      }
    }
  }

  const rows = [...table.entries()].map(([memberId, t]) => {
    const scores = [...t.scores].sort((a, b) => (a.playedOn < b.playedOn ? -1 : a.playedOn > b.playedOn ? 1 : 0));
    if (rules.bestOf != null && scores.length > rules.bestOf) {
      const keep = new Set([...scores].sort((a, b) => b.points - a.points || (a.playedOn < b.playedOn ? -1 : 1)).slice(0, rules.bestOf));
      for (const s of scores) s.counted = keep.has(s);
    }
    const points = scores.filter((s) => s.counted).reduce((a, s) => a + s.points, 0);
    return { memberId, name: t.name, points, events: scores.length, wins: t.wins, podiums: t.podiums, scores, position: 0, positionLabel: "" };
  });

  rows.sort((a, b) => b.points - a.points || b.wins - a.wins || b.podiums - a.podiums || b.events - a.events || a.name.localeCompare(b.name));
  for (let i = 0; i < rows.length; i++) {
    const level = i > 0 && rows[i].points === rows[i - 1].points;
    rows[i].position = level ? rows[i - 1].position : i + 1;
  }
  for (const r of rows) {
    const shared = rows.filter((x) => x.position === r.position).length > 1;
    r.positionLabel = `${shared ? "=" : ""}${r.position}`;
  }
  return rows;
}
