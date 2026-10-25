import { authenticateAppRequest, unauthenticated } from "@/lib/app-api";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * POST /api/app/map-diag — what the hole map page measured about Apple's map
 * (sizes, camera, how far off it was), written to the logs so Apple-map
 * alignment on real phones can be checked without guessing (Oct 2026).
 * Members only; numbers about the map view only, nothing about the member.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();
  const limit = await checkRateLimit({ action: "map-diag", identifier: auth.user.id, maxHits: 20, windowSeconds: 3600 });
  if (!limit.allowed) return new Response(null, { status: 204 });
  const body = await request.text().catch(() => "");
  // Quoted, so a member can't write fake log lines (newlines come out as \n).
  console.log("map-diag", auth.user.id, JSON.stringify(body.slice(0, 3000)));
  return new Response(null, { status: 204 });
}
