import { asId, authenticateAppRequest, badRequest, readJson, unauthenticated } from "@/lib/app-api";
import { makeOffer, statusForMarketplaceFailure } from "@/lib/marketplace-operations";

/**
 * POST /api/app/listings/[id]/offers   { amount_eur }
 *
 * Make an offer on a listing. The same makeOffer() the website's offer form
 * calls (src/lib/marketplace-operations.ts): rate limit, sweep, then a plain
 * insert that prepare_and_validate_offer() (0048) polices. The seller's
 * notification is fired by the database trigger (0056), not here.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const listingId = asId((await params).id);
  if (listingId === null) return badRequest("id must be a positive integer");

  const body = await readJson<{ amount_eur?: unknown }>(request);
  const amountEur = typeof body?.amount_eur === "number" ? body.amount_eur : NaN;

  const result = await makeOffer({ supabase: auth.supabase, userId: auth.user.id, listingId, amountEur });
  if (!result.ok) {
    return Response.json({ error: result.message, reason: result.reason }, { status: statusForMarketplaceFailure(result.reason) });
  }
  return Response.json({ ok: true }, { status: 201 });
}
