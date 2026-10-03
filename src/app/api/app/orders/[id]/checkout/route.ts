import { asId, authenticateAppRequest, badRequest, readJson, unauthenticated } from "@/lib/app-api";
import { finishOfferCheckout, isDeliveryMethod, statusForMarketplaceFailure } from "@/lib/marketplace-operations";

/**
 * POST /api/app/orders/[id]/checkout   { delivery_method, address_id }
 *
 * Choose delivery for an order created by an accepted offer, before paying.
 * finalize_offer_checkout() (0050) checks the caller is the buyer and the
 * checkout window is still open. Same finishOfferCheckout() as the website.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const orderId = asId((await params).id);
  if (orderId === null) return badRequest("id must be a positive integer");

  const body = await readJson<{ delivery_method?: unknown; address_id?: unknown }>(request);
  if (!isDeliveryMethod(body?.delivery_method)) return badRequest("delivery_method must be 'post' or 'collection'");
  const addressId = body?.address_id == null ? null : asId(body.address_id);
  if (body?.address_id != null && addressId === null) return badRequest("address_id must be a positive integer");

  const result = await finishOfferCheckout({
    userId: auth.user.id,
    orderId,
    deliveryMethod: body.delivery_method,
    addressId,
  });
  if (!result.ok) {
    return Response.json({ error: result.message, reason: result.reason }, { status: statusForMarketplaceFailure(result.reason) });
  }
  return Response.json({ order_id: result.value.orderId });
}
