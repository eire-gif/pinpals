import { postFileToSite, postToSite, type UploadFile } from "./api";
import { SITE_URL } from "./config";
import { supabase } from "./supabase";

/**
 * Posting an item for sale, from the app.
 *
 * Every write here goes through the website. That is not the usual "because
 * of the notification" reason — it is the photos. A phone photo carries
 * EXIF: the camera, the timestamp, and, for anyone who ever said yes to a
 * location prompt, the GPS coordinates of where it was taken. Listing
 * photos are public. A member photographing a driver in their own hallway
 * would be publishing their home address inside the file.
 *
 * /api/app/listings/images runs the same sharp pipeline as the website, so
 * the stripping happens in exactly one place rather than once per client.
 * The app never touches Storage directly, and should never be changed to.
 *
 * The listing is saved as a DRAFT, same as the website's form. Publishing
 * re-checks that the seller can actually take money, and that check stays on
 * the server where it belongs — so the app finishes by opening the listing's
 * own page, where the Publish button lives.
 */

// ---------------------------------------------------------------------------
// The vocabulary
// ---------------------------------------------------------------------------
//
// Mirrored from src/lib/marketplace.ts by hand, the same way the colours in
// theme.ts mirror globals.css. These are the two lists that are genuinely
// stable — a category has not been added since the marketplace was built,
// and both are checked again by the schema on the server. Brands are NOT
// mirrored: that list really does change, and it is fetched (see below).

export const CATEGORIES = [
  "Drivers",
  "Woods & hybrids",
  "Irons",
  "Wedges",
  "Putters",
  "Full sets",
  "Bags & trolleys",
  "Shoes & apparel",
  "Balls & accessories",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const SUBCATEGORIES: Record<Category, readonly string[]> = {
  Drivers: ["Standard", "Left-handed", "Junior / ladies", "Limited / tour edition"],
  "Woods & hybrids": ["Fairway woods", "Hybrids", "Left-handed"],
  Irons: ["Iron sets", "Individual irons", "Left-handed"],
  Wedges: ["Pitching wedge", "Sand wedge", "Lob wedge", "Gap wedge"],
  Putters: ["Blade", "Mallet", "Left-handed"],
  "Full sets": ["Men's set", "Women's set", "Junior set"],
  "Bags & trolleys": [
    "Stand bags",
    "Cart bags",
    "Electric trolleys",
    "Push trolleys",
    "Travel bags",
  ],
  "Shoes & apparel": ["Shoes", "Waterproofs", "Gloves", "Headwear", "Other apparel"],
  "Balls & accessories": [
    "Golf balls",
    "Tees",
    "Head covers",
    "Rangefinders / GPS",
    "Other accessories",
  ],
};

export const CONDITIONS = ["New / unused", "Excellent", "Good", "Fair"] as const;

/** Matches listing_images_enforce_limit's hardcoded 8 (0046). */
export const MAX_LISTING_IMAGES = 8;

/** Matches listings_brand_other_length_check (0060). */
export const MAX_BRAND_OTHER_LENGTH = 60;

export const MAX_TITLE_LENGTH = 120;
export const MAX_DESCRIPTION_LENGTH = 2000;

/**
 * The two the app offers.
 *
 * Auctions exist and the server understands them, but an auction needs a
 * start, an end, a reserve and a minimum increment — four more questions, at
 * least two of them dates, on a form someone is filling in one-handed. The
 * route refuses an auction from here and says why, and the website does them
 * properly.
 */
export const SALE_TYPES = [
  {
    value: "fixed_price",
    label: "Fixed price",
    hint: "Buyers pay your price.",
  },
  {
    value: "offers_allowed",
    label: "Open to offers",
    hint: "Buyers can offer less. You choose.",
  },
] as const;

export type SaleType = (typeof SALE_TYPES)[number]["value"];

export const DELIVERY_OPTIONS = [
  { value: "post", label: "Post it" },
  { value: "collection", label: "Collection" },
] as const;

// ---------------------------------------------------------------------------
// Brands
// ---------------------------------------------------------------------------

export type Brand = { id: string; label: string };

/** The id behind "Other", the one choice that also wants a typed name. */
export const BRAND_OTHER = "other";

/**
 * The brands a seller may pick for this category.
 *
 * Fetched, not bundled. src/data/golf-brands.json gets brands added to it,
 * and `listings.brand` is a foreign key into marketplace_brands (0060) — so
 * a stale copy inside the app wouldn't merely look out of date, it would
 * offer a brand the insert then rejects. Same call the website's own picker
 * makes, so both forms show the same list.
 *
 * Returns [] rather than throwing: a brand is optional, and a listing that
 * can't be posted because a list of manufacturers didn't load would be a
 * poor trade.
 */
export async function brandsFor(
  category: string,
  subcategory?: string | null
): Promise<Brand[]> {
  const params = new URLSearchParams({ category });
  if (subcategory) params.set("subcategory", subcategory);

  try {
    const response = await fetch(`${SITE_URL}/api/brands?${params.toString()}`);
    if (!response.ok) return [];
    const { brands } = (await response.json()) as { brands?: Brand[] };
    return brands ?? [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Where the seller is
// ---------------------------------------------------------------------------

export type SellerPlace = { county: string | null; country: string | null };

/**
 * The member's own county, to fill the location in for them.
 *
 * Almost everyone sells from home, and a county picker that starts empty is
 * five taps to say something the profile already knows. They can still
 * change it — the form offers the country/county pair underneath — but the
 * common case costs nothing.
 */
export async function sellerPlace(userId: string): Promise<SellerPlace> {
  const { data } = await supabase
    .from("profiles")
    .select("county, country")
    .eq("id", userId)
    .maybeSingle()
    .overrideTypes<SellerPlace>();

  return { county: data?.county ?? null, country: data?.country ?? null };
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

export type UploadedPhoto = { url: string; path: string };

/**
 * One photo, uploaded and stripped.
 *
 * Throws ApiError, whose message is the server's own where there is one —
 * "Photos must be under 5MB", "That file doesn't look like a valid image" —
 * both written for a member rather than for a log.
 */
export function uploadPhoto(file: UploadFile): Promise<UploadedPhoto> {
  return postFileToSite<UploadedPhoto>("/api/app/listings/images", file);
}

// ---------------------------------------------------------------------------
// The listing
// ---------------------------------------------------------------------------

export type NewListing = {
  title: string;
  description: string;
  category: string;
  subcategory: string;
  condition: string;
  county: string | null;
  brand: string | null;
  brandOther: string | null;
  saleType: SaleType;
  priceEur: number;
  deliveryOptions: string[];
  /** Already uploaded. Position 0 is the cover photo. */
  images: UploadedPhoto[];
};

export type CreatedListing = {
  listingId: number;
  /** False when the listing saved but its photos didn't attach. Reported
   *  rather than assumed — "posted" while the photos quietly failed is the
   *  failure that looks like success. */
  imagesAttached: boolean;
};

export async function createListing(listing: NewListing): Promise<CreatedListing> {
  const payload = await postToSite<{
    listing_id: number;
    images_attached: boolean;
  }>("/api/app/listings", {
    title: listing.title,
    description: listing.description,
    category: listing.category,
    subcategory: listing.subcategory,
    condition: listing.condition,
    county: listing.county,
    brand: listing.brand,
    brand_other: listing.brandOther,
    sale_type: listing.saleType,
    price_eur: listing.priceEur,
    delivery_options: listing.deliveryOptions,
    images: listing.images.map((photo, index) => ({
      url: photo.url,
      position: index,
    })),
  });

  return {
    listingId: payload.listing_id,
    imagesAttached: payload.images_attached,
  };
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

/**
 * "1,250" from "1250.00", and null from anything that isn't money.
 *
 * Deliberately permissive about what it accepts and strict about what it
 * returns: a member typing "€120" or "120," on a phone keypad means 120, and
 * the server's schema is what finally decides. Two decimal places, because
 * cents exist and eurToCents() on the server will round anything finer.
 */
export function parsePrice(input: string): number | null {
  const cleaned = input.replace(/[^0-9.,]/g, "").replace(/,/g, ".");
  // More than one decimal point is a typo, not a number.
  if ((cleaned.match(/\./g) ?? []).length > 1) return null;

  const value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100) / 100;
}
