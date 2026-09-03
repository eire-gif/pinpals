"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeOfferTotal } from "@/lib/marketplace";
import type { Listing, Offer } from "@/lib/types";

export type OfferFormState = { error?: string; success?: boolean };

export async function makeOffer(
  listingId: number,
  _prev: OfferFormState,
  formData: FormData
): Promise<OfferFormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const amount = Number(formData.get("amount"));
  if (!amount || Number.isNaN(amount) || amount <= 0) {
    return { error: "Enter a valid offer amount in euro." };
  }

  const { error } = await supabase.from("offers").insert({
    listing_id: listingId,
    buyer_id: user.id,
    amount_eur: amount,
  });

  if (error) {
    return { error: "Couldn't send that offer — the listing may no longer be available." };
  }

  revalidatePath(`/marketplace/${listingId}`);
  return { success: true };
}

export async function respondToOffer(
  offerId: number,
  listingId: number,
  accept: boolean
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Fetched up front (RLS-bound, same client the update below uses) so an
  // accept can snapshot this exact listing/offer state into an order row —
  // see the comment on the order-creation block below for why this can't
  // just re-read from `listings` after the fact.
  const [{ data: offerBefore }, { data: listingBefore }] = await Promise.all([
    supabase.from("offers").select("*").eq("id", offerId).maybeSingle<Offer>(),
    supabase.from("listings").select("*").eq("id", listingId).maybeSingle<Listing>(),
  ]);

  const { error } = await supabase
    .from("offers")
    .update({ status: accept ? "accepted" : "declined" })
    .eq("id", offerId);

  if (error) {
    return { error: error.message };
  }

  // Accepting one offer takes the listing off the market and closes out
  // every other pending offer on it, so a seller can't double-sell.
  if (accept) {
    await supabase.from("listings").update({ status: "reserved" }).eq("id", listingId);
    await supabase
      .from("offers")
      .update({ status: "declined" })
      .eq("listing_id", listingId)
      .eq("status", "pending")
      .neq("id", offerId);

    // Build the marketplace order model's one write path: a durable,
    // snapshotted record of this transaction (see
    // supabase/migrations/0019_orders.sql). `orders` has no authenticated
    // insert policy at all — this goes through the service-role client, the
    // same escape hatch src/lib/admin/audit.ts's recordAdminAction() uses
    // for privileged writes — so, unlike the RLS-protected updates above,
    // authorization here has to be re-checked explicitly rather than
    // inherited from a policy. The offers RLS policy that let the update
    // above succeed already implies the caller is this listing's seller
    // (only a listing's own seller can update its offers' status), but this
    // re-verifies it directly against the listing row itself before writing
    // a financial record — "authorization as a server-side security
    // boundary, not a UI condition" holds even for a check that looks
    // redundant. offerBefore/listingBefore (fetched before either update
    // ran) are what get snapshotted, not a re-read after the fact, so the
    // order reflects the state that was actually accepted.
    if (offerBefore && listingBefore && listingBefore.seller_id === user.id) {
      const { amount, fee, total } = computeOfferTotal(offerBefore.amount_eur);
      const admin = createAdminClient();
      const { error: orderError } = await admin.from("orders").insert({
        listing_id: listingBefore.id,
        offer_id: offerBefore.id,
        buyer_id: offerBefore.buyer_id,
        seller_id: listingBefore.seller_id,
        listing_title: listingBefore.title,
        listing_category: listingBefore.category,
        listing_condition: listingBefore.condition,
        listing_image_url: listingBefore.image_url,
        amount_eur: amount,
        platform_fee_eur: fee,
        total_eur: total,
      });
      // Non-blocking by design: a failed order write (including the
      // expected case of `offer_id`'s unique constraint rejecting a repeat
      // accept on an already-ordered offer) must never surface as a broken
      // "accept offer" experience for the buyer/seller — the offer/listing
      // updates above already succeeded and are the behavior this phase's
      // general rules require to be preserved unchanged. Logged server-side
      // only.
      if (orderError) {
        console.error(`Failed to create order for accepted offer ${offerBefore.id}:`, orderError.message);
      }
    }
  }

  revalidatePath(`/marketplace/${listingId}`);
  revalidatePath("/marketplace");
  return { error: undefined };
}
