import { asId, authenticateAppRequest, badRequest, readJson, unauthenticated } from "@/lib/app-api";
import { placeBid, statusForMarketplaceFailure } from "@/lib/marketplace-operations";

/**
 * POST /api/app/listings/[id]/bids   { amount_eur }
 *
 * Bid on an auction. The auction is read from the listing (one per
 * listing, 0039); validate_bid() (0046) decides whether the bid stands at
 * the moment it lands. Same placeBid() as the website's bid form.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const listingId = asId((await params).id);
  if (listingId === null) return badRequest("id must be a positive integer");

  const body = await readJson<{ amount_eur?: unknown }>(request);
  const amountEur = typeof body?.amount_eur === "number" ? body.amount_eur : NaN;

  const result = await placeBid({ supabase: auth.supabase, userId: auth.user.id, listingId, amountEur });
  if (!result.ok) {
    return Response.json({ error: result.message, reason: result.reason }, { status: statusForMarketplaceFailure(result.reason) });
  }
  return Response.json({ ok: true }, { status: 201 });
}
