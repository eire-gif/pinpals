"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { uploadListingImage, deleteListingImage, ImageProcessingError } from "@/lib/images/upload";
import { createListingSchema } from "@/lib/validation/listing";
import { eurToCents, MAX_LISTING_IMAGES } from "@/lib/marketplace";

// ============ per-image actions ============
// Photos are uploaded (and can be individually removed/retried) BEFORE the
// listing itself exists — new-listing-form.tsx uploads each selected file
// immediately via uploadListingImageAction, tracks {url, path} + status per
// file client-side, and only bundles the already-uploaded URLs into
// createListing's own submission at the end. This is what makes "upload
// failure, partial retry" a natural client state instead of something
// bolted on: a failed file just never got a {url, path}, and retrying it is
// exactly the same call again, with no other field touched.

export type UploadImageResult = { url: string; path: string } | { error: string };

export async function uploadListingImageAction(formData: FormData): Promise<UploadImageResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "You need to be signed in to upload photos." };
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { error: "No file received." };
  }

  try {
    const { url, path } = await uploadListingImage(supabase, user.id, file);
    return { url, path };
  } catch (err) {
    if (err instanceof ImageProcessingError) {
      return { error: err.message };
    }
    return { error: "Couldn't upload that photo — please try again." };
  }
}

/** Deletes an already-uploaded (but not yet attached to a saved listing)
 * photo from Storage — used when the seller removes a photo from the
 * in-progress draft before ever hitting "Save as draft". `path` has to
 * start with the caller's own user id segment, the same thing Storage's own
 * RLS policy (0003_marketplace.sql) would check — checked again here since
 * this action's whole point is letting the client tell it which object to
 * delete, and a client-supplied path is exactly the kind of input that
 * needs re-verifying server-side rather than trusted at face value. */
export async function removeUploadedListingImageAction(path: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "You need to be signed in to remove photos." };
  }
  if (!path.startsWith(`${user.id}/`)) {
    return { error: "That photo doesn't belong to you." };
  }

  await deleteListingImage(supabase, path);
  return {};
}

// ============ create listing ============

export type ListingFormState = { error?: string; fieldErrors?: Record<string, string> };

/** Everything but the images: FormData -> the shape createListingSchema
 * expects. Kept separate from the schema call itself so a malformed
 * `images` JSON blob can be reported as its own error rather than getting
 * mixed into the same zod issue list as an ordinary field. */
/** Empty-string -> undefined, so an optional select the seller never
 * touched reads as "not provided" rather than failing its enum. Every brand
 * and spec field is optional (see the header comment on the brand block in
 * src/lib/validation/listing.ts), so this is the shape they all want. */
function optionalField(formData: FormData, name: string): string | undefined {
  return String(formData.get(name) || "").trim() || undefined;
}

function readListingFields(formData: FormData) {
  const deliveryOptions = formData.getAll("deliveryOptions").map(String);

  return {
    title: String(formData.get("title") || ""),
    brand: optionalField(formData, "brand"),
    // Only meaningful behind brand='other' — dropped otherwise so a seller
    // who typed a name, then changed the brand select back to a real brand,
    // doesn't trip listings_brand_other_requires_other_check with a value
    // the form no longer shows them.
    brandOther: formData.get("brand") === "other" ? optionalField(formData, "brandOther") : undefined,
    model: optionalField(formData, "model"),
    dexterity: optionalField(formData, "dexterity"),
    shaftFlex: optionalField(formData, "shaftFlex"),
    shaftMaterial: optionalField(formData, "shaftMaterial"),
    loft: optionalField(formData, "loft"),
    itemSize: optionalField(formData, "itemSize"),
    description: String(formData.get("description") || ""),
    category: String(formData.get("category") || ""),
    subcategory: String(formData.get("subcategory") || ""),
    condition: String(formData.get("condition") || ""),
    county: String(formData.get("county") || "") || undefined,
    deliveryOptions,
    collectionNotes: String(formData.get("collectionNotes") || ""),
    saleType: String(formData.get("saleType") || ""),
    priceEur: formData.get("priceEur") || undefined,
    startingPriceEur: formData.get("startingPriceEur") || undefined,
    reservePriceEur: formData.get("reservePriceEur") || undefined,
    buyNowPriceEur: formData.get("buyNowPriceEur") || undefined,
    minIncrementEur: formData.get("minIncrementEur") || undefined,
    startsAt: formData.get("startsAt") || undefined,
    endsAt: formData.get("endsAt") || undefined,
  };
}

type PendingImage = { url: string; position: number };

function readImages(formData: FormData): PendingImage[] | null {
  const raw = String(formData.get("images") || "[]");
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.map((item, index) => ({
      url: String(item.url),
      position: Number.isFinite(item.position) ? Number(item.position) : index,
    }));
  } catch {
    return null;
  }
}

/**
 * Always saves as a `draft` (see supabase/migrations/0045_marketplace_rls_hardening.sql's
 * validate_listing_status_transition() — an ordinary seller can never write
 * `active` directly anyway) — publishing is exclusively
 * ../[id]/actions.ts's publishListing(), which re-checks payment readiness
 * itself. Earlier phases had this action conditionally insert as `active`
 * when the seller was already payment-ready; that's removed here in favour
 * of one single "how does a listing go live" path (preview, confirm,
 * publish — task after this one), which also makes this action's own job
 * simpler: validate, insert, done.
 */
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

  const images = readImages(formData);
  if (images === null) {
    return { error: "Something went wrong with your photos — please re-add them and try again." };
  }
  if (images.length > MAX_LISTING_IMAGES) {
    return { error: `A listing may have at most ${MAX_LISTING_IMAGES} photos.` };
  }

  const parsed = createListingSchema.safeParse(readListingFields(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !(key in fieldErrors)) {
        fieldErrors[key] = issue.message;
      }
    }
    return {
      error: parsed.error.issues[0]?.message || "Please check the form for errors.",
      fieldErrors,
    };
  }

  const data = parsed.data;

  // Switching on the literal discriminant (rather than calling
  // isAuctionSaleType(data.saleType), which returns a plain boolean
  // TypeScript can't use to narrow a discriminated union) is what lets
  // `data.priceEur` / `data.startingPriceEur` etc. below resolve to the
  // right branch's fields without a cast.
  let priceEur: number | null;
  let auctionDetails: {
    startingPriceEur: number;
    reservePriceEur: number | undefined;
    buyNowPriceEur: number | null;
    minIncrementEur: number;
    startsAt: Date;
    endsAt: Date;
  } | null;

  switch (data.saleType) {
    case "fixed_price":
    case "offers_allowed":
      priceEur = data.priceEur;
      auctionDetails = null;
      break;
    case "auction":
      priceEur = null;
      auctionDetails = {
        startingPriceEur: data.startingPriceEur,
        reservePriceEur: data.reservePriceEur,
        buyNowPriceEur: null,
        minIncrementEur: data.minIncrementEur,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
      };
      break;
    case "auction_with_buy_now":
      priceEur = null;
      auctionDetails = {
        startingPriceEur: data.startingPriceEur,
        reservePriceEur: data.reservePriceEur,
        buyNowPriceEur: data.buyNowPriceEur,
        minIncrementEur: data.minIncrementEur,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
      };
      break;
  }

  const { data: inserted, error: insertError } = await supabase
    .from("listings")
    .insert({
      seller_id: user.id,
      title: data.title,
      description: data.description || null,
      category: data.category,
      subcategory: data.subcategory || null,
      condition: data.condition,
      county: data.county || null,
      // image_url (0003) is the legacy single-cover-image column every
      // existing read site (listing-card.tsx, the marketplace grid, ...)
      // still relies on — kept in sync with the new gallery's cover photo
      // (position 0) rather than left null, so nothing downstream needs to
      // change to keep working for a listing created by this new flow.
      image_url: images.find((img) => img.position === 0)?.url ?? images[0]?.url ?? null,
      status: "draft",
      sale_type: data.saleType,
      price_eur: priceEur,
      price_cents: priceEur !== null ? eurToCents(priceEur) : null,
      delivery_options: data.deliveryOptions,
      collection_notes: data.collectionNotes || null,
      brand: data.brand || null,
      brand_other: data.brand === "other" ? data.brandOther || null : null,
      model: data.model || null,
      dexterity: data.dexterity || null,
      shaft_flex: data.shaftFlex || null,
      shaft_material: data.shaftMaterial || null,
      loft: data.loft || null,
      item_size: data.itemSize || null,
    })
    .select("id")
    .single<{ id: number }>();

  if (insertError || !inserted) {
    return { error: insertError?.message || "Couldn't save that listing — please try again." };
  }

  if (auctionDetails) {
    const { error: auctionError } = await supabase.from("auctions").insert({
      listing_id: inserted.id,
      starting_price_cents: eurToCents(auctionDetails.startingPriceEur),
      reserve_price_cents:
        auctionDetails.reservePriceEur !== undefined ? eurToCents(auctionDetails.reservePriceEur) : null,
      buy_now_price_cents:
        auctionDetails.buyNowPriceEur !== null ? eurToCents(auctionDetails.buyNowPriceEur) : null,
      min_increment_cents: eurToCents(auctionDetails.minIncrementEur),
      starts_at: auctionDetails.startsAt.toISOString(),
      ends_at: auctionDetails.endsAt.toISOString(),
    });

    if (auctionError) {
      // The listing row itself saved fine — a seller can fix the auction
      // details from the edit page rather than losing the whole draft, same
      // "don't throw away otherwise-good work over one failed sub-step"
      // principle as respondToOffer()'s non-blocking order-insert
      // (../[id]/actions.ts). Reported honestly, not swallowed.
      revalidatePath("/marketplace");
      redirect(`/marketplace/${inserted.id}?draft=1&auctionError=1`);
    }
  }

  if (images.length > 0) {
    const { error: imagesError } = await supabase.from("listing_images").insert(
      images.map((img) => ({
        listing_id: inserted.id,
        image_url: img.url,
        position: img.position,
      }))
    );
    // Same reasoning as the auction-insert failure above: the listing
    // itself is saved, photos can be re-added from the edit page.
    if (imagesError) {
      console.error(`Failed to attach images to listing ${inserted.id}:`, imagesError.message);
    }
  }

  revalidatePath("/marketplace");

  // Saved, not published — the listing's own page shows it as a draft with
  // a "Publish" action (see ../[id]/page.tsx / publish-listing-button.tsx).
  redirect(`/marketplace/${inserted.id}?draft=1`);
}
