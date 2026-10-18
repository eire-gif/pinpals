import { asId, authenticateAppRequest, badRequest, unauthenticated } from "@/lib/app-api";
import { signLiveScoreToken } from "@/lib/live-score-token";

/**
 * POST /api/app/live/rounds/[id]/lock-screen-key   → { token, expiresAt }
 *
 * The key the iPhone lock screen card (Live Activity) saves this member's
 * scores with, for this round only (src/lib/live-score-token.ts). The app
 * asks when it starts or refreshes the card.
 *
 * Only for a live round the member is playing in — their own ball, or their
 * pair's or team's card: the
 * same rule live_round_set_own_score() (0155) enforces on every save, checked
 * here too so the app doesn't offer a lock screen card that can't save.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();
  const roundId = asId((await params).id);
  if (roundId === null) return badRequest("id must be a positive integer");

  // Read under RLS: only the people in a round can see it at all.
  const { data: round } = await auth.supabase
    .from("live_rounds")
    .select("id, status, scramble_size, match_type")
    .eq("id", roundId)
    .maybeSingle<{ id: number; status: string; scramble_size: number | null; match_type: string | null }>();
  if (!round) return Response.json({ error: "Round not found" }, { status: 404 });
  if (round.status !== "live") return Response.json({ error: "This round has finished" }, { status: 409 });
  // A pair or scramble team scores its one card (0175); a foursomes or
  // greensomes match stays in the app.
  if (round.match_type === "foursomes" || round.match_type === "greensomes") {
    return Response.json({ error: "This format is scored in the app" }, { status: 409 });
  }

  const { data: player } = await auth.supabase
    .from("live_round_players")
    .select("id")
    .eq("round_id", roundId)
    .eq("member_id", auth.user.id)
    .limit(1)
    .maybeSingle<{ id: number }>();
  if (!player) return Response.json({ error: "You're not playing in this round" }, { status: 403 });

  return Response.json(signLiveScoreToken(auth.user.id, roundId), { headers: { "cache-control": "private, no-store" } });
}
