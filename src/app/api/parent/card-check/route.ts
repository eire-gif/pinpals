import { createClient } from "@/lib/supabase/server";
import { getStripeClient } from "@/lib/stripe/client";
import { getSiteUrl } from "@/lib/site-url";
import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { hashFromRequest, linkByHash, NO_STORE } from "@/lib/parent-approval";

/**
 * POST /api/parent/card-check   (header  Authorization: Parent <secret>)
 *
 * Junior members (0159): the optional €0 card check, when staff have
 * switched it on (age_settings.require_parent_card_check). A Stripe
 * Checkout Session in setup mode — the parent enters a card, Stripe checks
 * it, nothing is charged — and /parent/card-done confirms it, approves the
 * link and detaches the card so PinPals keeps nothing.
 *
 * Only for the parent who has already ticked consent on this link (the
 * database set guardian_id and consented_at when they approved).
 *
 * 200 { url }  ·  400/403/404 { error }  ·  503 { error } when Stripe isn't configured.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const hash = hashFromRequest(request);
  if (!hash) return Response.json({ error: "This link isn't valid." }, { status: 404, headers: NO_STORE });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Please log in first." }, { status: 401, headers: NO_STORE });

  const link = await linkByHash(hash);
  if (!link) return Response.json({ error: "This link isn't valid." }, { status: 404, headers: NO_STORE });
  if (link.status === "approved") return Response.json({ error: "You've already approved this account." }, { status: 400, headers: NO_STORE });
  if (link.status !== "pending" || link.guardian_id !== user.id || !link.consented_at) {
    return Response.json({ error: "Approve the request first." }, { status: 403, headers: NO_STORE });
  }

  const limit = await checkRateLimit({ action: "parent-card-check", identifier: user.id, maxHits: 10, windowSeconds: 3600 });
  if (!limit.allowed) return Response.json({ error: rateLimitMessage(limit.retryAfterSeconds) }, { status: 429, headers: NO_STORE });

  let stripe;
  try {
    stripe = getStripeClient();
  } catch {
    return Response.json({ error: "Card checks aren't available just now. Please try again later." }, { status: 503, headers: NO_STORE });
  }

  const site = getSiteUrl();
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "setup",
      currency: "eur",
      payment_method_types: ["card"],
      metadata: { guardian_link_id: String(link.id), guardian_id: user.id },
      client_reference_id: user.id,
      // The secret never goes to Stripe: cancelling comes back to /parent,
      // whose page restores it from this tab's sessionStorage.
      success_url: `${site}/parent/card-done?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${site}/parent`,
    });
    if (!session.url) throw new Error("no url");
    return Response.json({ url: session.url }, { headers: NO_STORE });
  } catch (e) {
    console.error("[parent] card check session failed:", e instanceof Error ? e.message : e);
    return Response.json({ error: "Couldn't start the card check — please try again." }, { status: 500, headers: NO_STORE });
  }
}
