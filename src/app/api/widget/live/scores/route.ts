import { after } from "next/server";

import { notifyHighlight } from "@/lib/live-highlights";
import { verifyLiveScoreToken } from "@/lib/live-score-token";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseWatchScores } from "@/lib/watch-scores";

/**
 * POST /api/widget/live/scores   (header  Authorization: LiveScore <key>)
 *   { hole: 1–18, scores: [{ player_id, strokes: 1–20 | null, clear?: true }] }
 *   → { ok: true, saved: [player_id, …] }
 *
 * The whole group's scores for one hole, from a watch (watch v2,
 * claude/watch-v2.md). The key is the lock screen's (src/lib/live-score-token.ts):
 * one member, one round. live_round_set_scores_as() (0185) lets that member
 * write any player in the round exactly when the app would — they created
 * it, organise its day, or play in it — and skips anyone not in it.
 *
 * Status codes as /api/widget/live/score: 401 → open PinPals on the phone;
 * 409 → the round has finished; 400/403 → drop, it can never be accepted;
 * 5xx or no answer → keep and retry.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "private, no-store" };

export async function POST(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const key = verifyLiveScoreToken(header.match(/^LiveScore (.+)$/i)?.[1]?.trim());
  if (!key) return Response.json({ error: "Open PinPals on your phone to keep scoring here." }, { status: 401, headers: NO_STORE });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "Expected JSON" }, { status: 400, headers: NO_STORE });
  }
  const body = parseWatchScores(raw);
  if ("error" in body) return Response.json({ error: body.error }, { status: 400, headers: NO_STORE });

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("live_round_set_scores_as", {
    p_member: key.memberId,
    p_round_id: key.roundId,
    p_hole: body.hole,
    p_scores: body.scores,
  });
  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "P0001" ? 409 : error.code === "22023" ? 400 : 500;
    if (status === 500) console.error("watch scores: write failed", error);
    return Response.json({ error: status === 500 ? "Couldn't save those scores." : error.message }, { status, headers: NO_STORE });
  }
  const saved = ((data ?? []) as (number | string)[]).map(Number);

  // A birdie or better tells everyone in the game, as an in-app score does.
  const birdieChecks = body.scores.filter((s) => !s.clear && s.strokes != null && saved.includes(s.player_id));
  if (birdieChecks.length > 0) {
    after(async () => {
      for (const s of birdieChecks) {
        try {
          await notifyHighlight(admin, { roundId: key.roundId, playerId: s.player_id, hole: body.hole, triggeredBy: key.memberId });
        } catch (e) {
          console.error("watch scores: highlight failed", e);
        }
      }
    });
  }

  return Response.json({ ok: true, saved }, { headers: NO_STORE });
}
