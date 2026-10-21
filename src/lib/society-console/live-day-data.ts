import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Results } from "@/lib/competition-results";
import type { CardHole } from "@/lib/live-scoring";
import { loadTvGames } from "@/lib/tv-data";
import type { TvGame } from "@/lib/tv-board";
import type { EventPage } from "./data";
import { loadRoster } from "./events-data";
import type { DrawnGroup } from "./live-day";
import type { DayKind } from "./live-results";

/**
 * Reads for the console's Live day pages, with the member's OWN client: the
 * event and its published draw, the course's cards, and the live day the
 * event became. RLS decides everything — an officer of the event sees its
 * day (0174's live_day_organiser), as in the app.
 */

type Db = SupabaseClient;

/** A tee on file for the club (course_cards_for_club, 0149). */
export type CourseCard = {
  id: number;
  teeName: string;
  holes: 9 | 18;
  parTotal: number | null;
  courseRating: number | null;
  slope: number | null;
  verified: boolean;
  card: CardHole[];
};

type ClubCardRow = {
  id: number;
  tee_name: string;
  holes: number;
  par_total: number | null;
  course_rating: number | string | null;
  slope: number | null;
  verified_at: string | null;
  course_card_holes: { hole: number; par: number; stroke_index: number | null }[];
};

export async function loadCourseCards(db: Db, clubId: number | null): Promise<CourseCard[]> {
  if (!clubId) return [];
  const { data, error } = await db.rpc("course_cards_for_club", { p_club_id: clubId });
  if (error) return [];
  return ((data ?? []) as ClubCardRow[])
    .filter((c) => c.holes === 9 || c.holes === 18)
    .map((c) => ({
      id: c.id,
      teeName: c.tee_name,
      holes: c.holes === 9 ? 9 : 18,
      parTotal: c.par_total,
      courseRating: c.course_rating == null ? null : Number(c.course_rating),
      slope: c.slope,
      verified: c.verified_at != null,
      card: [...(c.course_card_holes ?? [])].sort((a, b) => a.hole - b.hole).map((h) => ({ hole: h.hole, par: h.par, strokeIndex: h.stroke_index })),
    }));
}

/** The published draw as tee groups, with the index each player plays off:
 *  the society's figure, else their own where they share it (as the app). */
export async function loadDrawnGroups(db: Db, groupId: number, page: EventPage): Promise<DrawnGroup[]> {
  const roster = await loadRoster(db, groupId);
  const indexOf = new Map(roster.map((r) => [r.id, r.index]));
  const seats = [
    ...page.entries.map((e) => ({ group: e.teeGroup, position: e.teePosition, time: e.teeTime, player: { key: `m:${e.memberId}`, memberId: e.memberId, name: e.name, index: indexOf.get(e.memberId) ?? null, guest: false } })),
    ...page.guests.map((x) => ({ group: x.teeGroup, position: x.teePosition, time: x.teeTime, player: { key: `g:${x.id}`, memberId: null, name: x.name, index: x.handicapIndex, guest: true } })),
  ];
  const by = new Map<number, typeof seats>();
  for (const s of seats) if (s.group) by.set(s.group, [...(by.get(s.group) ?? []), s]);
  return [...by.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([n, list]) => {
      const sorted = [...list].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      return { number: n, teeTime: sorted.find((s) => s.time)?.time?.slice(0, 5) ?? null, players: sorted.map((s) => s.player) };
    });
}

export type LiveDay = {
  id: number;
  title: string;
  kind: DayKind;
  courseName: string;
  teeName: string | null;
  playedOn: string;
  createdBy: string | null;
  creatorName: string | null;
  hidden: boolean;
  games: TvGame[];
  starts: Record<number, string>;
  /** I started it: only I can correct scores and publish results (0104/0137). */
  mine: boolean;
  /** Results row as I can read it: published for everyone, a draft for the organiser. */
  results: { status: "draft" | "published"; settings: unknown; published: Results | null; version: number; shareToken: string | null; publishedAt: string | null; groupId: number | null } | null;
};

type DayRow = {
  id: number;
  title: string;
  kind: string | null;
  course_name: string;
  tee_name: string | null;
  played_on: string;
  created_by: string | null;
  leaderboard_hidden: boolean | null;
};

/** The live day, or null if it's gone (deleted) or I can't see it. */
export async function loadLiveDay(db: Db, dayId: number, me: string): Promise<LiveDay | null> {
  const [{ data: d }, loaded, { data: res }] = await Promise.all([
    db.from("live_match_days").select("id, title, kind, course_name, tee_name, played_on, created_by, leaderboard_hidden").eq("id", dayId).maybeSingle<DayRow>(),
    loadTvGames(db, { kind: "day", id: dayId }).catch(() => null),
    db
      .from("competition_results")
      .select("status, settings, results, version, share_token, published_at, group_id")
      .eq("match_day_id", dayId)
      .maybeSingle<{ status: "draft" | "published"; settings: unknown; results: Results | null; version: number; share_token: string | null; published_at: string | null; group_id: number | null }>(),
  ]);
  if (!d) return null;
  let creatorName: string | null = null;
  if (d.created_by) {
    const { data: p } = await db.from("profiles").select("first_name, last_name").eq("id", d.created_by).maybeSingle<{ first_name: string | null; last_name: string | null }>();
    creatorName = [p?.first_name, p?.last_name].filter(Boolean).join(" ") || null;
  }
  return {
    id: d.id,
    title: d.title,
    kind: d.kind === "scramble" ? "scramble" : d.kind === "fourballs" ? "fourballs" : "match",
    courseName: d.course_name,
    teeName: d.tee_name,
    playedOn: d.played_on,
    createdBy: d.created_by,
    creatorName,
    hidden: !!d.leaderboard_hidden,
    games: loaded?.games ?? [],
    starts: loaded?.starts ?? {},
    mine: d.created_by === me,
    results: res
      ? { status: res.status, settings: res.settings, published: res.status === "published" ? res.results : null, version: res.version, shareToken: res.share_token, publishedAt: res.published_at, groupId: res.group_id }
      : null,
  };
}

/** "<round id>:<member id>" → certified by a playing partner (0137). Empty if it can't be read. */
export async function loadCertified(db: Db, dayId: number): Promise<Map<string, boolean>> {
  const { data, error } = await db.rpc("competition_card_status", { p_day_id: dayId });
  const out = new Map<string, boolean>();
  if (error) return out;
  for (const c of (data ?? []) as { round_id: number; member_id: string; certified: boolean }[]) out.set(`${c.round_id}:${c.member_id}`, c.certified);
  return out;
}
