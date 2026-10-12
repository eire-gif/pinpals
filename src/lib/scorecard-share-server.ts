import "server-only";

import { verifyScorecardToken } from "@/lib/scorecard-links";
import type { ScorecardHole, ScorecardMeta } from "@/lib/scorecard-math";
import { createAdminClient } from "@/lib/supabase/admin";

export type SharedScorecard = ScorecardMeta & {
  id: number;
  firstName: string | null;
  holeList: ScorecardHole[];
  /** A playing partner certified it (0128): their first name, how and when. */
  certified: { by: string; method: string; at: string } | null;
};

/**
 * What a public scorecard link shows (0110). Read with the service role,
 * because link previews arrive with no session — and then shown only if the
 * token is genuine, the card still exists, the sharer still owns it and
 * their account isn't being deleted. Anything else is null: the page says
 * the card isn't available, and the preview is a plain PinPals card.
 */
export async function loadSharedScorecard(token: string): Promise<SharedScorecard | null> {
  const payload = verifyScorecardToken(token);
  if (!payload) return null;

  const { data } = await createAdminClient()
    .from("scorecards")
    .select(
      "id, member_id, course_name, tee_name, holes, played_on, handicap_index, playing_handicap, owner:profiles!scorecards_member_id_fkey ( first_name, deleted_at ), scorecard_holes ( hole, par, stroke_index, yards, strokes, putts )"
    )
    .eq("id", payload.c)
    .maybeSingle<{
      id: number;
      member_id: string;
      course_name: string;
      tee_name: string | null;
      holes: number;
      played_on: string;
      handicap_index: number | string | null;
      playing_handicap: number | null;
      owner: { first_name: string | null; deleted_at: string | null } | null;
      scorecard_holes: { hole: number; par: number; stroke_index: number | null; yards: number | null; strokes: number | null; putts: number | null }[];
    }>();

  if (!data || data.member_id !== payload.s || !data.owner || data.owner.deleted_at) return null;

  // First name only: the page is public, and the certifier didn't send it.
  const { data: cert } = await createAdminClient()
    .from("scorecard_certifications")
    .select("certifier_name, method, responded_at")
    .eq("scorecard_id", data.id)
    .eq("status", "certified")
    .maybeSingle<{ certifier_name: string; method: string; responded_at: string }>();

  return {
    id: data.id,
    firstName: data.owner.first_name,
    courseName: data.course_name,
    teeName: data.tee_name,
    holes: data.holes === 9 ? 9 : 18,
    playedOn: data.played_on,
    handicapIndex: data.handicap_index == null ? null : Number(data.handicap_index),
    playingHandicap: data.playing_handicap,
    holeList: [...data.scorecard_holes]
      .sort((a, b) => a.hole - b.hole)
      .map((h) => ({ hole: h.hole, par: h.par, strokeIndex: h.stroke_index, yards: h.yards, strokes: h.strokes, putts: h.putts })),
    certified: cert ? { by: cert.certifier_name.trim().split(/\s+/)[0] || "A PinPal", method: cert.method, at: cert.responded_at } : null,
  };
}
