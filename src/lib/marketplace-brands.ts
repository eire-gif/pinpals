import brandsJson from "@/data/golf-brands.json";
import { CATEGORIES, SUBCATEGORIES } from "./marketplace";

/**
 * The marketplace's brand taxonomy — "which brands can this kind of item
 * be?", the second half of the category/subcategory vocabulary that already
 * lives in src/lib/marketplace.ts.
 *
 * Source of truth is src/data/golf-brands.json, exactly the same
 * arrangement the club list used before it moved into the database: the JSON
 * is the data, this module is the typed accessors over it, and
 * supabase/migrations/0060_listing_brand_and_specs.sql seeds
 * `public.marketplace_brands` from that same file so `listings.brand` can
 * carry a real foreign key. Keep the three in sync if a brand is added —
 * the same hand-mirroring discipline this codebase already uses for
 * CATEGORIES, the image limits, and PLATFORM_FEE_RATE.
 *
 * One deliberate departure from the "the value IS the display label"
 * convention CATEGORIES/CONDITIONS/SUBCATEGORIES follow: a brand is stored
 * and filtered by a slug id ("taylormade"), not its label. Brand labels
 * contain characters that make terrible URL query values and terrible
 * primary keys — "G/FORE", "L.A.B. Golf", "YES!", "Top-Flite" — and unlike
 * a category, a brand's display spelling is the kind of thing that gets
 * corrected later ("Rohnisch" -> "Röhnisch") without wanting to rewrite
 * every listing row that references it.
 */

export type Brand = {
  id: string;
  label: string;
  /** Alternate spellings resolveBrandInput() accepts. Never shown in the UI. */
  aliases: readonly string[];
};

type BrandsFile = {
  brands: Brand[];
  categories: Record<string, { brands: string[]; subcategoryBrands: Record<string, string[]> }>;
  legacyResale: Record<string, string[]>;
};

const data = brandsJson as unknown as BrandsFile;

export type CategoryName = (typeof CATEGORIES)[number];

export const BRANDS: readonly Brand[] = data.brands;

const BRAND_BY_ID = new Map(BRANDS.map((b) => [b.id, b]));

/**
 * The three non-brand choices a seller always gets, on top of whatever the
 * category offers. They're stored in `listings.brand` like any other brand
 * (and seeded into marketplace_brands as fallback rows, so the foreign key
 * holds) — a listing whose brand isn't in the curated list is never
 * rejected, it just carries `other` plus the seller's own `brand_other`
 * text. Buyers filtering by brand see these alongside the real ones.
 */
export const FALLBACK_BRANDS = [
  { id: "other", label: "Other", aliases: [] as string[] },
  { id: "unknown", label: "Unknown / unbranded", aliases: [] as string[] },
  { id: "mixed", label: "Mixed brands", aliases: [] as string[] },
] as const;

export type FallbackBrandId = (typeof FALLBACK_BRANDS)[number]["id"];

/** `Other` is the only choice that requires the seller to type a name. */
export const BRAND_REQUIRING_TEXT: FallbackBrandId = "other";

/** Mixed only makes sense where an item genuinely is several brands. */
export const MIXED_BRAND_CATEGORIES: readonly CategoryName[] = ["Full sets", "Balls & accessories"];

/** Max length of the free-text brand name behind `Other`. Mirrors
 * listings_brand_other_length_check (0060). */
export const MAX_BRAND_OTHER_LENGTH = 60;

/** Max length of the model/spec free-text fields. Mirrors the matching
 * length checks in 0060. */
export const MAX_MODEL_LENGTH = 80;
export const MAX_SPEC_LENGTH = 24;

export function brandById(id: string): Brand | undefined {
  return BRAND_BY_ID.get(id) ?? FALLBACK_BRANDS.find((b) => b.id === id);
}

/** The brand's display label, or the id itself for an unknown id — never
 * throws, so a listing carrying a brand this build doesn't know about (a
 * row written by a newer deploy, say) still renders something sensible. */
export function brandLabel(id: string): string {
  return brandById(id)?.label ?? id;
}

/**
 * A listing's brand as a buyer should see it: the seller's own words for an
 * `Other` listing, the canonical label otherwise. `null` when there's no
 * brand at all (every listing created before this phase).
 */
export function displayBrand(listing: { brand: string | null; brand_other: string | null }): string | null {
  if (!listing.brand) return null;
  if (listing.brand === "other") return listing.brand_other || "Other";
  return brandLabel(listing.brand);
}

function categoryEntry(category: string) {
  return data.categories[category];
}

/**
 * The brands offered for a category, in editorial order (most-likely first,
 * not alphabetical — a seller listing a driver should see TaylorMade before
 * Acer). Narrowed by subcategory where the subcategory genuinely implies a
 * different set of makers: "Rangefinders / GPS" offers Bushnell and Garmin
 * but not Titleist, "Shoes" excludes the apparel-only houses. Where a
 * subcategory doesn't imply anything about the maker ("Left-handed",
 * "Junior / ladies"), the full category list is returned unchanged.
 *
 * Deliberately never returns an empty list for a valid category — an
 * unrecognised subcategory falls back to the whole category rather than
 * stranding a seller with nothing to choose.
 */
export function brandIdsFor(category: string, subcategory?: string | null): readonly string[] {
  const entry = categoryEntry(category);
  if (!entry) return [];
  if (subcategory) {
    const narrowed = entry.subcategoryBrands[subcategory];
    if (narrowed) return narrowed;
  }
  return entry.brands;
}

export function brandsFor(category: string, subcategory?: string | null): readonly Brand[] {
  return brandIdsFor(category, subcategory)
    .map((id) => BRAND_BY_ID.get(id))
    .filter((b): b is Brand => b !== undefined);
}

/** Every brand id used by any category, deduplicated, in the order the
 * categories themselves are listed — what the "All" tab's brand filter
 * offers. */
export const ALL_BRAND_IDS: readonly string[] = (() => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const category of CATEGORIES) {
    for (const id of categoryEntry(category)?.brands ?? []) {
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
  }
  return out;
})();

/** The brands a seller may pick for this category — the curated list plus
 * Other/Unknown, plus Mixed where a mixed-brand item is a real thing. */
export function sellableBrandsFor(category: string, subcategory?: string | null): readonly Brand[] {
  const fallbacks = FALLBACK_BRANDS.filter(
    (b) => b.id !== "mixed" || (MIXED_BRAND_CATEGORIES as readonly string[]).includes(category)
  );
  return [...brandsFor(category, subcategory), ...fallbacks];
}

/** Whether `brandId` is a legal choice for this category/subcategory — the
 * check the zod schema and the search-filter parser both run. */
export function isBrandValidFor(brandId: string, category: string, subcategory?: string | null): boolean {
  return sellableBrandsFor(category, subcategory).some((b) => b.id === brandId);
}

/** Whether `brandId` is a legal choice anywhere at all — used when a buyer
 * filters by brand without having picked a category. */
export function isKnownBrandId(brandId: string): boolean {
  return BRAND_BY_ID.has(brandId) || FALLBACK_BRANDS.some((b) => b.id === brandId);
}

/**
 * Brands whose clubs in this category are resale-only — they stopped making
 * them (Nike's clubs, SIK and YES! putters). Shown as a small note in the
 * seller's brand picker so "why is Nike listed?" answers itself; never a
 * reason to reject a listing.
 */
export function isLegacyResale(brandId: string, category: string): boolean {
  return (data.legacyResale[category] ?? []).includes(brandId);
}

// ============ free-text -> canonical brand ============

/** Case, spacing, punctuation and accents folded away — for MATCHING only.
 * The seller's own spelling is always what gets stored in brand_other and
 * shown back to them. */
export function normalizeBrandText(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

const BRAND_BY_NORMALIZED = (() => {
  const map = new Map<string, string>();
  for (const brand of BRANDS) {
    for (const spelling of [brand.label, ...brand.aliases]) {
      const key = normalizeBrandText(spelling);
      // First writer wins: a canonical label always beats another brand's
      // alias, and BRANDS is sorted so this is stable across builds.
      if (!map.has(key)) map.set(key, brand.id);
    }
  }
  return map;
})();

/**
 * Product lines that are not brands. "Vokey" is a Titleist wedge line, not a
 * separate maker, so a seller typing it must end up on Titleist with Vokey
 * kept as the model — never as its own brand checkbox competing with
 * Titleist in the filter list.
 */
const PRODUCT_LINES: Record<string, { brandId: string; model: string; categories?: readonly CategoryName[] }> = {
  vokey: { brandId: "titleist", model: "Vokey", categories: ["Wedges"] },
  titleistvokey: { brandId: "titleist", model: "Vokey", categories: ["Wedges"] },
  wilsonstaff: { brandId: "wilson", model: "Staff" },
  touredgeexotics: { brandId: "tour-edge", model: "Exotics" },
  callawaystrata: { brandId: "strata", model: "" , categories: ["Full sets"] },
  odysseytoulon: { brandId: "odyssey", model: "Toulon", categories: ["Putters"] },
};

/**
 * Brand names that are ambiguous in a particular category and must be
 * confirmed rather than silently converted: a putter listed only as
 * "Titleist" is almost certainly a Scotty Cameron, but "almost certainly"
 * is not good enough to rewrite what a seller typed.
 */
const AMBIGUOUS_IN_CATEGORY: Record<string, { category: CategoryName; suggest: string }[]> = {
  titleist: [{ category: "Putters", suggest: "scotty-cameron" }],
  callaway: [{ category: "Putters", suggest: "odyssey" }],
};

export type BrandResolution =
  | { kind: "brand"; brandId: string; model?: string }
  | { kind: "ambiguous"; brandId: string; suggestBrandId: string }
  | { kind: "unresolved" };

/**
 * Free text -> a canonical brand, for the seller's "Other" box and for any
 * future migration of the pre-brand listings. Exact canonical and alias
 * matches resolve outright; a known product line resolves to its parent
 * brand and hands back the line as a model; a name that's ambiguous inside
 * the given category resolves to a suggestion the caller must confirm with
 * the seller rather than apply. Anything else is `unresolved` — which is
 * not an error, it just means the listing keeps the seller's own text under
 * the `other` brand.
 */
export function resolveBrandInput(raw: string, category?: string | null): BrandResolution {
  const key = normalizeBrandText(raw);
  if (!key) return { kind: "unresolved" };

  const line = PRODUCT_LINES[key];
  if (line && (!line.categories || !category || (line.categories as readonly string[]).includes(category))) {
    return line.model ? { kind: "brand", brandId: line.brandId, model: line.model } : { kind: "brand", brandId: line.brandId };
  }

  const brandId = BRAND_BY_NORMALIZED.get(key);
  if (!brandId) return { kind: "unresolved" };

  if (category) {
    const ambiguity = AMBIGUOUS_IN_CATEGORY[brandId]?.find((a) => a.category === category);
    if (ambiguity) return { kind: "ambiguous", brandId, suggestBrandId: ambiguity.suggest };
  }

  return { kind: "brand", brandId };
}

// ============ item specification ============
// The "what exactly is it" fields that sit beside brand on a listing.
// Every one of them is optional: a seller who just wants to post a photo
// and a price still can, and a buyer filtering on brand doesn't lose the
// listings whose seller skipped the details.

export const DEXTERITIES = ["Right-handed", "Left-handed"] as const;
export const SHAFT_FLEXES = ["Ladies", "Senior", "Regular", "Stiff", "Extra stiff"] as const;
export const SHAFT_MATERIALS = ["Steel", "Graphite", "Multi-material"] as const;

export type Dexterity = (typeof DEXTERITIES)[number];
export type ShaftFlex = (typeof SHAFT_FLEXES)[number];
export type ShaftMaterial = (typeof SHAFT_MATERIALS)[number];

/** The spec fields that make sense per category — a driver has a loft and a
 * shaft flex, a golf bag has neither, and only shoes and apparel have a
 * size. Drives which inputs the create/edit forms render; the DB columns
 * themselves are all nullable and category-agnostic. */
export type SpecField = "model" | "dexterity" | "shaftFlex" | "shaftMaterial" | "loft" | "itemSize";

const CLUB_SPECS: readonly SpecField[] = ["model", "dexterity", "shaftFlex", "shaftMaterial", "loft"];

export const SPEC_FIELDS_BY_CATEGORY: Record<CategoryName, readonly SpecField[]> = {
  "Drivers": CLUB_SPECS,
  "Woods & hybrids": CLUB_SPECS,
  "Irons": CLUB_SPECS,
  "Wedges": CLUB_SPECS,
  "Putters": ["model", "dexterity", "loft"],
  "Full sets": ["model", "dexterity", "shaftFlex", "shaftMaterial"],
  "Bags & trolleys": ["model"],
  "Shoes & apparel": ["model", "itemSize"],
  "Balls & accessories": ["model"],
};

export const SPEC_FIELD_LABELS: Record<SpecField, string> = {
  model: "Model",
  dexterity: "Hand",
  shaftFlex: "Shaft flex",
  shaftMaterial: "Shaft",
  loft: "Loft",
  itemSize: "Size",
};

export const SPEC_FIELD_PLACEHOLDERS: Record<SpecField, string> = {
  model: "e.g. Stealth 2 Plus",
  dexterity: "",
  shaftFlex: "",
  shaftMaterial: "",
  loft: "e.g. 10.5°",
  itemSize: "e.g. UK 9 / Medium",
};

export function specFieldsFor(category: string): readonly SpecField[] {
  return SPEC_FIELDS_BY_CATEGORY[category as CategoryName] ?? ["model"];
}

/** Guard against a subcategory that isn't one of the category's own — the
 * same rule createListingSchema enforces, exported so the brand helpers can
 * be trusted with whatever the URL happens to carry. */
export function isSubcategoryOf(subcategory: string, category: string): boolean {
  return (SUBCATEGORIES[category as CategoryName] as readonly string[] | undefined)?.includes(subcategory) ?? false;
}
