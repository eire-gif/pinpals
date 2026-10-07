import { asId, authenticateAppRequest, badRequest, unauthenticated } from "@/lib/app-api";
import { notifyRoundPlayers } from "@/lib/live-match-notifications";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/app/live/rounds/[id]/notify
 *
 * Called by the app right after it starts a live round (live_round_create,
 * 0103), to tell the PinPals it added that they're in it. A route because
 * push, email and preferences live in notifyUser(); the round itself is
 * written by the app under RLS, as before.
 *
 * Only the member who started the round can ask — checked with the
 * member's own client, so RLS has the final word on whether the round even
 * exists for them. Repeats are harmless: every notification is deduped.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();
  const roundId = asId((await params).id);
  if (roundId === null) return badRequest("id must be a positive integer");

  const { data: round } = await auth.supabase
    .from("live_rounds")
    .select("id, created_by")
    .eq("id", roundId)
    .maybeSingle<{ id: number; created_by: string | null }>();
  if (!round || round.created_by !== auth.user.id) {
    return Response.json({ error: "Round not found" }, { status: 404 });
  }

  const sent = await notifyRoundPlayers(createAdminClient(), roundId);
  return Response.json({ sent });
}
