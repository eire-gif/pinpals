import { authenticateAppRequest, unauthenticated } from "@/lib/app-api";
import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { getConnectAccountBalance } from "@/lib/stripe/balance";
import type { StripeConnectedAccount } from "@/lib/types";

/**
 * GET /api/app/payouts/balance
 *
 * The seller's own available and pending Stripe balance, for the app's
 * Selling and Payouts screens.
 *
 * WHY THIS IS A ROUTE AND NOT A CLIENT READ. Everything else those two
 * screens show is a database row the member may read under RLS, and the app
 * reads those directly. A balance is not a row anywhere — it is a live call
 * to Stripe with the platform's secret key, and that key exists only on the
 * server. There is no version of this the app could do for itself.
 *
 * It is also the one number on those screens that must not be cached:
 * `stripe_connected_accounts` (0020) and `payouts` (0024) are mirrors
 * maintained by Stripe's own webhooks, but a balance is money in flux, and a
 * stored one is a number that is already wrong. The same reasoning is set
 * out at length in src/lib/stripe/balance.ts, which this calls unchanged.
 *
 * `null` rather than an error when Stripe cannot be reached. That is
 * deliberate and matches the website: getConnectAccountBalance() fails open
 * on any Stripe error, because this read never writes anything and never
 * gates an action. A seller whose balance box says "unavailable right now"
 * can still see every listing, order and payout on the screen around it.
 *
 * The rate limit is here because this is the only app endpoint that spends a
 * call to Stripe's API on every request, and a screen that refreshes on
 * focus is one bad loop away from doing that continuously.
 */

const BALANCE_MAX_REQUESTS = 60;
const BALANCE_WINDOW_SECONDS = 600;

export async function GET(request: Request) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const rateLimit = await checkRateLimit({
    action: "app-payout-balance",
    identifier: auth.user.id,
    maxHits: BALANCE_MAX_REQUESTS,
    windowSeconds: BALANCE_WINDOW_SECONDS,
  });
  if (!rateLimit.allowed) {
    return Response.json(
      { error: rateLimitMessage(rateLimit.retryAfterSeconds), reason: "rate_limited" },
      { status: 429 }
    );
  }

  // Under RLS, so this finds the caller's own connected account or nothing.
  // A seller who has never started onboarding has no row, which is not an
  // error — it is the answer, and the screen shows the setup prompt.
  const { data: account } = await auth.supabase
    .from("stripe_connected_accounts")
    .select("stripe_account_id")
    .eq("user_id", auth.user.id)
    .maybeSingle<Pick<StripeConnectedAccount, "stripe_account_id">>();

  if (!account) {
    return Response.json({ connected: false, balance: null }, { status: 200 });
  }

  const balance = await getConnectAccountBalance(account.stripe_account_id);

  return Response.json({ connected: true, balance }, { status: 200 });
}
