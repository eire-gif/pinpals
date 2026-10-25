import { authenticateAppRequest, unauthenticated } from "@/lib/app-api";
import { sendCompetitionAlerts } from "@/lib/competition-alerts";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/rate-limit";

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
  // Each call runs a batch with the server's own key, so one member can't
  // hammer it (security review, Oct 2026). Generous: the app calls it once
  // per change, and anything held back goes at the next scheduled run.
  const limit = await checkRateLimit({ action: "competition-alerts-flush", identifier: auth.user.id, maxHits: 30, windowSeconds: 60 });
  if (!limit.allowed) return Response.json({ throttled: true }, { status: 429 });
  const result = await sendCompetitionAlerts(createAdminClient(), 200);
  return Response.json(result);
}
