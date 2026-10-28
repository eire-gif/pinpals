import { authenticateAppRequest, readJson, unauthenticated } from "@/lib/app-api";
import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { keepAppleRefreshToken } from "@/lib/apple-sign-in";

/**
 * POST /api/app/apple/token   (bearer)
 *
 * Sign in with Apple (Oct 2026): straight after signing in, the app sends
 * the one-time authorisation code Apple gave it, so the account's Apple grant
 * can be revoked if it's ever deleted (src/lib/apple-sign-in.ts). Only for an
 * account that signed in with Apple.
 *
 * Body: { authorizationCode }
 * 200 { kept }  ·  400  ·  401  ·  429 { error }
 */
export async function POST(request: Request) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const providers = (auth.user.app_metadata?.providers as unknown[] | undefined) ?? [auth.user.app_metadata?.provider];
  if (!providers.includes("apple")) return Response.json({ error: "Not an Apple sign-in." }, { status: 400 });

  const limit = await checkRateLimit({ action: "apple-token", identifier: auth.user.id, maxHits: 10, windowSeconds: 3600 });
  if (!limit.allowed) return Response.json({ error: rateLimitMessage(limit.retryAfterSeconds) }, { status: 429 });

  const body = await readJson<{ authorizationCode?: unknown }>(request);
  const code = typeof body?.authorizationCode === "string" ? body.authorizationCode.trim() : "";
  if (!code || code.length > 2000) return Response.json({ error: "Missing code." }, { status: 400 });

  const kept = await keepAppleRefreshToken(auth.user.id, code).catch(() => false);
  return Response.json({ kept });
}
