import { authenticateAppRequest, readJson, unauthenticated } from "@/lib/app-api";
import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { reissueParentLink } from "@/lib/age-access";

/**
 * POST /api/app/age/parent   (bearer)
 *
 * Junior members (0159): a 13–15 year old who is still waiting for a parent
 * sends the request again, or to a different email (a typo, or the first
 * parent said no). A fresh secret replaces the pending one, so an older
 * email's link stops working. The website's waiting panel does the same
 * through a server action (src/components/age/actions.ts).
 *
 * Body: { email }
 * 200 { ok: true }  ·  400 { error }  ·  401  ·  429 { error }
 *
 * Rate-limited per member: each call sends an email to an address the
 * member typed, so this must not become a way to send PinPals mail to
 * anyone, over and over.
 */
const MAX_PER_HOUR = 5;

export async function POST(request: Request) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const limit = await checkRateLimit({ action: "age-parent-email", identifier: auth.user.id, maxHits: MAX_PER_HOUR, windowSeconds: 3600 });
  if (!limit.allowed) return Response.json({ error: rateLimitMessage(limit.retryAfterSeconds) }, { status: 429 });

  const body = await readJson<{ email?: unknown }>(request);
  const result = await reissueParentLink(auth.supabase, auth.user, body?.email);
  return result.ok ? Response.json({ ok: true }) : Response.json({ error: result.error }, { status: 400 });
}
