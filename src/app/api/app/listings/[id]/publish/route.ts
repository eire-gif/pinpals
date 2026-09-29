import { asId, authenticateAppRequest, badRequest, unauthenticated } from "@/lib/app-api";
import { publishListingFor } from "@/lib/listing-operations";

/**
 * POST /api/app/listings/[id]/publish
 *
 * Put one of your own draft listings on sale.
 *
 * WHY THIS IS A ROUTE. `validate_listing_status_transition()` (0045) does not
 * let a member move a listing from `draft` to `active` — only staff or the
 * service role can, because going on sale is the moment a listing becomes
 * something another member can pay for. And a listing may only go on sale if
 * Stripe says the seller can actually be paid, which is a TypeScript reading
 * of Stripe's account flags that no policy could enforce.
 *
 * Both checks, and the privileged write, live in
 * src/lib/listing-operations.ts, shared with the website's Server Action.
 *
 * Every other status a seller can set — sold, removed, relisted — the trigger
 * already allows them, so the app does those directly against the table. This
 * is the one that cannot work that way.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const listingId = asId((await params).id);
  if (listingId === null) return badRequest("id must be a positive integer");

  const result = await publishListingFor(auth.supabase, auth.user.id, listingId);

  // 422 rather than 400: the request was well formed, a rule declined it, and
  // the message is written to be read by the seller as-is.
  if (!result.ok) {
    return Response.json({ error: result.message }, { status: 422 });
  }

  return Response.json({ ok: true, status: "active" });
}
