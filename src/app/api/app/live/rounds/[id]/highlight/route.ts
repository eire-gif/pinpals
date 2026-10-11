import { asId, authenticateAppRequest, badRequest, unauthenticated } from "@/lib/app-api";
import { notifyHighlight } from "@/lib/live-highlights";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/app/live/rounds/[id]/highlight   { playerId, hole }   → { sent, kind }
 *
 * Sent by the app a few seconds after a birdie-or-better goes in. The score
 * is re-read from the database here, so the app can't announce anything
 * that isn't on the card (src/lib/live-highlights.ts). The caller must be
 * able to see the round under RLS — anyone in it, or in its match day.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();
  const roundId = asId((await params).id);
  if (roundId === null) return badRequest("id must be a positive integer");

  let body: { playerId?: unknown; hole?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return badRequest("Expected JSON");
  }
  const playerId = asId(String(body.playerId ?? ""));
  const hole = typeof body.hole === "number" && Number.isInteger(body.hole) && body.hole >= 1 && body.hole <= 18 ? body.hole : null;
  if (playerId === null || hole === null) return badRequest("playerId and hole (1-18) are required");

  const { data: round } = await auth.supabase.from("live_rounds").select("id").eq("id", roundId).maybeSingle<{ id: number }>();
  if (!round) return Response.json({ error: "Round not found" }, { status: 404 });

  const result = await notifyHighlight(createAdminClient(), { roundId, playerId, hole, triggeredBy: auth.user.id });
  return Response.json(result);
}
