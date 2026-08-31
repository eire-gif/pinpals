"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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
  }

  revalidatePath(`/marketplace/${listingId}`);
  revalidatePath("/marketplace");
  return { error: undefined };
}
