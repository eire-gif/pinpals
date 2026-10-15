import { createAdminClient } from "@/lib/supabase/admin";
import { tvPayloadFor } from "@/lib/tv-data";
import { verifyTvToken } from "@/lib/tv-token";

/**
 * GET /api/tv/board   (header  Authorization: TV <token>)
 *
 * The leaderboard a clubhouse TV draws (src/lib/tv-board.ts), polled every
 * few seconds by /tv/s/<token>. The token is the signed link the organiser
 * put on that TV; it opens this one game and nothing else.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const token = (request.headers.get("authorization") ?? "").match(/^TV (.+)$/i)?.[1]?.trim();
  const target = verifyTvToken(token);
  if (!target) return Response.json({ error: "This TV link has expired." }, { status: 401 });
  try {
    const payload = await tvPayloadFor(createAdminClient(), target);
    if (!payload) return Response.json({ error: "This game has been deleted." }, { status: 404 });
    return Response.json(payload, { headers: { "cache-control": "private, no-store" } });
  } catch (e) {
    console.error("tv: board failed", e);
    return Response.json({ error: "Couldn't load the leaderboard." }, { status: 500 });
  }
}
