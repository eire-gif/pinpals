import { asId, authenticateAppRequest, badRequest, unauthenticated } from "@/lib/app-api";
import { cardForFollow, type FollowRow } from "@/lib/follow-data";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/app/live/follows/[id] → { card, followId } | { reason }
 *
 * One followed card, for the app's follow screen (polled while it's open).
 * The row is read with the member's own client first, so RLS decides: only
 * its follower (or whoever shared it) gets past here.
 */
export const dynamic = "force-dynamic";

const MESSAGES: Record<string, string> = {
  stopped: "This round is no longer being shared.",
  expired: "Sharing for this round has ended.",
  gone: "This round has been deleted.",
};

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();
  const id = asId((await params).id);
  if (id === null) return badRequest("id must be a positive integer");

  const { data: row } = await auth.supabase
    .from("live_round_follows")
    .select("id, round_id, player_id, shared_by, follower_id, created_at, expires_at, revoked_at")
    .eq("id", id)
    .maybeSingle<FollowRow>();
  if (!row) return Response.json({ error: "Round not found", reason: "not_found" }, { status: 404 });

  try {
    const got = await cardForFollow(createAdminClient(), row);
    if (!got.ok) return Response.json({ error: MESSAGES[got.reason] ?? "Not available.", reason: got.reason }, { status: 410 });
    return Response.json({ followId: row.id, card: got.card }, { headers: { "cache-control": "private, no-store" } });
  } catch (e) {
    console.error("follow: card failed", e);
    return Response.json({ error: "Couldn't load the card." }, { status: 500 });
  }
}
