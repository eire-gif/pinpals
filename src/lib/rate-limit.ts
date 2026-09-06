import "server-only";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

// Server-side rate limiting for the mutation surfaces flagged by the
// adversarial security review as having none: login, signup,
// forgot/reset-password, marketplace offers, messages, and conversation
// reports. Backed by check_rate_limit() (supabase/migrations/
// 0031_rate_limiting.sql) — see that migration's own comment for why this
// is a fixed-window counter rather than a sliding one, and why it needs no
// new external service.

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/**
 * Best-effort caller identifier for the unauthenticated flows (login,
 * signup, forgot-password) where there is no user id yet. Takes the first
 * hop of `x-forwarded-for` — the actual client on Vercel and behind any
 * standard reverse proxy; everything after the first entry is proxies this
 * app doesn't control and shouldn't trust. Falls back to a shared "unknown"
 * bucket rather than throwing when headers() has no request context (a
 * script/test) or the header is simply absent (local dev with no proxy in
 * front) — a coarser shared limit across every such caller is still better
 * than skipping the check entirely. Exported for unit testing.
 */
export async function resolveClientIp(): Promise<string> {
  try {
    const h = await headers();
    const forwarded = h.get("x-forwarded-for");
    const first = forwarded?.split(",")[0]?.trim();
    return first || "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Checks and increments one rate-limit bucket. `identifier` should be a
 * user id for an already-authenticated mutation (reset-password, offers,
 * messages, reports); omit it for an unauthenticated flow (login, signup,
 * forgot-password) to rate-limit by client IP instead.
 *
 * Fails OPEN, not closed, on an infrastructure error (the RPC call itself
 * failing) — logged so the failure is visible, but a rate-limiter outage
 * must never itself become a way to lock every member out of login or
 * messaging. This mirrors this codebase's existing "a secondary system
 * failing must never break the primary flow" discipline (see
 * respondToOffer()'s own comment on its non-blocking order-write failure).
 */
export async function checkRateLimit(input: {
  action: string;
  identifier?: string;
  maxHits: number;
  windowSeconds: number;
}): Promise<RateLimitResult> {
  const identifier = input.identifier ?? (await resolveClientIp());
  const key = `${input.action}:${identifier}`;

  const admin = createAdminClient();
  const { data, error } = await admin
    .rpc("check_rate_limit", {
      p_key: key,
      p_max_hits: input.maxHits,
      p_window_seconds: input.windowSeconds,
    })
    .single<{ allowed: boolean; retry_after_seconds: number }>();

  if (error || !data) {
    console.error(`Rate limit check failed for "${key}":`, error?.message ?? "no row returned");
    return { allowed: true };
  }

  return data.allowed ? { allowed: true } : { allowed: false, retryAfterSeconds: data.retry_after_seconds };
}

/** A friendly, consistent message across every rate-limited action. */
export function rateLimitMessage(retryAfterSeconds: number): string {
  const minutes = Math.ceil(retryAfterSeconds / 60);
  return minutes <= 1
    ? "Too many attempts — please wait a minute and try again."
    : `Too many attempts — please wait ${minutes} minutes and try again.`;
}
