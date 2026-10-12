import { asId, authenticateAppRequest, badRequest, unauthenticated } from "@/lib/app-api";
import { notifyCertification } from "@/lib/scorecard-certify-notifications";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/app/scorecards/certifications/[id]/notify   → { sent }
 *
 * Called by the app right after it asks for a card to be certified, or
 * answers such a request (0128). The request itself is written by the app
 * through the SQL functions; this only tells the other person. A route
 * because push and preferences live in notifyUser().
 *
 * The caller must be the owner or the certifier — checked with the member's
 * own client, so RLS decides whether the request exists for them — and
 * notifyCertification() only sends what the caller's own move produced.
 * Repeats are harmless: every notification is deduped.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();
  const id = asId((await params).id);
  if (id === null) return badRequest("id must be a positive integer");

  const { data } = await auth.supabase
    .from("scorecard_certifications")
    .select("id, owner_id, certifier_id")
    .eq("id", id)
    .maybeSingle<{ id: number; owner_id: string; certifier_id: string | null }>();
  if (!data || (data.owner_id !== auth.user.id && data.certifier_id !== auth.user.id)) {
    return Response.json({ error: "Request not found" }, { status: 404 });
  }

  const sent = await notifyCertification(createAdminClient(), id, auth.user.id);
  return Response.json({ sent });
}
