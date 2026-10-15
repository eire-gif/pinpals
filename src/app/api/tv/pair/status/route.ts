import { readJson } from "@/lib/app-api";
import { createAdminClient } from "@/lib/supabase/admin";
import { tvCodeStatus } from "@/lib/tv-pairing";
import { normaliseTvCode } from "@/lib/tv-token";

/**
 * POST /api/tv/pair/status  { code, secret }
 *   → { state: "waiting" | "expired" | "unknown" } or { state: "linked", path }
 *
 * The TV polls this every few seconds while it shows its code. A POST so the
 * secret never sits in a URL or an access log.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await readJson<{ code?: unknown; secret?: unknown }>(request);
  const code = normaliseTvCode(body?.code);
  const secret = typeof body?.secret === "string" && body.secret.length >= 16 && body.secret.length <= 64 ? body.secret : null;
  if (!code || !secret) return Response.json({ state: "unknown" }, { status: 400 });
  try {
    const status = await tvCodeStatus(createAdminClient(), code, secret);
    const out = status.state === "linked" ? { state: "linked", path: `/tv/s/${status.token}` } : status;
    return Response.json(out, { headers: { "cache-control": "private, no-store" } });
  } catch (e) {
    console.error("tv: status failed", e);
    return Response.json({ error: "Couldn't check the code." }, { status: 500 });
  }
}
