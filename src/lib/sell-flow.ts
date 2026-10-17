/**
 * Selling, step by step (Oct 2026, approved mock-ups "Selling, rebuilt") —
 * the rules the website's form and the app's screen share. Copied byte for
 * byte to mobile/src/lib/sell-flow.ts (sell-flow.test.ts checks), so it
 * imports nothing.
 *
 * Six steps, one question each, in the order buyers search:
 *   1 Photos and a description · 2 What is it · 3 Brand · 4 Model ·
 *   5 Details · 6 Price and post.
 *
 * Everything golf, not just clubs: the "What is it" tiles map onto the
 * marketplace's nine categories and their subcategories, so no new
 * vocabulary reaches the database.
 */

export const SELL_STEPS = ["Photos", "Item", "Brand", "Model", "Details", "Price"] as const;
export type SellStep = (typeof SELL_STEPS)[number];

/** A "which kind?" choice under a tile — it sets the subcategory. */
export type SellKind = { label: string; subcategory: string };

export type SellTile = {
  key: string;
  label: string;
  group: "clubs" | "other";
  category: string;
  /** Set straight away by the tile itself. */
  subcategory?: string;
  /** Asked under the tile when it's picked. The first is the default. */
  kinds?: readonly SellKind[];
};

export const SELL_TILES: readonly SellTile[] = [
  { key: "drivers", label: "Drivers", group: "clubs", category: "Drivers" },
  {
    key: "woods",
    label: "Woods & hybrids",
    group: "clubs",
    category: "Woods & hybrids",
    kinds: [
      { label: "Fairway wood", subcategory: "Fairway woods" },
      { label: "Hybrid", subcategory: "Hybrids" },
    ],
  },
  {
    key: "irons",
    label: "Irons",
    group: "clubs",
    category: "Irons",
    kinds: [
      { label: "Iron set", subcategory: "Iron sets" },
      { label: "Single iron", subcategory: "Individual irons" },
    ],
  },
  { key: "wedges", label: "Wedges", group: "clubs", category: "Wedges" },
  { key: "putters", label: "Putters", group: "clubs", category: "Putters" },
  {
    key: "sets",
    label: "Full sets",
    group: "clubs",
    category: "Full sets",
    kinds: [
      { label: "Men's", subcategory: "Men's set" },
      { label: "Women's", subcategory: "Women's set" },
      { label: "Junior", subcategory: "Junior set" },
    ],
  },
  {
    key: "bags",
    label: "Bags",
    group: "other",
    category: "Bags & trolleys",
    kinds: [
      { label: "Stand bag", subcategory: "Stand bags" },
      { label: "Cart bag", subcategory: "Cart bags" },
      { label: "Travel bag", subcategory: "Travel bags" },
    ],
  },
  {
    key: "trolleys",
    label: "Trolleys",
    group: "other",
    category: "Bags & trolleys",
    kinds: [
      { label: "Electric", subcategory: "Electric trolleys" },
      { label: "Push", subcategory: "Push trolleys" },
    ],
  },
  { key: "shoes", label: "Shoes", group: "other", category: "Shoes & apparel", subcategory: "Shoes" },
  {
    key: "clothing",
    label: "Clothing",
    group: "other",
    category: "Shoes & apparel",
    kinds: [
      { label: "Waterproofs", subcategory: "Waterproofs" },
      { label: "Gloves", subcategory: "Gloves" },
      { label: "Headwear", subcategory: "Headwear" },
      { label: "Other clothing", subcategory: "Other apparel" },
    ],
  },
  { key: "gps", label: "GPS & rangefinders", group: "other", category: "Balls & accessories", subcategory: "Rangefinders / GPS" },
  { key: "balls", label: "Balls", group: "other", category: "Balls & accessories", subcategory: "Golf balls" },
  {
    key: "accessories",
    label: "Accessories",
    group: "other",
    category: "Balls & accessories",
    kinds: [
      { label: "Head covers", subcategory: "Head covers" },
      { label: "Tees", subcategory: "Tees" },
      { label: "Something else", subcategory: "Other accessories" },
    ],
  },
  { key: "training", label: "Training aids", group: "other", category: "Balls & accessories", subcategory: "Other accessories" },
  { key: "other", label: "Something else", group: "other", category: "Balls & accessories", subcategory: "Other accessories" },
];

export function tileByKey(key: string): SellTile | undefined {
  return SELL_TILES.find((t) => t.key === key);
}

/** The tile for a category and subcategory — for a form filled in from a typed title, or from the finder. */
export function tileFor(category: string, subcategory?: string | null): SellTile | undefined {
  const inCategory = SELL_TILES.filter((t) => t.category === category);
  if (subcategory) {
    const exact = inCategory.find((t) => t.subcategory === subcategory || t.kinds?.some((k) => k.subcategory === subcategory));
    if (exact) return exact;
  }
  return inCategory[0];
}

/** The subcategory a tile (and kind, where asked) stands for. */
export function subcategoryFor(tile: SellTile, kind?: string | null): string {
  if (tile.subcategory) return tile.subcategory;
  if (tile.kinds?.length) return tile.kinds.find((k) => k.subcategory === kind)?.subcategory ?? tile.kinds[0].subcategory;
  return "";
}

/** "Which TaylorMade driver?", "Which Motocaddy trolley?", "Which model?". */
export function modelQuestion(brandLabel: string, tile: SellTile | undefined): string {
  const noun: Record<string, string> = {
    drivers: "driver",
    woods: "wood or hybrid",
    irons: "irons",
    wedges: "wedge",
    putters: "putter",
    sets: "set",
    bags: "bag",
    trolleys: "trolley",
    shoes: "shoes",
    gps: "GPS or rangefinder",
    balls: "balls",
  };
  const n = tile ? noun[tile.key] : undefined;
  return brandLabel && n ? `Which ${brandLabel} ${n}?` : brandLabel ? `Which ${brandLabel} model?` : "Which model?";
}

/** The fixed fallbacks a seller can always pick for brand. */
export const BRAND_FALLBACKS = { other: "other", unknown: "unknown", mixed: "mixed" } as const;

/** How many logo tiles show before search and A–Z. */
export const BRAND_TILES = 9;

/** How many different sellers must type the same thing before it's offered to the next one. Mirrors 0164. */
export const SUGGEST_AFTER_SELLERS = 3;

/** …and before it joins the catalogue by itself, ads and all. Mirrors 0164. */
export const LEARN_AFTER_SELLERS = 5;

/**
 * The matching key for what sellers type: lower case, letters and digits
 * only. Mirrors public.marketplace_norm() (0164) — keep them the same.
 */
export function normKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Quick loft choices by category; the field still takes anything. */
export const LOFT_CHOICES: Record<string, readonly string[]> = {
  Drivers: ["9°", "10.5°", "12°"],
  "Woods & hybrids": ["15°", "18°", "21°"],
  Irons: [],
  Wedges: ["50°", "52°", "54°", "56°", "58°", "60°"],
  Putters: ["2°", "3°", "4°"],
};

/** What the condition choices mean, shown under each. */
export const CONDITION_HINTS: Record<string, string> = {
  "New / unused": "Never used, tags or plastic still on",
  Excellent: "Light use, no real marks",
  Good: "Normal wear, works perfectly",
  Fair: "Clear marks or wear, still works",
};

/**
 * The title, written for the seller from what they picked — "TaylorMade
 * Qi10 LS driver, 9° X-Stiff". They can change it on the last step.
 */
export function writeTitle(input: {
  brandLabel?: string | null;
  model?: string | null;
  tile?: SellTile;
  kind?: string | null;
  loft?: string | null;
  flex?: string | null;
  size?: string | null;
  hand?: string | null;
}): string {
  const tileNoun: Record<string, string> = {
    drivers: "driver",
    woods: input.kind === "Hybrids" ? "hybrid" : "fairway wood",
    irons: input.kind === "Individual irons" ? "iron" : "irons",
    wedges: "wedge",
    putters: "putter",
    sets: "golf set",
    bags: input.kind === "Cart bags" ? "cart bag" : input.kind === "Travel bags" ? "travel bag" : "stand bag",
    trolleys: input.kind === "Push trolleys" ? "push trolley" : "electric trolley",
    shoes: "golf shoes",
    gps: "rangefinder",
    balls: "golf balls",
    training: "training aid",
  };
  const noun = input.tile ? tileNoun[input.tile.key] ?? "" : "";
  const model = (input.model ?? "").trim();
  const brand = (input.brandLabel ?? "").trim();
  const head = [brand && !model.toLowerCase().startsWith(brand.toLowerCase()) ? brand : "", model, noun && !model.toLowerCase().includes(noun) ? noun : ""]
    .filter(Boolean)
    .join(" ");
  const tail = [input.loft, input.flex, input.size ? `size ${input.size}` : "", input.hand === "Left-handed" ? "left-handed" : ""]
    .filter((x) => x && String(x).trim())
    .join(" ");
  const title = tail ? `${head}, ${tail}` : head;
  return title.charAt(0).toUpperCase() + title.slice(1);
}
