import { authenticateAppRequest, unauthenticated } from "@/lib/app-api";
import { sendSocietyAlerts } from "@/lib/society-alerts";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/app/societies/alerts
 *
 * The app calls this straight after a change to a society event, request,
 * notice or message, so the alerts the database queued for it go out now
 * rather than at the next scheduled run. It sends only what is already in
 * the outbox — which only the database's own functions write — so a member
 * can make it happen sooner, never make it say anything. Any signed-in
 * member may call it; repeats find nothing new to send.
 */
export const maxDuration = 30;

export async function POST(request: Request) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();
  const result = await sendSocietyAlerts(createAdminClient(), 200);
  return Response.json(result);
}
