import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { countryForRegion } from "@/lib/regions";
import { eurToCents } from "@/lib/marketplace";
import type { createListingSchema } from "@/lib/validation/listing";
import type { z } from "zod";

/**
 * Writing a listing, once and for both callers.
 *
 * This was the second half of createListing() in
 * src/app/marketplace/new/actions.ts. It moved so the website's form and the
 * app's /api/app/listings route insert rows the same way, the way
 * sendMessageTo() and createInvite() are shared by their own two callers.
 *
 * The split is at validation: the caller parses with createListingSchema and
 * hands the parsed result here. That keeps each caller free to report a
 * validation failure in its own shape — a field-error map for a form, a 422
 * for a route — while leaving exactly one place that knows how a listing
 * becomes rows in `listings`, `auctions` and `listing_images`.
 *
 * Always a draft. validate_listing_status_transition() (0045) will not let an
 * ordinary seller write `active` anyway, and publishing re-checks payment
 * readiness in publishListing(). Neither caller may shortcut that.
 */

export type CreateListingInput = z.infer<typeof createListingSchema>;

export type ListingImageInput = { url: string; position: number };

export type CreateListingResult =
  | {
      ok: true;
      listingId: number;
      /**
       * The listing saved but its auction row did not. Surfaced rather than
       * swallowed: the seller can fix the dates from the edit page, and
       * throwing away an otherwise-good draft over one failed sub-step would
       * be worse. Same call as respondToOffer()'s non-blocking order insert.
       */
      auctionFailed: boolean;
      /** Same again for the photos, which are re-addable from the edit page. */
      imagesFailed: boolean;
    }
  | { ok: false; message: string };

export async function createListingRecord(params: {
  supabase: SupabaseClient;
  userId: string;
  data: CreateListingInput;
  images: ListingImageInput[];
}): Promise<CreateListingResult> {
  const { supabase, userId, data, images } = params;

  // Switching on the literal discriminant (rather than calling
  // isAuctionSaleType(data.saleType), which returns a plain boolean
  // TypeScript can't narrow with) is what lets `data.priceEur` /
  // `data.startingPriceEur` below resolve to the right branch's fields
  // without a cast.
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
      seller_id: userId,
      title: data.title,
      description: data.description || null,
      category: data.category,
      subcategory: data.subcategory || null,
      condition: data.condition,
      county: data.county || null,
      // Derived, never asked for: region names are unique across the five
      // countries, so the county the seller picked already says which one
      // they're in (see listingCountySchema).
      country: data.county ? countryForRegion(data.county) : null,
      // image_url (0003) is the legacy single-cover-image column every
      // existing read site still relies on — kept in sync with the gallery's
      // cover photo (position 0) rather than left null, so nothing
      // downstream needs to change.
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
    return {
      ok: false,
      message: insertError?.message || "Couldn't save that listing — please try again.",
    };
  }

  let auctionFailed = false;
  if (auctionDetails) {
    const { error: auctionError } = await supabase.from("auctions").insert({
      listing_id: inserted.id,
      starting_price_cents: eurToCents(auctionDetails.startingPriceEur),
      reserve_price_cents:
        auctionDetails.reservePriceEur !== undefined
          ? eurToCents(auctionDetails.reservePriceEur)
          : null,
      buy_now_price_cents:
        auctionDetails.buyNowPriceEur !== null ? eurToCents(auctionDetails.buyNowPriceEur) : null,
      min_increment_cents: eurToCents(auctionDetails.minIncrementEur),
      starts_at: auctionDetails.startsAt.toISOString(),
      ends_at: auctionDetails.endsAt.toISOString(),
    });
    auctionFailed = Boolean(auctionError);
  }

  let imagesFailed = false;
  if (images.length > 0) {
    const { error: imagesError } = await supabase.from("listing_images").insert(
      images.map((img) => ({
        listing_id: inserted.id,
        image_url: img.url,
        position: img.position,
      }))
    );
    if (imagesError) {
      imagesFailed = true;
      console.error(`Failed to attach images to listing ${inserted.id}:`, imagesError.message);
    }
  }

  return { ok: true, listingId: inserted.id, auctionFailed, imagesFailed };
}
