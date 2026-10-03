import { asId, authenticateAppRequest, badRequest, readJson, unauthenticated } from "@/lib/app-api";
import { buyNow, isDeliveryMethod, statusForMarketplaceFailure } from "@/lib/marketplace-operations";

/**
 * POST /api/app/listings/[id]/buy   { delivery_method, address_id }
 *
 * Buy now: reserve the listing and create the order, which then waits for
 * payment for its checkout window. create_purchase_order() (0050) re-derives
 * the price and fee itself; the delivery method and address are only the
 * buyer's choice. Same buyNow() as the website's checkout page.
 *
 * Returns the order id. Paying happens on the order (Stripe), separately.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const listingId = asId((await params).id);
  if (listingId === null) return badRequest("id must be a positive integer");

  const body = await readJson<{ delivery_method?: unknown; address_id?: unknown }>(request);
  if (!isDeliveryMethod(body?.delivery_method)) return badRequest("delivery_method must be 'post' or 'collection'");
  const addressId = body?.address_id == null ? null : asId(body.address_id);
  if (body?.address_id != null && addressId === null) return badRequest("address_id must be a positive integer");

  const result = await buyNow({
    userId: auth.user.id,
    listingId,
    deliveryMethod: body.delivery_method,
    addressId,
  });
  if (!result.ok) {
    return Response.json({ error: result.message, reason: result.reason }, { status: statusForMarketplaceFailure(result.reason) });
  }
  return Response.json({ order_id: result.value.orderId }, { status: 201 });
}
