import { checkRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createTvCode } from "@/lib/tv-pairing";

/**
 * POST /api/tv/pair  → { code, secret, expiresAt }
 *
 * A clubhouse TV (pinpals.ie/tv) asks for a code to show. No sign-in: the
 * code does nothing until the organiser pairs it from the app, and the link
 * then goes only to the TV holding `secret` (src/lib/tv-pairing.ts).
 * Limited per address, since anyone can call it.
 */
export const dynamic = "force-dynamic";

export async function POST() {
  const limit = await checkRateLimit({ action: "tv_pair_code", maxHits: 30, windowSeconds: 3600 });
  if (!limit.allowed) {
    return Response.json({ error: "Too many new codes from here. Try again shortly." }, { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } });
  }
  try {
    const out = await createTvCode(createAdminClient());
    return Response.json(out, { headers: { "cache-control": "private, no-store" } });
  } catch (e) {
    console.error("tv: create code failed", e);
    return Response.json({ error: "Couldn't get a code. Try again." }, { status: 500 });
  }
}
