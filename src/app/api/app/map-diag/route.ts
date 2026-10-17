import { authenticateAppRequest, unauthenticated } from "@/lib/app-api";

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
  const body = await request.text().catch(() => "");
  console.log("map-diag", body.slice(0, 3000));
  return new Response(null, { status: 204 });
}
