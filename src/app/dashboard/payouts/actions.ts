"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripeClient } from "@/lib/stripe/client";
import { getSiteUrl } from "@/lib/site-url";
import type { StripeConnectedAccount } from "@/lib/types";

export type OnboardingState = { error?: string };

const GENERIC_ERROR = "Couldn't reach Stripe just now — please try again in a moment.";

/**
 * Starts Stripe Connect Express onboarding for the current member, or
 * resumes/restarts it if they already have a connected account. Either way
 * this ends by redirecting to a fresh Stripe Account Link — Stripe's own
 * hosted onboarding UI, never a Pinpals form, is what collects every detail
 * from here, including any bank account information. Pinpals never sees or
 * stores it.
 */
export async function startOrResumeOnboarding(
  _prev: OnboardingState,
  _formData: FormData
): Promise<OnboardingState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/dashboard/payouts");

  // Read via the regular authenticated client — RLS lets a member read
  // their own row (0020_stripe_connected_accounts.sql's "Members can view
  // their own connected account" policy) — no service-role client needed
  // just to check whether one already exists.
  const { data: existing } = await supabase
    .from("stripe_connected_accounts")
    .select("stripe_account_id")
    .eq("user_id", user.id)
    .maybeSingle<Pick<StripeConnectedAccount, "stripe_account_id">>();

  const stripe = getStripeClient();
  let stripeAccountId = existing?.stripe_account_id;

  if (!stripeAccountId) {
    let account;
    try {
      account = await stripe.accounts.create({
        type: "express",
        country: "IE",
        email: user.email,
        capabilities: { transfers: { requested: true } },
        // Safe, non-sensitive tag for cross-referencing this account back to
        // a Pinpals member in the Stripe dashboard — not shown anywhere in
        // the app itself.
        metadata: { pinpals_user_id: user.id },
      });
    } catch {
      return { error: GENERIC_ERROR };
    }
    stripeAccountId = account.id;

    // Insert via the service-role client — there is no authenticated insert
    // policy on this table (see the migration), even for the member
    // creating their own row; every write to it goes through this one
    // choke point, same discipline as orders.
    const admin = createAdminClient();
    const { error: insertError } = await admin.from("stripe_connected_accounts").insert({
      user_id: user.id,
      stripe_account_id: stripeAccountId,
    });

    if (insertError) {
      // 23505 = unique_violation. A concurrent double-submit already
      // created the row (unique(user_id)) — re-read rather than fail, so
      // the member still lands in onboarding instead of seeing an error for
      // something that actually succeeded.
      if (insertError.code === "23505") {
        const { data: raceWinner } = await admin
          .from("stripe_connected_accounts")
          .select("stripe_account_id")
          .eq("user_id", user.id)
          .maybeSingle<Pick<StripeConnectedAccount, "stripe_account_id">>();
        if (!raceWinner) return { error: GENERIC_ERROR };
        stripeAccountId = raceWinner.stripe_account_id;
      } else {
        return { error: GENERIC_ERROR };
      }
    }
  }

  const siteUrl = getSiteUrl();
  let accountLink;
  try {
    accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      // Stripe sends the member back here if the link expires or they need
      // to restart — the page itself offers "Resume setup" again from there.
      refresh_url: `${siteUrl}/dashboard/payouts`,
      // A GET route, not a page, so it can retrieve+sync before the member
      // sees their updated status — see that file for why.
      return_url: `${siteUrl}/dashboard/payouts/return`,
      type: "account_onboarding",
    });
  } catch {
    return { error: GENERIC_ERROR };
  }

  redirect(accountLink.url);
}
