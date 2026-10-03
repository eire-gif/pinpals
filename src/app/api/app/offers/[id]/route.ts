import { asId, authenticateAppRequest, badRequest, readJson, unauthenticated } from "@/lib/app-api";
import { isOfferActionKind, respondToOffer, statusForMarketplaceFailure } from "@/lib/marketplace-operations";

/**
 * POST /api/app/offers/[id]   { action, counter_amount_eur? }
 *
 * Accept, decline, counter or withdraw an offer — whichever the caller is
 * allowed to do, which offer_action() (0048) decides. The listing is read
 * back from the offer under the caller's own RLS before the service-role
 * call, so an offer the caller cannot see cannot be acted on.
 *
 * Accepting returns the order it created, so the buyer can go straight to
 * checkout.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const offerId = asId((await params).id);
  if (offerId === null) return badRequest("id must be a positive integer");

  const body = await readJson<{ action?: unknown; counter_amount_eur?: unknown }>(request);
  if (!isOfferActionKind(body?.action)) return badRequest("action must be accept, decline, counter or withdraw");
  const counter = typeof body?.counter_amount_eur === "number" ? body.counter_amount_eur : null;

  const result = await respondToOffer({
    supabase: auth.supabase,
    userId: auth.user.id,
    offerId,
    action: body.action,
    counterAmountEur: counter,
  });
  if (!result.ok) {
    return Response.json({ error: result.message, reason: result.reason }, { status: statusForMarketplaceFailure(result.reason) });
  }
  return Response.json({ listing_id: result.value.listingId, order_id: result.value.orderId });
}
