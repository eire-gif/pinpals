import { verifyLiveScoreToken } from "@/lib/live-score-token";
import { createAdminClient } from "@/lib/supabase/admin";
import { widgetPayloadFor } from "@/lib/widget-data";

/**
 * GET /api/widget/live/board   (header  Authorization: LiveScore <key>)
 *
 * The leaderboard on a watch (watch v2, claude/watch-v2.md): the same
 * payload the Home Screen widgets draw (src/lib/widget-board.ts) — the
 * member's live game, their row marked — opened with the key the watch
 * already holds for scoring the round. A secret leaderboard shows only the
 * member's own group, as in the app (widget-data.ts).
 *
 * 401 → the key has expired; the phone renews it when the round is opened.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "private, no-store" };

export async function GET(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const key = verifyLiveScoreToken(header.match(/^LiveScore (.+)$/i)?.[1]?.trim());
  if (!key) return Response.json({ error: "Open PinPals on your phone to see the leaderboard here." }, { status: 401, headers: NO_STORE });
  try {
    const payload = await widgetPayloadFor(createAdminClient(), key.memberId);
    return Response.json(payload, { headers: NO_STORE });
  } catch (e) {
    console.error("watch board: payload failed", e);
    return Response.json({ error: "Couldn't load the leaderboard." }, { status: 500, headers: NO_STORE });
  }
}
