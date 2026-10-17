import { requireStaff } from "@/lib/admin/authorization";
import { currentMapTiles } from "@/lib/map-tiles";

/**
 * GET /admin/map-lab/token → { provider, token? }
 *
 * Staff only (two-step sign-in). Hands a MapKit JS token to a signed-in
 * staff browser so the hole map page can be tried against Apple's real map
 * on a computer, not only through app updates (Oct 2026, Apple Maps
 * alignment work). Same token the app gets from /api/app/map-tiles.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  await requireStaff();
  const tiles = await currentMapTiles();
  return Response.json(tiles.provider === "apple" ? { provider: "apple", token: tiles.token } : { provider: tiles.provider }, {
    headers: { "cache-control": "private, no-store" },
  });
}
