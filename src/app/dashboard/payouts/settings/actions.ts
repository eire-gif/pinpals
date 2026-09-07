"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getStripeClient } from "@/lib/stripe/client";
import type { StripeConnectedAccount } from "@/lib/types";

export type ManageOnStripeState = { error?: string };

const GENERIC_ERROR = "Couldn't reach Stripe just now — please try again in a moment.";

// This is the "seller settings page that links to supported Stripe
// account/bank management rather than collecting raw bank details in
// Pinpals" half of the seller-readiness task. A Stripe Express "login link"
// drops the member straight into Stripe's own hosted account management —
// where they can update their bank account, business/individual details,
// and anything else Stripe itself collects — without Pinpals ever
// rendering a form for any of it, same "Stripe's hosted UI, never a Pinpals
// form" rule startOrResumeOnboarding() (../actions.ts) already follows for
// onboarding itself.
//
// Deliberately resolves the account id from the signed-in member's *own*
// row (RLS-scoped, same as /dashboard/payouts) rather than accepting one as
// an argument — there is nothing here that needs validating against who's
// asking, since it can only ever act on the caller's own connected account.
export async function openStripeAccountManagement(
  _prev: ManageOnStripeState,
  _formData: FormData
): Promise<ManageOnStripeState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/dashboard/payouts/settings");

  const { data: account } = await supabase
    .from("stripe_connected_accounts")
    .select("stripe_account_id, details_submitted")
    .eq("user_id", user.id)
    .maybeSingle<Pick<StripeConnectedAccount, "stripe_account_id" | "details_submitted">>();

  if (!account) {
    return { error: "Set up payouts with Stripe first, then you'll be able to manage your account here." };
  }

  // Stripe rejects a login link for an Express account that hasn't finished
  // submitting onboarding yet — surfaced here as a friendly redirect back to
  // onboarding rather than a raw Stripe error, rather than letting the
  // generic catch below turn it into GENERIC_ERROR.
  if (!account.details_submitted) {
    redirect("/dashboard/payouts");
  }

  const stripe = getStripeClient();
  let loginLink;
  try {
    loginLink = await stripe.accounts.createLoginLink(account.stripe_account_id);
  } catch {
    return { error: GENERIC_ERROR };
  }

  redirect(loginLink.url);
}
