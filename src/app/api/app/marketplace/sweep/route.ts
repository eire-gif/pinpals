import { authenticateAppRequest, unauthenticated } from "@/lib/app-api";
import { sweepMarketplace } from "@/lib/marketplace-operations";

/**
 * POST /api/app/marketplace/sweep
 *
 * Bring time-based marketplace state up to date before the app reads it:
 * expire stale offers, release lapsed checkout reservations, close ended
 * auctions. The website does this on every marketplace page load
 * (runOfferSweeps()); the app reads Postgres directly, so without this a
 * listing whose reservation lapsed would still say "reserved" until somebody
 * happened to open the website.
 *
 * Signed-in members only, so it cannot be hammered anonymously. Nothing in
 * it is load-bearing for correctness — every write re-checks expiry itself —
 * and a failure is logged and swallowed inside sweepMarketplace().
 */
export async function POST(request: Request) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();
  await sweepMarketplace();
  return Response.json({ ok: true });
}
