import { authenticateAppRequest, unauthenticated } from "@/lib/app-api";
import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { buildDataExport } from "@/lib/data-export-server";
import { exportFileName } from "@/lib/data-export";

/**
 * GET /api/app/account/export — the member's data, for the app (bearer token).
 * Same file as /profile/data/download on the website.
 */
export async function GET(request: Request) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const limit = await checkRateLimit({ action: "data-export", identifier: auth.user.id, maxHits: 5, windowSeconds: 86400 });
  if (!limit.allowed) {
    return Response.json({ error: rateLimitMessage(limit.retryAfterSeconds), reason: "rate_limited" }, { status: 429 });
  }

  const data = await buildDataExport(auth.user);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFileName(auth.user.id, new Date())}"`,
      "Cache-Control": "no-store",
    },
  });
}
