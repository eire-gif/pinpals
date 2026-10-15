import { authenticateAppRequest, unauthenticated } from "@/lib/app-api";
import { sendCompetitionAlerts } from "@/lib/competition-alerts";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/app/competitions/alerts
 *
 * The app calls this straight after a change to a competition (the draw, a
 * result, a challenge), so the alerts the database queued go out now rather
 * than at the next scheduled run. It sends only what is already in the
 * outbox — which only the database's own functions write — so a member can
 * make it happen sooner, never make it say anything. Repeats find nothing
 * new to send.
 */
export const maxDuration = 30;

export async function POST(request: Request) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();
  const result = await sendCompetitionAlerts(createAdminClient(), 200);
  return Response.json(result);
}
