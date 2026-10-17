import { parseActivityPing } from "@/lib/activity";
import { checkRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createBearerClient } from "@/lib/supabase/bearer";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/activity — one "I'm here" ping (0161), from the website
 * (src/components/activity-beacon.tsx) or the app (mobile/src/lib/activity.ts).
 *
 * Body: { session, platform: "web" | "ios" | "android", section, view,
 *         install?, appVersion? }
 *
 * Signed-in or not. The member, if any, comes from their own cookie or bearer
 * token — never from the body — so nobody can mark someone else as online.
 * Always answers 204: a ping is best-effort and must never show an error.
 */
export const dynamic = "force-dynamic";

const NO_CONTENT = () => new Response(null, { status: 204, headers: { "cache-control": "no-store" } });

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NO_CONTENT();
  }
  const ping = parseActivityPing(body);
  if (!ping) return NO_CONTENT();

  const limit = await checkRateLimit({ action: "activity_ping", maxHits: 240, windowSeconds: 60 });
  if (!limit.allowed) return NO_CONTENT();

  const memberId = await memberFor(request);

  const { error } = await createAdminClient().rpc("record_activity", {
    p_session: ping.session,
    p_member: memberId,
    p_platform: ping.platform,
    p_section: ping.section,
    p_view: ping.view,
    p_install: ping.install,
    p_app_version: ping.appVersion,
  });
  if (error) console.error("activity: record failed", error.message);
  return NO_CONTENT();
}

/** The signed-in member, checked from the token's signature — no Auth
 *  server round trip on every ping. A stale or missing token is just a guest. */
async function memberFor(request: Request): Promise<string | null> {
  try {
    const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1]?.trim();
    if (token) {
      const { data } = await createBearerClient(token).auth.getClaims(token);
      return data?.claims?.sub ?? null;
    }
    const { data } = await (await createClient()).auth.getClaims();
    return data?.claims?.sub ?? null;
  } catch {
    return null;
  }
}
