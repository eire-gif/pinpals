import { supabase } from "./supabase";
import { mondayOf, type BoardMetric, type BoardRow } from "./course-board-rules";

export * from "./course-board-rules";

/**
 * Course leaderboards (0197, claude/course-boards.md): this week's board,
 * the Course Legend and hole champions. All three are worked out in the
 * database from members' scorecards — who is shown (not "Only me" cards,
 * not opted out, not under 18, not blocked) is decided there.
 */

export type WeekBoard = { rows: BoardRow[]; players: number; weekStart: string };

export type Legend = {
  memberId: string;
  name: string;
  avatarUrl: string | null;
  avatarColor: string | null;
  rounds: number;
  myRounds: number;
  isMe: boolean;
};

export type HoleChampion = {
  hole: number;
  memberId: string;
  name: string;
  netToPar: number;
  playedOn: string;
  tied: number;
  isMe: boolean;
};

const nameOf = (first: string | null, initial: string | null) => [first ?? "Member", initial ? `${initial}` : ""].filter(Boolean).join(" ");

export async function loadWeekBoard(clubId: number, metric: BoardMetric): Promise<WeekBoard> {
  const { data, error } = await supabase.rpc("course_week_board", { p_club_id: clubId, p_metric: metric, p_week: null });
  if (error) throw new Error(error.message);
  type R = {
    place: number;
    member_id: string;
    first_name: string | null;
    last_initial: string | null;
    avatar_url: string | null;
    avatar_color: string | null;
    handicap: number | string | null;
    played_on: string;
    points: number;
    gross: number;
    net_to_par: number;
    is_me: boolean;
    players: number;
    week_start: string;
  };
  const rows = (data ?? []) as R[];
  return {
    rows: rows.map((r) => ({
      place: r.place,
      memberId: r.member_id,
      name: nameOf(r.first_name, r.last_initial),
      avatarUrl: r.avatar_url,
      avatarColor: r.avatar_color,
      handicap: r.handicap == null ? null : Number(r.handicap),
      playedOn: r.played_on,
      points: r.points,
      gross: r.gross,
      netToPar: r.net_to_par,
      isMe: r.is_me,
    })),
    players: rows[0]?.players ?? 0,
    weekStart: rows[0]?.week_start ?? mondayOf(new Date()),
  };
}

export async function loadLegend(clubId: number): Promise<Legend | null> {
  const { data, error } = await supabase.rpc("course_legend", { p_club_id: clubId });
  if (error) throw new Error(error.message);
  const r = ((data ?? []) as {
    member_id: string;
    first_name: string | null;
    last_initial: string | null;
    avatar_url: string | null;
    avatar_color: string | null;
    rounds: number;
    my_rounds: number;
    is_me: boolean;
  }[])[0];
  if (!r) return null;
  return {
    memberId: r.member_id,
    name: nameOf(r.first_name, r.last_initial),
    avatarUrl: r.avatar_url,
    avatarColor: r.avatar_color,
    rounds: r.rounds,
    myRounds: r.my_rounds ?? 0,
    isMe: r.is_me,
  };
}

export async function loadHoleChampions(clubId: number): Promise<{ holes: HoleChampion[]; monthStart: string | null }> {
  const { data, error } = await supabase.rpc("course_hole_champions", { p_club_id: clubId, p_month: null });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as {
    hole: number;
    member_id: string;
    first_name: string | null;
    last_initial: string | null;
    net_to_par: number;
    played_on: string;
    tied: number;
    is_me: boolean;
    month_start: string;
  }[];
  return {
    holes: rows.map((r) => ({
      hole: r.hole,
      memberId: r.member_id,
      name: nameOf(r.first_name, r.last_initial),
      netToPar: r.net_to_par,
      playedOn: r.played_on,
      tied: r.tied,
      isMe: r.is_me,
    })),
    monthStart: rows[0]?.month_start ?? null,
  };
}

export async function loadBoardsHidden(userId: string): Promise<boolean> {
  const { data } = await supabase.from("course_board_optouts").select("member_id").eq("member_id", userId).maybeSingle();
  return data != null;
}

export async function setBoardsHidden(hidden: boolean): Promise<void> {
  const { error } = await supabase.rpc("set_course_boards_hidden", { p_hidden: hidden });
  if (error) throw new Error(error.message);
}

