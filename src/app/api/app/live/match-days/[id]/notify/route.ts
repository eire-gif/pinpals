import { asId, authenticateAppRequest, badRequest, unauthenticated } from "@/lib/app-api";
import { notifyMatchDayPlayers } from "@/lib/live-match-notifications";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/app/live/match-days/[id]/notify
 *
 * Called by the app right after the organiser starts a match day
 * (live_match_day_create, 0104): every PinPal on the card is told which
 * match they're in, with whom and when, and tapping it opens their own
 * scorecard. Only the organiser can ask (checked under RLS with their own
 * client). Deduped per match and member, so a retry sends nothing twice.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();
  const dayId = asId((await params).id);
  if (dayId === null) return badRequest("id must be a positive integer");

  const { data: day } = await auth.supabase
    .from("live_match_days")
    .select("id, created_by")
    .eq("id", dayId)
    .maybeSingle<{ id: number; created_by: string | null }>();
  if (!day || day.created_by !== auth.user.id) {
    return Response.json({ error: "Match day not found" }, { status: 404 });
  }

  const sent = await notifyMatchDayPlayers(createAdminClient(), dayId);
  return Response.json({ sent });
}
