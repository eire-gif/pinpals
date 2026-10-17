import * as SecureStore from "expo-secure-store";
import type { ImageSourcePropType } from "react-native";

import { EMPTY_FILTERS, type Filters } from "./marketplace";
import type { SmartSearch } from "./smart-search";

/**
 * Glue between smart search (smart-search.ts, shared with the website) and
 * the app's marketplace: a parsed search as browse filters, the member's
 * recent searches, and the category photos.
 */

/** A parsed search as the filters searchListings() takes. */
export function filtersFromSmart(search: SmartSearch, sort: Filters["sort"] = "newest"): Filters {
  return {
    ...EMPTY_FILTERS,
    q: search.text,
    category: search.category,
    subcategory: search.subcategory,
    brands: [...search.brands].sort(),
    county: search.nearMe ? "" : search.county,
    condition: search.condition,
    minPriceCents: search.minPriceCents,
    maxPriceCents: search.maxPriceCents,
    sort,
  };
}

// ---------------------------------------------------------------------------
// Recent searches — on this phone only, the last eight.
// ---------------------------------------------------------------------------

const RECENT_KEY = "pinpals.marketplace.recent-searches";
const RECENT_MAX = 8;

export async function recentSearches(): Promise<string[]> {
  try {
    const raw = await SecureStore.getItemAsync(RECENT_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export async function rememberSearch(query: string): Promise<void> {
  const q = query.replace(/\s+/g, " ").trim().slice(0, 80);
  if (q.length < 2) return;
  const list = await recentSearches();
  const next = [q, ...list.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, RECENT_MAX);
  try {
    await SecureStore.setItemAsync(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Not worth troubling anyone about.
  }
}

export async function clearRecentSearches(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(RECENT_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** Searches worth a tap when the box is empty. */
export const POPULAR_SEARCHES = ["Qi10 driver", "Scotty putter", "Pro V1", "Electric trolley", "Left-handed irons", "Under €100"] as const;

// ---------------------------------------------------------------------------
// Category photos (approved mock-ups) — studio shots on a soft colour, or the
// club on grass.
// ---------------------------------------------------------------------------

export const CATEGORY_PHOTOS: Record<string, ImageSourcePropType> = {
  Drivers: require("../../assets/images/marketplace/drivers.jpg"),
  "Woods & hybrids": require("../../assets/images/marketplace/woods.jpg"),
  Irons: require("../../assets/images/marketplace/irons.jpg"),
  Wedges: require("../../assets/images/marketplace/wedges.jpg"),
  Putters: require("../../assets/images/marketplace/putters.jpg"),
  "Full sets": require("../../assets/images/marketplace/sets.jpg"),
  "Bags & trolleys": require("../../assets/images/marketplace/bags.jpg"),
  "Shoes & apparel": require("../../assets/images/marketplace/apparel.jpg"),
  "Balls & accessories": require("../../assets/images/marketplace/balls.jpg"),
};

/** Short names for the tiles. */
export const CATEGORY_SHORT: Record<string, string> = {
  Drivers: "Drivers",
  "Woods & hybrids": "Woods",
  Irons: "Irons",
  Wedges: "Wedges",
  Putters: "Putters",
  "Full sets": "Full sets",
  "Bags & trolleys": "Bags",
  "Shoes & apparel": "Apparel",
  "Balls & accessories": "Balls & more",
};
