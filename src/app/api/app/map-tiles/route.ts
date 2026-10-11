import { authenticateAppRequest, unauthenticated } from "@/lib/app-api";
import { currentMapTiles } from "@/lib/map-tiles";

/**
 * GET /api/app/map-tiles   → MapTiles (src/lib/map-tiles.ts)
 *
 * Which satellite photo the app's hole maps load: Google's (with a session
 * shared by everyone) or Esri's. Members only — the answer carries the key
 * the tile URLs need, and there's no reason to hand that to anyone else.
 * Never fails for a member: trouble with Google answers "esri".
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();
  const tiles = await currentMapTiles();
  return Response.json(tiles, { headers: { "cache-control": "private, no-store" } });
}
