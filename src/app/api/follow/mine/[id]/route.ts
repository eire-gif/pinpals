import { asId } from "@/lib/app-api";
import { cardForFollow, type FollowRow } from "@/lib/follow-data";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/follow/mine/[id] → { card } | { reason }
 *
 * Follow my round (0158), on the website: a card a PinPal shared with you,
 * for the signed-in member's browser session (cookie). Polled by
 * /live/follow/<id> — where an app too old to have the Following screen
 * lands, and where the alert opens on a computer.
 *
 * The row is read with the member's own client first, so RLS decides: only
 * its follower, its sharer or the golfer whose card it is gets past here.
 */
export const dynamic = "force-dynamic";

const MESSAGES: Record<string, string> = {
  stopped: "This round is no longer being shared.",
  expired: "Sharing for this round has ended.",
  gone: "This round has been deleted.",
};

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = asId((await params).id);
  if (id === null) return Response.json({ error: "That link doesn't open a round.", reason: "not_found" }, { status: 404 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sign in to PinPals to follow this round.", reason: "signed_out" }, { status: 401 });

  const { data: row } = await supabase
    .from("live_round_follows")
    .select("id, round_id, player_id, shared_by, follower_id, created_at, expires_at, revoked_at")
    .eq("id", id)
    .maybeSingle<FollowRow>();
  if (!row) return Response.json({ error: "This round isn't shared with you.", reason: "not_found" }, { status: 404 });

  try {
    const got = await cardForFollow(createAdminClient(), row);
    if (!got.ok) return Response.json({ error: MESSAGES[got.reason] ?? "Not available.", reason: got.reason }, { status: 410 });
    return Response.json({ card: got.card }, { headers: { "cache-control": "private, no-store" } });
  } catch (e) {
    console.error("follow: web card failed", e);
    return Response.json({ error: "Couldn't load the card." }, { status: 500 });
  }
}
