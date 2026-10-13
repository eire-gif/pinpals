import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { buildDataExport } from "@/lib/data-export-server";
import { exportFileName } from "@/lib/data-export";

/**
 * GET /profile/data/download — the signed-in member's data, as a JSON file.
 * Cookie session (the website, or the app via its signed-in hand-off).
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Sign in to download your data.", { status: 401 });

  const limit = await checkRateLimit({ action: "data-export", identifier: user.id, maxHits: 5, windowSeconds: 86400 });
  if (!limit.allowed) return new Response(rateLimitMessage(limit.retryAfterSeconds), { status: 429 });

  const data = await buildDataExport(user);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFileName(user.id, new Date())}"`,
      "Cache-Control": "no-store",
    },
  });
}
