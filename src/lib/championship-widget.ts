import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { boardOf, type Board, type ChampionshipPayload } from "@/lib/championship";
import { championshipFor } from "@/lib/championship-data";
import type { WidgetPayload } from "@/lib/widget-board";

/**
 * The widgets on a multi-day championship's day (0187): instead of the
 * day's own board, the overall leaderboard — place, ▲/▼ against the day
 * before, total — and, on the small widget, your overall place. Read with
 * the service client: the member is playing in the day, so they're in the
 * group whose championship it is.
 */

/** The championship a live day belongs to, if any (a championship's day out, or a trip round). */
export async function championshipOfDay(admin: SupabaseClient, matchDayId: number): Promise<number | null> {
  const { data: o } = await admin.from("society_outings").select("championship_id").eq("match_day_id", matchDayId).not("championship_id", "is", null).limit(1).maybeSingle<{ championship_id: number }>();
  if (o?.championship_id) return o.championship_id;
  const { data: i } = await admin.from("society_outing_items").select("outing_id").eq("match_day_id", matchDayId).limit(1).maybeSingle<{ outing_id: number }>();
  if (!i) return null;
  const { data: c } = await admin.from("group_championships").select("id").eq("trip_outing_id", i.outing_id).eq("status", "open").maybeSingle<{ id: number }>();
  return c?.id ?? null;
}

const ord = (label: string) => {
  const n = Number(label.replace(/^T/, ""));
  if (!Number.isInteger(n)) return label;
  if (label.startsWith("T")) return label;
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${s}`;
};

export function championshipWidget(base: WidgetPayload, p: ChampionshipPayload, me: string, rows = 7): WidgetPayload {
  const board: Board = boardOf(p);
  const day = p.days.find((d) => d.round === p.scoring[board.through - 1]?.round);
  const unit = board.unit === "to par" ? "to par" : board.unit === "places points" ? "places pts" : "pts";
  const mineRow = board.rows.find((r) => r.memberId === me) ?? null;
  const top = board.rows.filter((r) => r.position != null).slice(0, rows);
  if (mineRow && !top.includes(mineRow) && mineRow.position != null) top.splice(rows - 1, 1, mineRow);
  const leader = board.rows.find((r) => r.position === 1);
  const arrow = (m: number | null) => (m == null || m === 0 ? "" : m > 0 ? ` ▲${m}` : ` ▼${-m}`);
  return {
    ...base,
    eyebrow: `PINPALS · ${p.title.toUpperCase()}`,
    title: `Day ${day?.round ?? board.through} of ${p.days.length} · ${day?.courseName ?? ""}`.trim(),
    teams: [],
    matches: [],
    board: {
      heading: board.unit === "to par" ? "PAR" : "PTS",
      rows: top.map((r) => ({
        pos: r.positionLabel,
        name: r.memberId === me ? "You" : r.name,
        thru: r.thruLabel,
        score: r.totalLabel,
        mine: r.memberId === me,
        good: r.position === 1,
        move: r.move ?? 0,
      })),
    },
    mine: mineRow
      ? {
          eyebrow: p.title.toUpperCase(),
          title: `Day ${day?.round ?? board.through} of ${p.days.length} · ${mineRow.thruLabel === "F" ? "finished" : mineRow.thruLabel === "—" ? "to start" : `thru ${mineRow.thruLabel}`}`,
          big: `${ord(mineRow.positionLabel)}${arrow(mineRow.move)}`,
          line1: `${mineRow.totalLabel} ${unit} · ${mineRow.todayLabel} today`,
          line2: leader && leader !== mineRow ? `Leader: ${leader.name.split(" ")[0]} ${leader.totalLabel}` : "You lead",
        }
      : base.mine,
  };
}

/** Swaps a day's widget payload for the championship's, when the day is one. */
export async function withChampionship(admin: SupabaseClient, base: WidgetPayload, matchDayId: number | null, me: string): Promise<WidgetPayload> {
  if (matchDayId == null || base.state === "none") return base;
  const id = await championshipOfDay(admin, matchDayId);
  if (!id) return base;
  const p = await championshipFor(admin, admin, id, me);
  if (!p || p.status !== "open" || p.days.find((d) => d.matchDayId === matchDayId)?.hidden) return base;
  return championshipWidget(base, p, me);
}
