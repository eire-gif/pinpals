import { after } from "next/server";

import { notifyHighlight } from "@/lib/live-highlights";
import { verifyLiveScoreToken } from "@/lib/live-score-token";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/widget/live/score   (header  Authorization: LiveScore <key>)
 *   { hole: 1–18, strokes: 1–20 | null, clear?: boolean }   → { ok: true }
 *
 * A score saved from the iPhone lock screen (the Live Activity's Save or
 * Picked up button), sent while the app is asleep. strokes null = picked up,
 * as in the app; clear removes the hole's score.
 *
 * The key (src/lib/live-score-token.ts) names one member and one round, and
 * live_round_set_own_score() (0155) writes only that member's own ball, only
 * while the round is live and only in formats where everyone plays their own
 * ball. The key travels in a header so it never lands in access logs.
 *
 * Status codes the card acts on: 401 → "open PinPals" (key expired or
 * signed out); 409 → the round has finished, stop retrying; 400/403 → drop
 * the score, it can never be accepted; 5xx or no answer → keep it and retry.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "private, no-store" };

export async function POST(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const key = verifyLiveScoreToken(header.match(/^LiveScore (.+)$/i)?.[1]?.trim());
  if (!key) return Response.json({ error: "Open PinPals to keep scoring from the lock screen." }, { status: 401, headers: NO_STORE });

  let body: { hole?: unknown; strokes?: unknown; clear?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Expected JSON" }, { status: 400, headers: NO_STORE });
  }
  const hole = typeof body.hole === "number" && Number.isInteger(body.hole) && body.hole >= 1 && body.hole <= 18 ? body.hole : null;
  const clear = body.clear === true;
  const strokes =
    body.strokes === null
      ? null
      : typeof body.strokes === "number" && Number.isInteger(body.strokes) && body.strokes >= 1 && body.strokes <= 20
        ? body.strokes
        : undefined;
  if (hole === null || (!clear && strokes === undefined)) {
    return Response.json({ error: "hole (1-18) and strokes (1-20, or null for picked up) are required" }, { status: 400, headers: NO_STORE });
  }

  const admin = createAdminClient();
  const { data: playerId, error } = await admin.rpc("live_round_set_own_score", {
    p_member: key.memberId,
    p_round_id: key.roundId,
    p_hole: hole,
    p_strokes: clear ? null : strokes,
    p_clear: clear,
  });
  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "P0001" ? 409 : error.code === "22023" ? 400 : 500;
    if (status === 500) console.error("lock screen score: write failed", error);
    return Response.json({ error: status === 500 ? "Couldn't save that score." : error.message }, { status, headers: NO_STORE });
  }

  // A birdie or better tells everyone in the game, as an in-app score does.
  // After the response, so the lock screen isn't kept waiting on pushes;
  // notifyHighlight re-reads the score and does nothing for anything less.
  if (!clear && strokes != null && typeof playerId === "number") {
    after(async () => {
      try {
        await notifyHighlight(admin, { roundId: key.roundId, playerId, hole, triggeredBy: key.memberId });
      } catch (e) {
        console.error("lock screen score: highlight failed", e);
      }
    });
  }

  return Response.json({ ok: true }, { headers: NO_STORE });
}
