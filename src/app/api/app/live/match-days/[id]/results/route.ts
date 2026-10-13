import { asId, authenticateAppRequest, badRequest, unauthenticated } from "@/lib/app-api";
import { notifyResults } from "@/lib/competition-results-server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/app/live/match-days/[id]/results
 *
 * Called by the app right after the organiser publishes (or republishes)
 * the day's results (competition_results_publish, 0137): everyone in the
 * day is told the winners and where they finished. Only the organiser can
 * ask (checked under RLS with their own client). Deduped per version.
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
    return Response.json({ error: "Day not found" }, { status: 404 });
  }

  const sent = await notifyResults(createAdminClient(), dayId);
  return Response.json({ sent });
}
