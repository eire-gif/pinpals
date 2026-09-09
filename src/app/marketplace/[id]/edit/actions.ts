"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { listingImageStoragePath, deleteListingImage } from "@/lib/images/upload";
import { updateListingSchema, listingImagesSchema } from "@/lib/validation/listing";
import { eurToCents, MAX_LISTING_IMAGES, isAuctionSaleType } from "@/lib/marketplace";
import type { Listing, Auction, ListingImage } from "@/lib/types";

export type UpdateListingState = { error?: string; fieldErrors?: Record<string, string>; success?: boolean };

// Uploading/removing a not-yet-attached photo is handled by the same two
// actions the create form uses (src/app/marketplace/new/actions.ts) —
// edit-image-manager.tsx imports uploadListingImageAction/
// removeUploadedListingImageAction directly from there rather than through
// a re-export here. A "use server" file's exports are each traced as their
// own Server Action reference by Next's compiler, so re-exporting another
// file's action through this one is avoided rather than relied upon to work.

function readUpdateFields(formData: FormData) {
  // deliveryOptionsTouched is a hidden marker the edit form always submits
  // alongside its checkbox group (edit-listing-form.tsx) — without it,
  // unchecking every option would make formData.getAll("deliveryOptions")
  // come back empty exactly the same way "this field wasn't on the form at
  // all" would, and this function would then read that as "leave the
  // existing value alone" instead of "the seller wants zero options",
  // silently ignoring what should be a validation error
  // (listingDeliveryOptionsSchema requires at least one).
  const deliveryOptions = formData.has("deliveryOptionsTouched")
    ? formData.getAll("deliveryOptions").map(String)
    : undefined;

  return {
    title: formData.get("title") ? String(formData.get("title")) : undefined,
    description: formData.has("description") ? String(formData.get("description") || "") : undefined,
    category: formData.get("category") ? String(formData.get("category")) : undefined,
    subcategory: formData.has("subcategory") ? String(formData.get("subcategory") || "") : undefined,
    condition: formData.get("condition") ? String(formData.get("condition")) : undefined,
    county: formData.has("county") ? String(formData.get("county") || "") || undefined : undefined,
    deliveryOptions,
    collectionNotes: formData.has("collectionNotes") ? String(formData.get("collectionNotes") || "") : undefined,
    priceEur: formData.get("priceEur") || undefined,
    // Same "was the field on the form at all?" test as the fields above:
    // present-but-empty means "the seller cleared it" (a real edit), absent
    // means "leave it alone". The brand/spec inputs are rendered by
    // ItemDetailsFields whenever a category is chosen, so on this form they
    // are always present — but the distinction still matters for any other
    // caller, and getting it wrong would make a cleared brand un-clearable.
    brand: formData.has("brand") ? String(formData.get("brand") || "") || undefined : undefined,
    brandOther:
      formData.get("brand") === "other"
        ? String(formData.get("brandOther") || "").trim() || undefined
        : undefined,
    model: formData.has("model") ? String(formData.get("model") || "").trim() || undefined : undefined,
    dexterity: formData.has("dexterity") ? String(formData.get("dexterity") || "") || undefined : undefined,
    shaftFlex: formData.has("shaftFlex") ? String(formData.get("shaftFlex") || "") || undefined : undefined,
    shaftMaterial: formData.has("shaftMaterial")
      ? String(formData.get("shaftMaterial") || "") || undefined
      : undefined,
    loft: formData.has("loft") ? String(formData.get("loft") || "").trim() || undefined : undefined,
    itemSize: formData.has("itemSize") ? String(formData.get("itemSize") || "").trim() || undefined : undefined,
  };
}

/** Which of the brand/spec inputs this submission actually carried — the
 * `has()` half of the read above, kept separately because the patch below
 * needs "present but empty" (write null) to behave differently from
 * "absent" (don't touch the column), and an `undefined` value alone can't
 * tell those two apart. */
function submittedItemDetailFields(formData: FormData) {
  return {
    brand: formData.has("brand"),
    model: formData.has("model"),
    dexterity: formData.has("dexterity"),
    shaftFlex: formData.has("shaftFlex"),
    shaftMaterial: formData.has("shaftMaterial"),
    loft: formData.has("loft"),
    itemSize: formData.has("itemSize"),
  };
}

type PendingImage = { id?: number; url: string; position: number };

function readImages(formData: FormData): PendingImage[] | null {
  const raw = String(formData.get("images") || "[]");
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.map((item, index) => ({
      id: typeof item.id === "number" ? item.id : undefined,
      url: String(item.url),
      position: Number.isFinite(item.position) ? Number(item.position) : index,
    }));
  } catch {
    return null;
  }
}

/**
 * Updates an existing listing. Two separate write paths, matching where RLS
 * actually lets each table be touched from the authenticated side:
 *
 * - `listings` fields go through the ordinary request-scoped client — a
 *   seller already has an UPDATE policy on their own listings (0003).
 *   prevent_listing_edit_during_live_auction() (0046) is the backstop that
 *   rejects the core identity/price fields once the listing's auction has
 *   had a bid; that Postgres exception's message is surfaced directly, so
 *   the seller sees exactly why.
 * - `auctions` fields need the service-role client: 0039 revokes UPDATE on
 *   `auctions` from `authenticated` entirely (no seller-facing update path
 *   exists at the grant level, bid or no bid) — same shape as
 *   ../actions.ts's publishListing() using the admin client for the one
 *   `draft -> active` transition an ordinary seller has no RLS path to make
 *   themselves. This action re-verifies ownership AND that the auction is
 *   still `scheduled` itself before ever calling the admin client — the
 *   admin client bypasses RLS, so authorization here is this function's job
 *   alone, not something to lean on a policy for.
 */
export async function updateListing(
  listingId: number,
  _prev: UpdateListingState,
  formData: FormData
): Promise<UpdateListingState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: listing } = await supabase
    .from("listings")
    .select("id, seller_id, sale_type, status")
    .eq("id", listingId)
    .maybeSingle<Pick<Listing, "id" | "seller_id" | "sale_type" | "status">>();

  if (!listing || listing.seller_id !== user.id) {
    return { error: "That listing couldn't be found." };
  }

  const images = readImages(formData);
  if (images === null) {
    return { error: "Something went wrong with your photos — please try again." };
  }
  const imagesCheck = listingImagesSchema.safeParse(images);
  if (!imagesCheck.success) {
    return { error: imagesCheck.error.issues[0]?.message || `A listing may have at most ${MAX_LISTING_IMAGES} photos.` };
  }

  const parsed = updateListingSchema.safeParse(readUpdateFields(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !(key in fieldErrors)) {
        fieldErrors[key] = issue.message;
      }
    }
    return { error: parsed.error.issues[0]?.message || "Please check the form for errors.", fieldErrors };
  }
  const data = parsed.data;
  const isAuction = isAuctionSaleType(listing.sale_type);

  // ---- listings table patch ----
  const listingPatch: Record<string, unknown> = {};
  if (data.title !== undefined) listingPatch.title = data.title;
  if (data.description !== undefined) listingPatch.description = data.description || null;
  if (data.category !== undefined) listingPatch.category = data.category;
  if (data.subcategory !== undefined) listingPatch.subcategory = data.subcategory || null;
  if (data.condition !== undefined) listingPatch.condition = data.condition;
  if (data.county !== undefined) listingPatch.county = data.county || null;

  // Brand + specs. brand and brand_other are written together, always: they
  // are one answer to one question, and writing brand without clearing a
  // stale brand_other would trip listings_brand_other_requires_other_check
  // (0060) on an otherwise valid edit.
  const submitted = submittedItemDetailFields(formData);
  if (submitted.brand) {
    listingPatch.brand = data.brand || null;
    listingPatch.brand_other = data.brand === "other" ? data.brandOther || null : null;
  }
  if (submitted.model) listingPatch.model = data.model || null;
  if (submitted.dexterity) listingPatch.dexterity = data.dexterity || null;
  if (submitted.shaftFlex) listingPatch.shaft_flex = data.shaftFlex || null;
  if (submitted.shaftMaterial) listingPatch.shaft_material = data.shaftMaterial || null;
  if (submitted.loft) listingPatch.loft = data.loft || null;
  if (submitted.itemSize) listingPatch.item_size = data.itemSize || null;
  if (data.deliveryOptions !== undefined) listingPatch.delivery_options = data.deliveryOptions;
  if (data.collectionNotes !== undefined) listingPatch.collection_notes = data.collectionNotes || null;
  // price only applies to non-auction listings — sale_type itself isn't
  // editable from this form (see edit-listing-form.tsx's comment), so an
  // auction listing never has a priceEur field submitted in the first place.
  if (!isAuction && data.priceEur !== undefined) {
    listingPatch.price_eur = data.priceEur;
    listingPatch.price_cents = eurToCents(data.priceEur);
  }

  if (Object.keys(listingPatch).length > 0) {
    const { error } = await supabase
      .from("listings")
      .update(listingPatch)
      .eq("id", listingId)
      .eq("seller_id", user.id);

    if (error) {
      // prevent_listing_edit_during_live_auction() (0046) raises with a
      // specific, already-seller-facing message when it fires — shown
      // as-is rather than a generic "couldn't save" fallback.
      return { error: error.message };
    }
  }

  // ---- auctions table patch (auction-type listings only) ----
  if (isAuction) {
    const { data: auction } = await supabase
      .from("auctions")
      .select("id, status")
      .eq("listing_id", listingId)
      .maybeSingle<Pick<Auction, "id" | "status">>();

    const startingPriceEurRaw = formData.get("startingPriceEur");
    const reservePriceEurRaw = formData.get("reservePriceEur");
    const buyNowPriceEurRaw = formData.get("buyNowPriceEur");
    const minIncrementEurRaw = formData.get("minIncrementEur");
    const startsAtRaw = formData.get("startsAt");
    const endsAtRaw = formData.get("endsAt");
    const touchedAuctionFields =
      startingPriceEurRaw || reservePriceEurRaw || buyNowPriceEurRaw || minIncrementEurRaw || startsAtRaw || endsAtRaw;

    if (auction && touchedAuctionFields) {
      if (auction.status !== "scheduled") {
        return {
          error: "This auction has already received a bid — its price and timing can no longer be changed.",
        };
      }

      const auctionPatch: Record<string, unknown> = {};
      if (startingPriceEurRaw) auctionPatch.starting_price_cents = eurToCents(Number(startingPriceEurRaw));
      if (minIncrementEurRaw) auctionPatch.min_increment_cents = eurToCents(Number(minIncrementEurRaw));
      auctionPatch.reserve_price_cents = reservePriceEurRaw ? eurToCents(Number(reservePriceEurRaw)) : null;
      if (listing.sale_type === "auction_with_buy_now") {
        auctionPatch.buy_now_price_cents = buyNowPriceEurRaw ? eurToCents(Number(buyNowPriceEurRaw)) : null;
      }
      if (startsAtRaw) auctionPatch.starts_at = new Date(String(startsAtRaw)).toISOString();
      if (endsAtRaw) auctionPatch.ends_at = new Date(String(endsAtRaw)).toISOString();

      const admin = createAdminClient();
      const { error } = await admin.from("auctions").update(auctionPatch).eq("id", auction.id);
      if (error) {
        return { error: error.message };
      }
    }
  }

  // ---- images: existing gallery -> submitted final state ----
  const { data: existingImages } = await supabase
    .from("listing_images")
    .select("id, image_url, position")
    .eq("listing_id", listingId)
    .returns<Pick<ListingImage, "id" | "image_url" | "position">[]>();

  const submittedIds = new Set(images.map((img) => img.id).filter((id): id is number => id !== undefined));
  const toDelete = (existingImages ?? []).filter((img) => !submittedIds.has(img.id));
  const toInsert = images.filter((img) => img.id === undefined);
  const toReposition = images.filter((img): img is PendingImage & { id: number } => img.id !== undefined);

  if (toDelete.length > 0) {
    await supabase
      .from("listing_images")
      .delete()
      .in("id", toDelete.map((img) => img.id));
    // Best-effort Storage cleanup — see deleteListingImage()'s own comment.
    for (const img of toDelete) {
      const path = listingImageStoragePath(img.image_url);
      if (path) await deleteListingImage(supabase, path);
    }
  }

  for (const img of toReposition) {
    const existing = existingImages?.find((e) => e.id === img.id);
    if (existing && existing.position !== img.position) {
      await supabase.from("listing_images").update({ position: img.position }).eq("id", img.id);
    }
  }

  if (toInsert.length > 0) {
    const { error: insertImagesError } = await supabase.from("listing_images").insert(
      toInsert.map((img) => ({ listing_id: listingId, image_url: img.url, position: img.position }))
    );
    if (insertImagesError) {
      return { error: insertImagesError.message };
    }
  }

  // Keep the legacy single-cover-image column (0003) in sync with the
  // gallery's new position-0 photo, same reasoning as createListing()'s own
  // image_url handling.
  const coverUrl = images.find((img) => img.position === 0)?.url ?? images[0]?.url ?? null;
  await supabase.from("listings").update({ image_url: coverUrl }).eq("id", listingId);

  revalidatePath(`/marketplace/${listingId}`);
  revalidatePath(`/marketplace/${listingId}/edit`);
  revalidatePath("/marketplace");
  return { success: true };
}
