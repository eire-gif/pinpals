import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/app/signup/resend  { email }
 *
 * Sends the confirmation code again. Always answers 200 when the request is
 * well formed: saying "no such pending account" would tell anyone which
 * addresses have started joining.
 */

const RESEND_MAX_ATTEMPTS = 5;
const RESEND_WINDOW_SECONDS = 60 * 60;

export async function POST(request: Request) {
  const rateLimit = await checkRateLimit({
    action: "signup_resend",
    maxHits: RESEND_MAX_ATTEMPTS,
    windowSeconds: RESEND_WINDOW_SECONDS,
  });
  if (!rateLimit.allowed) {
    return Response.json({ error: rateLimitMessage(rateLimit.retryAfterSeconds) }, { status: 429 });
  }

  let email = "";
  try {
    const body = (await request.json()) as { email?: unknown };
    email = typeof body.email === "string" ? body.email.trim() : "";
  } catch {
    // fall through to the empty-email answer
  }
  if (!email) return Response.json({ error: "Enter your email address." }, { status: 400 });

  const supabase = await createClient();
  const { error } = await supabase.auth.resend({ type: "signup", email });
  if (error) console.warn("signup resend:", error.message);

  return Response.json({ ok: true }, { status: 200 });
}
