import { asId, authenticateAppRequest, badRequest, unauthenticated } from "@/lib/app-api";
import { notifyMatchResult } from "@/lib/live-match-notifications";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/app/live/rounds/[id]/finished
 *
 * Called by the app after a player finishes a match in a match day
 * (live_round_finish). Tells everyone in the day the result and the team
 * score. Anyone who can see the round can ask, but nothing is sent unless
 * the round really is a finished match in a match day — and each member
 * hears about each match once, whoever asks and however often (dedupe).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();
  const roundId = asId((await params).id);
  if (roundId === null) return badRequest("id must be a positive integer");

  const { data: round } = await auth.supabase
    .from("live_rounds")
    .select("id, status, match_day_id")
    .eq("id", roundId)
    .maybeSingle<{ id: number; status: string; match_day_id: number | null }>();
  if (!round) return Response.json({ error: "Round not found" }, { status: 404 });
  if (round.status !== "finished" || round.match_day_id == null) return Response.json({ sent: 0 });

  const sent = await notifyMatchResult(createAdminClient(), roundId);
  return Response.json({ sent });
}
