import { authenticateAppRequest, unauthenticated } from "@/lib/app-api";
import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { discardNewAccount } from "@/lib/auth/discard-new-account";

/**
 * POST /api/app/account/discard-new   (bearer)
 *
 * The app's "Already have a PinPals account? Use that instead" on Finish
 * joining: removes this brand-new, unused Apple/Google account
 * (src/lib/auth/discard-new-account.ts). The app then signs out locally.
 *
 * 200 { ok: true }  ·  400 { error }  ·  401  ·  429 { error }
 */
export async function POST(request: Request) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const limit = await checkRateLimit({ action: "discard-new-account", identifier: auth.user.id, maxHits: 5, windowSeconds: 3600 });
  if (!limit.allowed) return Response.json({ error: rateLimitMessage(limit.retryAfterSeconds) }, { status: 429 });

  const result = await discardNewAccount(auth.user);
  return result.ok ? Response.json({ ok: true }) : Response.json({ error: result.error }, { status: 400 });
}
