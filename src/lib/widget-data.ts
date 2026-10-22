import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { widgetFollowFor } from "@/lib/follow-data";
import { loadGames, ROUND_COLS, type RoundRow } from "@/lib/live-games";
import { buildWidgetPayload, emptyPayload, type WidgetDay, type WidgetPayload } from "@/lib/widget-board";


/**
 * Loads a member's current game for their widget (Oct 2026) and hands it to
 * widget-board.ts. Runs with the service client — the widget token already
 * proved who is asking — and reads only games that member is playing in.
 *
 * Which game: the newest one still live; failing that, one finished today
 * (so the final score stays up for the evening); otherwise "none".
 */

/** Today's date in Ireland, as played_on stores it. */
export function irishToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** A day whose leaderboard is kept secret from this member (everyone but its organisers). Secret on any error. */
export async function secretFor(
  db: SupabaseClient,
  day: { id: number; leaderboard_hidden: boolean | null; created_by: string | null },
  memberId: string
): Promise<boolean> {
  if (day.leaderboard_hidden !== true || day.created_by === memberId) return false;
  const { data, error } = await db.rpc("live_day_organiser", { p_day_id: day.id, p_user: memberId });
  return error != null || data !== true;
}

/** The game the widget should show: live first (newest), else finished today. */
export function pickFocus<T extends { status: string; played_on: string; created_at: string }>(rounds: T[], today: string): T | null {
  const byNewest = [...rounds].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return byNewest.find((r) => r.status === "live") ?? byNewest.find((r) => r.played_on === today) ?? null;
}

export async function widgetPayloadFor(db: SupabaseClient, memberId: string, now = new Date()): Promise<WidgetPayload> {
  const { data: mine, error: e1 } = await db.from("live_round_players").select("round_id").eq("member_id", memberId).order("round_id", { ascending: false }).limit(50);
  if (e1) throw e1;
  const ids = [...new Set(((mine ?? []) as { round_id: number }[]).map((r) => r.round_id))];
  // Not playing? A card they follow (0158) — a son's round, a friend's.
  const nothing = async () => (await widgetFollowFor(db, memberId, now)) ?? emptyPayload(now);
  if (!ids.length) return nothing();

  const { data: rounds, error: e2 } = await db.from("live_rounds").select(ROUND_COLS).in("id", ids);
  if (e2) throw e2;
  const focusRow = pickFocus((rounds ?? []) as RoundRow[], irishToday(now));
  if (!focusRow) return nothing();

  let day: WidgetDay | null = null;
  let dayRows: RoundRow[] = [focusRow];
  if (focusRow.match_day_id != null) {
    const [d, rs] = await Promise.all([
      db.from("live_match_days").select("id, title, team_names, kind, leaderboard_hidden, created_by").eq("id", focusRow.match_day_id).maybeSingle(),
      db.from("live_rounds").select(ROUND_COLS).eq("match_day_id", focusRow.match_day_id).order("match_number"),
    ]);
    if (d.error) throw d.error;
    if (rs.error) throw rs.error;
    const dd = d.data as { id: number; title: string; team_names: string[] | null; kind: string | null; leaderboard_hidden: boolean | null; created_by: string | null } | null;
    // A secret leaderboard (0174): until the results are published, a player
    // sees only their own group — on the widget and the watch as in the app.
    // The organiser (0174's live_day_organiser: whoever started the day, or
    // the society event's officers) still sees everything. Read with the
    // service client, so this check is all that keeps the other groups out.
    if (dd && (await secretFor(db, dd, memberId))) {
      const games = await loadGames(db, [focusRow]);
      const focus = games.find((g) => g.round.id === focusRow.id);
      return focus ? buildWidgetPayload({ me: memberId, focus, day: null, games, now }) : emptyPayload(now);
    }
    if (dd) {
      day = {
        id: dd.id,
        title: dd.title,
        teamNames: dd.team_names && dd.team_names.length === 2 ? [dd.team_names[0], dd.team_names[1]] : null,
        kind: dd.kind === "scramble" ? "scramble" : "match",
      };
      dayRows = (rs.data ?? []) as RoundRow[];
    }
  }

  const games = await loadGames(db, dayRows);
  const focus = games.find((g) => g.round.id === focusRow.id);
  if (!focus) return emptyPayload(now);
  return buildWidgetPayload({ me: memberId, focus, day, games, now });
}
