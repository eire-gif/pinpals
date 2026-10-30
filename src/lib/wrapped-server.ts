import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { buildWrapped, type Wrapped, type WrappedCard, type WrappedPartner } from "@/lib/wrapped";

/**
 * A member's year (PinPals Wrapped) for the picture route, read with the
 * service role AFTER the signed link has proved whose year it is
 * (wrapped-links.ts). The same rows and arithmetic as the app
 * (mobile/src/lib/wrapped-data.ts → wrapped.ts), so both say the same.
 */
type CardRow = {
  club_id: number | null;
  course_name: string;
  played_on: string;
  holes: number;
  handicap_index: number | string | null;
  playing_handicap: number | null;
  live_round_id: number | null;
  club: { country: string } | null;
  scorecard_holes: { hole: number; par: number; stroke_index: number | null; strokes: number | null }[];
};

export async function loadWrappedFor(memberId: string, year: number): Promise<{ wrapped: Wrapped; firstName: string | null } | null> {
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("first_name, deleted_at").eq("id", memberId).maybeSingle<{ first_name: string | null; deleted_at: string | null }>();
  if (!profile || profile.deleted_at) return null;
  const { data, error } = await admin
    .from("scorecards")
    .select("club_id, course_name, played_on, holes, handicap_index, playing_handicap, live_round_id, club:clubs ( country ), scorecard_holes ( hole, par, stroke_index, strokes )")
    .eq("member_id", memberId)
    .lte("played_on", `${year}-12-31`)
    .order("played_on")
    .limit(3000)
    .returns<CardRow[]>();
  if (error) return null;
  const rows = data ?? [];
  const thisYear = rows.filter((r) => r.played_on.startsWith(`${year}-`));
  const prior = new Set(rows.filter((r) => r.played_on < `${year}-01-01` && r.club_id != null).map((r) => r.club_id as number));
  const roundIds = thisYear.map((r) => r.live_round_id).filter((x): x is number => x != null);
  let dayRounds = new Set<number>();
  let partners: WrappedPartner[] = [];
  if (roundIds.length) {
    const [rounds, players] = await Promise.all([
      admin.from("live_rounds").select("id, match_day_id").in("id", roundIds).returns<{ id: number; match_day_id: number | null }[]>(),
      admin.from("live_round_players").select("round_id, member_id, display_name").in("round_id", roundIds).returns<{ round_id: number; member_id: string | null; display_name: string }[]>(),
    ]);
    dayRounds = new Set((rounds.data ?? []).filter((r) => r.match_day_id != null).map((r) => r.id));
    const count = new Map<string, WrappedPartner>();
    for (const p of players.data ?? []) {
      if (p.member_id === memberId) continue;
      const key = p.member_id ?? `guest:${p.display_name.toLowerCase().replace(/\s*\(guest\)\s*$/, "")}`;
      const e = count.get(key);
      if (e) e.rounds += 1;
      else count.set(key, { key, name: p.display_name.replace(/\s*\(guest\)\s*$/i, ""), rounds: 1 });
    }
    partners = [...count.values()];
  }
  const cards: WrappedCard[] = thisYear.map((r) => ({
    clubId: r.club_id,
    courseName: r.course_name,
    country: r.club?.country ?? null,
    playedOn: r.played_on,
    holes: r.holes,
    handicapIndex: r.handicap_index == null ? null : Number(r.handicap_index),
    playingHandicap: r.playing_handicap,
    groupDay: r.live_round_id != null && dayRounds.has(r.live_round_id),
    holeList: (r.scorecard_holes ?? []).map((h) => ({ hole: h.hole, par: h.par, strokeIndex: h.stroke_index, strokes: h.strokes })).sort((a, b) => a.hole - b.hole),
  }));
  return { wrapped: buildWrapped(year, cards, partners, prior), firstName: profile.first_name };
}
