import Link from "next/link";
import { redirect } from "next/navigation";
import type Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripeClient } from "@/lib/stripe/client";
import ForgetParentToken from "./forget-token";

export const dynamic = "force-dynamic";

/**
 * /parent/card-done?session_id=… — back from Stripe after the parent's €0
 * card check (0159).
 *
 * Trusts nothing in the address but the session id, and that only to ask
 * Stripe: the session must be complete, its SetupIntent must have
 * succeeded, and its metadata must name the parent who is signed in here.
 * Then guardian_link_card_checked (service role only) approves the link,
 * and the card is detached from Stripe so PinPals keeps no card at all.
 * Reloading the page is harmless: the function returns true for an
 * already-approved link, and detaching an already-detached card is caught.
 */
export default async function CardDonePage({ searchParams }: { searchParams: Promise<{ session_id?: string }> }) {
  const { session_id: sessionId } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/parent");

  const result = await confirm(sessionId, user.id);

  return (
    <div className="max-w-xl mx-auto px-6 py-16">
      <ForgetParentToken />
      <div className="bg-surface rounded-2xl shadow-lg p-8 grid gap-4">
        {result.ok ? (
          <>
            <h1 className="font-display font-bold text-2xl">Thanks — that&rsquo;s everything</h1>
            <p className="text-ink-500">
              The card check worked, nothing was charged, and the card has been removed. Your child&rsquo;s
              account is approved: live scoring and sharing their rounds are switched on.
            </p>
          </>
        ) : (
          <>
            <h1 className="font-display font-bold text-2xl">The card check didn&rsquo;t finish</h1>
            <p className="text-ink-500">{result.message}</p>
          </>
        )}
        <Link href="/parent" className="justify-self-start px-5 py-2.5 rounded-full font-bold text-sm bg-green-700 text-cream-50 hover:bg-green-600 transition">
          Open your parent dashboard
        </Link>
      </div>
    </div>
  );
}

async function confirm(sessionId: string | undefined, userId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!sessionId || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
    return { ok: false, message: "This page needs the link Stripe sends you back with. Open the email about your child again to try once more." };
  }

  let stripe: Stripe;
  try {
    stripe = getStripeClient();
  } catch {
    return { ok: false, message: "Card checks aren't available just now. Please try again later." };
  }

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["setup_intent"] });
  } catch (e) {
    console.error("[parent] card-done: retrieve failed:", e instanceof Error ? e.message : e);
    return { ok: false, message: "We couldn't check that with Stripe. Please try again." };
  }

  const intent = typeof session.setup_intent === "object" ? session.setup_intent : null;
  const linkId = Number(session.metadata?.guardian_link_id);
  if (session.mode !== "setup" || session.metadata?.guardian_id !== userId || !Number.isInteger(linkId) || linkId < 1) {
    return { ok: false, message: "This card check belongs to a different account. Log in as the parent who approved and try again." };
  }
  if (session.status !== "complete" || intent?.status !== "succeeded") {
    return { ok: false, message: "The card wasn't confirmed. Open the email about your child again to try once more — nothing was charged." };
  }

  const { data: approved, error } = await createAdminClient().rpc("guardian_link_card_checked", { p_link_id: linkId, p_guardian: userId });

  // Remove the card whatever happened above: PinPals never keeps one.
  const pm = typeof intent.payment_method === "string" ? intent.payment_method : intent.payment_method?.id;
  if (pm) {
    try {
      await stripe.paymentMethods.detach(pm);
    } catch (e) {
      // Already detached on an earlier load of this page, or never attached.
      console.warn("[parent] card-done: detach:", e instanceof Error ? e.message : e);
    }
  }

  if (error || approved !== true) {
    if (error) console.error("[parent] guardian_link_card_checked failed:", error.message);
    return { ok: false, message: "We couldn't finish approving the account. The request may have been answered or withdrawn — check your parent dashboard." };
  }
  return { ok: true };
}
