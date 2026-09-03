import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripeClient } from "@/lib/stripe/client";
import { syncConnectedAccountFromStripe } from "@/lib/stripe/connect";
import type { StripeConnectedAccount } from "@/lib/types";

// Stripe's Account Link return_url (src/app/dashboard/payouts/actions.ts) —
// where the member lands right after finishing (or leaving) Stripe's hosted
// onboarding flow. This is the "safe server-side retrieval" half of the
// task's sync requirement: the account.updated webhook (src/app/api/
// webhooks/stripe/route.ts) covers ongoing changes, but webhook delivery
// isn't instant, so without this a member could land back on
// /dashboard/payouts and see a stale "not started" status right after
// actually finishing setup. A direct stripe.accounts.retrieve() here closes
// that gap immediately.
//
// Deliberately resolves the account id from the signed-in member's *own*
// row (RLS-scoped, same as the payouts page) rather than trusting a query
// param — Stripe's return_url doesn't carry the account id anyway, and this
// way there's nothing here that needs validating against who's asking.
export async function GET(request: NextRequest) {
  const { origin } = new URL(request.url);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(`${origin}/login?next=/dashboard/payouts`);
  }

  const { data: existing } = await supabase
    .from("stripe_connected_accounts")
    .select("stripe_account_id")
    .eq("user_id", user.id)
    .maybeSingle<Pick<StripeConnectedAccount, "stripe_account_id">>();

  if (existing?.stripe_account_id) {
    try {
      const stripe = getStripeClient();
      const account = await stripe.accounts.retrieve(existing.stripe_account_id);
      await syncConnectedAccountFromStripe(account);
    } catch {
      // Swallow and fall through — worst case the member sees whatever
      // status was last synced (by the webhook, or an earlier visit here)
      // rather than the very latest. The webhook will catch up regardless.
    }
  }

  return NextResponse.redirect(`${origin}/dashboard/payouts`);
}
