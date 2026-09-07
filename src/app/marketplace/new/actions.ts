"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CATEGORIES, CONDITIONS } from "@/lib/marketplace";
import { sellerOnboardingStatus, isSellerPaymentReady } from "@/lib/stripe/connect";
import type { StripeConnectedAccount } from "@/lib/types";

export type ListingFormState = { error?: string };

export async function createListing(
  _prev: ListingFormState,
  formData: FormData
): Promise<ListingFormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const title = String(formData.get("title") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const priceRaw = String(formData.get("price") || "").trim();
  const category = String(formData.get("category") || "").trim();
  const condition = String(formData.get("condition") || "").trim();
  const county = String(formData.get("county") || "").trim();
  const photo = formData.get("photo");

  if (!title) {
    return { error: "Give your listing a title." };
  }
  if (!CATEGORIES.includes(category as (typeof CATEGORIES)[number])) {
    return { error: "Please choose a category." };
  }
  if (!CONDITIONS.includes(condition as (typeof CONDITIONS)[number])) {
    return { error: "Please choose a condition." };
  }

  const price = Number(priceRaw);
  if (!priceRaw || Number.isNaN(price) || price < 0) {
    return { error: "Enter a valid price in euro." };
  }

  let imageUrl: string | null = null;

  if (photo instanceof File && photo.size > 0) {
    if (photo.size > 5 * 1024 * 1024) {
      return { error: "Photo must be under 5MB." };
    }
    const ext = photo.name.split(".").pop() || "jpg";
    const path = `${user.id}/${crypto.randomUUID()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("listing-images")
      .upload(path, photo, { contentType: photo.type || "image/jpeg" });

    if (uploadError) {
      return { error: `Couldn't upload photo: ${uploadError.message}` };
    }

    const { data: publicUrlData } = supabase.storage
      .from("listing-images")
      .getPublicUrl(path);
    imageUrl = publicUrlData.publicUrl;
  }

  // Payment-readiness gate: a listing only goes straight to `active` (live,
  // publicly visible — see public.listing_is_visible() in
  // 0045_marketplace_rls_hardening.sql) when the seller can actually be paid
  // out for a resulting sale. Otherwise it's saved as `draft` — still
  // visible to the seller themselves (listing_is_visible()'s `seller_id =
  // auth.uid()` branch), just not to buyers — and the listing's own page
  // offers a "Publish" action (../[id]/actions.ts's publishListing()) once
  // setup is finished, so nothing typed here is lost.
  const { data: account } = await supabase
    .from("stripe_connected_accounts")
    .select("charges_enabled, payouts_enabled, details_submitted, requirements_currently_due, requirements_past_due, disabled_reason")
    .eq("user_id", user.id)
    .maybeSingle<
      Pick<
        StripeConnectedAccount,
        | "charges_enabled"
        | "payouts_enabled"
        | "details_submitted"
        | "requirements_currently_due"
        | "requirements_past_due"
        | "disabled_reason"
      >
    >();
  const paymentReady = isSellerPaymentReady(sellerOnboardingStatus(account));

  const { data: inserted, error } = await supabase
    .from("listings")
    .insert({
      seller_id: user.id,
      title,
      description: description || null,
      price_eur: price,
      category,
      condition,
      county: county || null,
      image_url: imageUrl,
      status: paymentReady ? "active" : "draft",
    })
    .select("id")
    .single<{ id: number }>();

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/marketplace");

  if (paymentReady) {
    redirect("/marketplace?listed=1");
  }

  // Saved, not published — send the seller to the listing's own page, where
  // it shows as a draft with a "Publish" action they can use once seller
  // setup is finished.
  redirect(`/marketplace/${inserted.id}?draft=1`);
}
