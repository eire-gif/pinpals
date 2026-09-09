import { z } from "zod";
import {
  CATEGORIES,
  CONDITIONS,
  SUBCATEGORIES,
  DELIVERY_OPTIONS,
  MAX_COLLECTION_NOTES_LENGTH,
  MAX_LISTING_IMAGES,
  auctionWindowError,
} from "@/lib/marketplace";
import {
  DEXTERITIES,
  SHAFT_FLEXES,
  SHAFT_MATERIALS,
  MAX_BRAND_OTHER_LENGTH,
  MAX_MODEL_LENGTH,
  MAX_SPEC_LENGTH,
  isBrandValidFor,
} from "@/lib/marketplace-brands";
import { COUNTIES } from "@/lib/clubs";

/**
 * Zod schemas for the listing create/edit workflow (see
 * supabase/migrations/0046_listing_creation_workflow.sql). This is "the
 * project's validation library" the task spec asks for — the create/edit
 * Server Actions (src/app/marketplace/new/actions.ts,
 * src/app/marketplace/[id]/edit/actions.ts) run every submission through
 * `createListingSchema`/`updateListingSchema` below before writing anything;
 * the client-side form duplicates the essential checks (required fields,
 * obvious range errors) inline for immediate feedback, but the server parse
 * is what's actually trusted — same "app validation is a UX nicety, the
 * layer that's actually enforced is server-side (here) + the DB constraints
 * behind it" discipline as everywhere else in this codebase.
 *
 * Every schema here expects a plain, already-FormData-normalised object —
 * `{ title: string, deliveryOptions: string[], startsAt: string, ... }` —
 * not a raw FormData instance. Numeric/date fields are `z.coerce`d so a
 * string straight out of `formData.get(...)` parses without the action
 * having to pre-convert it.
 */

// ============ shared field primitives ============

export const listingTitleSchema = z
  .string()
  .trim()
  .min(3, "Title must be at least 3 characters.")
  .max(120, "Title must be 120 characters or fewer.");

export const listingDescriptionSchema = z
  .string()
  .trim()
  .max(2000, "Description must be 2000 characters or fewer.")
  .optional();

export const listingCategorySchema = z.enum(CATEGORIES, { message: "Please choose a category." });

export const listingSubcategorySchema = z.string().trim().max(60, "Subcategory is too long.").optional();

export const listingConditionSchema = z.enum(CONDITIONS, { message: "Please choose a condition." });

// ============ brand + item specification (0060) ============
// All optional, deliberately: the point of the brand field is to make
// listings easier to FIND, and a required field that a seller can't answer
// ("what brand are these second-hand range balls?") costs more listings
// than it gains searchability. The category-membership rule below is the
// only real constraint, and Other/Unknown/Mixed mean there's always a
// truthful answer available — see marketplace-brands.ts's own comment on
// never rejecting a legitimate listing over a missing brand.

export const listingBrandSchema = z.string().trim().optional();

export const listingBrandOtherSchema = z
  .string()
  .trim()
  .max(MAX_BRAND_OTHER_LENGTH, `Brand name must be ${MAX_BRAND_OTHER_LENGTH} characters or fewer.`)
  .optional();

export const listingModelSchema = z
  .string()
  .trim()
  .max(MAX_MODEL_LENGTH, `Model must be ${MAX_MODEL_LENGTH} characters or fewer.`)
  .optional();

export const listingDexteritySchema = z.enum(DEXTERITIES).optional();
export const listingShaftFlexSchema = z.enum(SHAFT_FLEXES).optional();
export const listingShaftMaterialSchema = z.enum(SHAFT_MATERIALS).optional();

const specTextSchema = z
  .string()
  .trim()
  .max(MAX_SPEC_LENGTH, `That value must be ${MAX_SPEC_LENGTH} characters or fewer.`)
  .optional();

export const listingLoftSchema = specTextSchema;
export const listingItemSizeSchema = specTextSchema;

// "Location" in the task spec maps onto the existing `county` field
// (src/lib/clubs.ts's COUNTIES) rather than a new column — every other part
// of this app already treats county as "where in Ireland", and a listing's
// location has never meant anything more precise than that (see
// src/app/marketplace/[id]/page.tsx's county badge).
export const listingCountySchema = z.enum(COUNTIES, { message: "Please choose a county." }).optional();

export const listingDeliveryOptionsSchema = z
  .array(z.enum(DELIVERY_OPTIONS))
  .min(1, "Choose at least one delivery option.");

export const listingCollectionNotesSchema = z
  .string()
  .trim()
  .max(MAX_COLLECTION_NOTES_LENGTH, `Collection notes must be ${MAX_COLLECTION_NOTES_LENGTH} characters or fewer.`)
  .optional();

/** A positive euro amount with at most 2 decimal places — the same
 * granularity price_cents (integer cents) can represent exactly, so nothing
 * gets silently rounded between what the seller typed and what's stored. */
function positiveEurAmount(message: string) {
  return z.coerce
    .number({ message })
    .positive(message)
    .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, {
      message: "Enter an amount with at most 2 decimal places.",
    });
}

export const listingPriceEurSchema = positiveEurAmount("Enter a valid price in euro.");

// ============ per-image metadata (the count/order half of "up to the
// agreed image limit with cover-image ordering" — the file bytes themselves
// are validated by the upload pipeline, src/lib/images/upload.ts, task #18) ============

export const listingImageMetaSchema = z.object({
  url: z.string().trim().min(1, "Missing image URL."),
  position: z.coerce.number().int().min(0),
});

export const listingImagesSchema = z
  .array(listingImageMetaSchema)
  .max(MAX_LISTING_IMAGES, `A listing may have at most ${MAX_LISTING_IMAGES} images.`);

// ============ base fields shared by every sale type ============

const listingBaseFields = {
  title: listingTitleSchema,
  description: listingDescriptionSchema,
  category: listingCategorySchema,
  subcategory: listingSubcategorySchema,
  condition: listingConditionSchema,
  county: listingCountySchema,
  deliveryOptions: listingDeliveryOptionsSchema,
  collectionNotes: listingCollectionNotesSchema,
  brand: listingBrandSchema,
  brandOther: listingBrandOtherSchema,
  model: listingModelSchema,
  dexterity: listingDexteritySchema,
  shaftFlex: listingShaftFlexSchema,
  shaftMaterial: listingShaftMaterialSchema,
  loft: listingLoftSchema,
  itemSize: listingItemSizeSchema,
};

/**
 * The brand rules that need to see more than one field at once, shared by
 * the create and edit schemas so a listing can't be valid on one path and
 * invalid on the other. Mirrors listings_brand_fkey plus the two
 * brand_other check constraints in 0060 — a submission that would be
 * rejected by the database gets a specific, field-level message here first.
 */
function checkBrandFields(
  data: {
    brand?: string;
    brandOther?: string;
    category?: string;
    subcategory?: string;
  },
  ctx: z.RefinementCtx
) {
  if (data.brand && data.category && !isBrandValidFor(data.brand, data.category, data.subcategory)) {
    ctx.addIssue({
      code: "custom",
      message: "That brand isn't one of the options for the chosen category.",
      path: ["brand"],
    });
  }

  if (data.brand === "other" && !data.brandOther) {
    ctx.addIssue({
      code: "custom",
      message: "Tell buyers the brand name, or choose Unknown / unbranded.",
      path: ["brandOther"],
    });
  }

  if (data.brandOther && data.brand !== "other") {
    ctx.addIssue({
      code: "custom",
      message: "A brand name can only be typed in when the brand is set to Other.",
      path: ["brandOther"],
    });
  }
}

// ============ per-sale-type schemas ============
// Four literal branches rather than one schema with optional
// auction-only fields, so a fixed-price submission can never accidentally
// carry (or silently ignore) auction fields and vice versa — the
// discriminated union makes "which fields exist" a direct function of
// saleType, mirroring listings_price_required_for_non_auction_check (0046)
// at the type level.

const fixedPriceListingSchema = z.object({
  ...listingBaseFields,
  saleType: z.literal("fixed_price"),
  priceEur: listingPriceEurSchema,
});

const offersAllowedListingSchema = z.object({
  ...listingBaseFields,
  saleType: z.literal("offers_allowed"),
  priceEur: listingPriceEurSchema,
});

const auctionListingSchema = z.object({
  ...listingBaseFields,
  saleType: z.literal("auction"),
  startingPriceEur: positiveEurAmount("Enter a valid starting price."),
  reservePriceEur: positiveEurAmount("Enter a valid reserve price.").optional(),
  minIncrementEur: positiveEurAmount("Enter a valid minimum bid increment."),
  startsAt: z.coerce.date({ message: "Enter a valid start time." }),
  endsAt: z.coerce.date({ message: "Enter a valid end time." }),
});

const auctionWithBuyNowListingSchema = z.object({
  ...listingBaseFields,
  saleType: z.literal("auction_with_buy_now"),
  startingPriceEur: positiveEurAmount("Enter a valid starting price."),
  reservePriceEur: positiveEurAmount("Enter a valid reserve price.").optional(),
  buyNowPriceEur: positiveEurAmount("Enter a valid Buy It Now price."),
  minIncrementEur: positiveEurAmount("Enter a valid minimum bid increment."),
  startsAt: z.coerce.date({ message: "Enter a valid start time." }),
  endsAt: z.coerce.date({ message: "Enter a valid end time." }),
});

/**
 * The full create-listing schema. Cross-field rules mirror the DB checks
 * that back them (reserve >= starting, buy-now > reserve/starting —
 * auctions.reserve_price_cents_check/buy_now_price_cents_check, 0039; the
 * auction window — auctions_ends_after_starts_check, 0039, tightened to a
 * sane range by auctionWindowError()) so a submission that would fail at the
 * database gets a specific, field-level error here instead of a generic
 * "couldn't create that listing" from a caught Postgres exception.
 */
export const createListingSchema = z
  .discriminatedUnion("saleType", [
    fixedPriceListingSchema,
    offersAllowedListingSchema,
    auctionListingSchema,
    auctionWithBuyNowListingSchema,
  ])
  .superRefine((data, ctx) => {
    if (data.subcategory && !(SUBCATEGORIES[data.category] as readonly string[]).includes(data.subcategory)) {
      ctx.addIssue({
        code: "custom",
        message: "That subcategory doesn't belong to the chosen category.",
        path: ["subcategory"],
      });
    }

    checkBrandFields(data, ctx);

    if (data.saleType === "auction" || data.saleType === "auction_with_buy_now") {
      const windowError = auctionWindowError(data.startsAt, data.endsAt);
      if (windowError) {
        ctx.addIssue({ code: "custom", message: windowError, path: ["endsAt"] });
      }

      if (data.reservePriceEur !== undefined && data.reservePriceEur < data.startingPriceEur) {
        ctx.addIssue({
          code: "custom",
          message: "Reserve price can't be lower than the starting price.",
          path: ["reservePriceEur"],
        });
      }

      if (data.saleType === "auction_with_buy_now") {
        const floor = data.reservePriceEur ?? data.startingPriceEur;
        if (data.buyNowPriceEur <= floor) {
          ctx.addIssue({
            code: "custom",
            message: "Buy It Now price must be higher than the reserve (or starting) price.",
            path: ["buyNowPriceEur"],
          });
        }
      }
    }
  });

export type CreateListingInput = z.infer<typeof createListingSchema>;

/**
 * Editing an existing listing: the same field set as creation, but every
 * price/auction-window field is optional at the schema level, since
 * prevent_listing_edit_during_live_auction()/prevent_auction_edit_after_first_bid()
 * (0046) are what actually decide whether a given field may change on THIS
 * particular listing right now (has it already had a bid?) — a concern the
 * edit action re-checks against the current row before ever calling this
 * parse, not something a static schema can express. This schema's job is
 * narrower: if a field is present in the edit payload, is its value valid on
 * its own terms.
 */
export const updateListingSchema = z
  .object({
    title: listingTitleSchema.optional(),
    description: listingDescriptionSchema,
    category: listingCategorySchema.optional(),
    subcategory: listingSubcategorySchema,
    condition: listingConditionSchema.optional(),
    county: listingCountySchema,
    deliveryOptions: listingDeliveryOptionsSchema.optional(),
    collectionNotes: listingCollectionNotesSchema,
    priceEur: listingPriceEurSchema.optional(),
    brand: listingBrandSchema,
    brandOther: listingBrandOtherSchema,
    model: listingModelSchema,
    dexterity: listingDexteritySchema,
    shaftFlex: listingShaftFlexSchema,
    shaftMaterial: listingShaftMaterialSchema,
    loft: listingLoftSchema,
    itemSize: listingItemSizeSchema,
  })
  // The edit form always submits category alongside brand (it has to — the
  // brand options depend on it), so the category-membership half of this
  // check has the category it needs. On the theoretical partial patch that
  // sends a brand with no category, checkBrandFields skips that half rather
  // than guessing; listings_brand_fkey still backstops it at the database.
  .superRefine(checkBrandFields);

export type UpdateListingInput = z.infer<typeof updateListingSchema>;
