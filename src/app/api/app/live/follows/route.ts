import { authenticateAppRequest, unauthenticated } from "@/lib/app-api";
import { followingFor } from "@/lib/follow-data";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/app/live/follows → { following: [{ followId, sharedBy, card }] }
 *
 * Follow my round (0158): the cards this member follows right now, for
 * Live scoring → Following. Only rows where they are the follower; the
 * cards are built server-side (follow-card.ts) so they never see more of
 * the game than the one shared card.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();
  try {
    const following = await followingFor(createAdminClient(), auth.user.id);
    return Response.json({ following }, { headers: { "cache-control": "private, no-store" } });
  } catch (e) {
    console.error("follow: list failed", e);
    return Response.json({ error: "Couldn't load the rounds you follow." }, { status: 500 });
  }
}
