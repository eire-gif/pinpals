"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CATEGORIES, CONDITIONS } from "@/lib/marketplace";

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

  const { error } = await supabase.from("listings").insert({
    seller_id: user.id,
    title,
    description: description || null,
    price_eur: price,
    category,
    condition,
    county: county || null,
    image_url: imageUrl,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/marketplace");
  redirect("/marketplace?listed=1");
}
