// ============ MARKETPLACE FOUNDATION — DEVELOPMENT FIXTURE ============
// Temporary, database-free stand-in for `listings`/`profiles` reads so the
// new marketplace routes (src/app/marketplace/**) can be built, reviewed and
// signed off on visually before the phase that reconnects them to Supabase.
//
// Deliberately NOT wired to any table: no Supabase client is imported here,
// nothing here can read or write `public.listings`/`public.offers`, and the
// real bidding flow (offers, accept/decline, order creation — see
// src/app/marketplace/[id]/actions.ts on the `main` branch prior to this
// phase) has no equivalent here on purpose. When the database phase lands,
// this file's exported functions (`listMockListings`/`getMockListingBySlug`)
// are the seam to replace with real Supabase queries — the page components
// that call them shouldn't need to change shape, only their data source.
//
// `MockListing`/`MockSeller` are intentionally separate types from
// `Listing`/`Profile` (src/lib/types.ts) rather than reusing them: this
// fixture has fields the real schema doesn't (`slug`, a denormalized
// `seller`) and is missing fields the real schema has (a real `id`,
// `seller_id`, `updated_at`, `status` transitions). Keeping them distinct
// avoids implying this fixture is a preview of the real row shape.

import { CATEGORIES, CONDITIONS } from "./marketplace";
import { COUNTIES } from "./clubs";

export type MockCategory = (typeof CATEGORIES)[number];
export type MockCondition = (typeof CONDITIONS)[number];
export type MockCounty = (typeof COUNTIES)[number];

export type MockSeller = {
  name: string;
  homeClub: string | null;
  county: MockCounty;
  memberSinceYear: number;
  avatarColor: string;
  activeListings: number;
};

export type MockListing = {
  id: string;
  slug: string;
  title: string;
  description: string;
  priceEur: number;
  category: MockCategory;
  condition: MockCondition;
  county: MockCounty;
  createdAt: string; // ISO date, newest-first by default
  seller: MockSeller;
};

export type MockListingFilters = {
  q?: string;
  category?: string;
  county?: string;
  sort?: "recent" | "price_low" | "price_high";
};

const SELLERS = {
  gerry: {
    name: "Gerry Fallon",
    homeClub: "Portmarnock Golf Club",
    county: "Dublin",
    memberSinceYear: 2023,
    avatarColor: "#1f5c2e",
    activeListings: 4,
  },
  aoife: {
    name: "Aoife Nolan",
    homeClub: "Lahinch Golf Club",
    county: "Clare",
    memberSinceYear: 2024,
    avatarColor: "#b6862a",
    activeListings: 2,
  },
  darren: {
    name: "Darren Whelan",
    homeClub: "Royal County Down",
    county: "Down",
    memberSinceYear: 2022,
    avatarColor: "#0c2038",
    activeListings: 7,
  },
  sinead: {
    name: "Sinéad Boyle",
    homeClub: "Waterville Golf Links",
    county: "Kerry",
    memberSinceYear: 2025,
    avatarColor: "#a83a2b",
    activeListings: 1,
  },
  colm: {
    name: "Colm Brennan",
    homeClub: "The K Club",
    county: "Kildare",
    memberSinceYear: 2021,
    avatarColor: "#173f22",
    activeListings: 5,
  },
} as const satisfies Record<string, MockSeller>;

// Newest first by default (matches the "Newest first" default sort the
// database-backed page used) — createdAt values are hand-spread across the
// last few weeks so relative-time display and the price/date sorts each
// have something meaningful to do.
export const MOCK_LISTINGS: MockListing[] = [
  {
    id: "1",
    slug: "taylormade-stealth-2-driver-10-5",
    title: "TaylorMade Stealth 2 Driver, 10.5°",
    description:
      "Stiff shaft, adjustable hosel left at stock setting. A few small scuffs on the sole from range use, face is clean. Comes with the head cover, no wrench.",
    priceEur: 220,
    category: "Drivers",
    condition: "Excellent",
    county: "Dublin",
    createdAt: "2026-08-30T09:15:00.000Z",
    seller: SELLERS.gerry,
  },
  {
    id: "2",
    slug: "titleist-t100-irons-4-pw",
    title: "Titleist T100 Irons, 4–PW",
    description:
      "Project X 6.0 shafts, regular length and lie. Great condition, well looked after — moving up to a bigger head shape so these need a new home.",
    priceEur: 650,
    category: "Irons",
    condition: "Excellent",
    county: "Down",
    createdAt: "2026-08-28T14:40:00.000Z",
    seller: SELLERS.darren,
  },
  {
    id: "3",
    slug: "scotty-cameron-newport-2-putter",
    title: "Scotty Cameron Newport 2 Putter",
    description:
      "34 inch, original grip and headcover included. Light paint fill wear, rolls true. One of the good ones.",
    priceEur: 310,
    category: "Putters",
    condition: "Good",
    county: "Clare",
    createdAt: "2026-08-25T11:05:00.000Z",
    seller: SELLERS.aoife,
  },
  {
    id: "4",
    slug: "callaway-jaws-raw-wedge-56",
    title: "Callaway Jaws Raw Wedge, 56°",
    description:
      "Raw face finish, bought new this season and barely used — a fitting mix-up means it's the wrong bounce for my swing. Grooves still sharp.",
    priceEur: 95,
    category: "Wedges",
    condition: "New / unused",
    county: "Kildare",
    createdAt: "2026-08-22T16:20:00.000Z",
    seller: SELLERS.colm,
  },
  {
    id: "5",
    slug: "ping-hoofer-14-stand-bag",
    title: "Ping Hoofer 14 Stand Bag",
    description:
      "Navy/white, 14-way top. Straps and stand mechanism both in full working order. A couple of the bottom rivets show wear but structurally solid.",
    priceEur: 130,
    category: "Bags & trolleys",
    condition: "Good",
    county: "Kerry",
    createdAt: "2026-08-20T10:00:00.000Z",
    seller: SELLERS.sinead,
  },
  {
    id: "6",
    slug: "cobra-darkspeed-fairway-wood-3",
    title: "Cobra Darkspeed Fairway Wood, 3-wood",
    description:
      "Stock Ventus Red shaft, senior flex. Excellent condition, always kept in a head cover. Selling as I've switched to a hybrid off the deck.",
    priceEur: 145,
    category: "Woods & hybrids",
    condition: "Excellent",
    county: "Dublin",
    createdAt: "2026-08-18T13:30:00.000Z",
    seller: SELLERS.gerry,
  },
  {
    id: "7",
    slug: "mizuno-mp20-full-set-with-bag",
    title: "Mizuno MP-20 Full Set (5–SW) with Bag",
    description:
      "Complete set, KBS Tour shafts, plus a matching cart bag. Set has had regular use but no major damage — grips could do with a regrip in a year or two.",
    priceEur: 780,
    category: "Full sets",
    condition: "Good",
    county: "Down",
    createdAt: "2026-08-15T09:45:00.000Z",
    seller: SELLERS.darren,
  },
  {
    id: "8",
    slug: "footjoy-premiere-golf-shoes-uk9",
    title: "FootJoy Premiere Golf Shoes, UK 9",
    description:
      "Worn twice — just the wrong fit for me. White/grey, spikeless sole, box included.",
    priceEur: 85,
    category: "Shoes & apparel",
    condition: "New / unused",
    county: "Kildare",
    createdAt: "2026-08-12T15:10:00.000Z",
    seller: SELLERS.colm,
  },
  {
    id: "9",
    slug: "titleist-pro-v1-dozen-x3-mixed",
    title: "Titleist Pro V1 — 3 Dozen, Mixed Play Rounds",
    description:
      "Pearl/A-grade practice-round balls, no cuts or scuffs. Great for a season of stroke play without paying full retail.",
    priceEur: 60,
    category: "Balls & accessories",
    condition: "Good",
    county: "Clare",
    createdAt: "2026-08-10T08:25:00.000Z",
    seller: SELLERS.aoife,
  },
  {
    id: "10",
    slug: "odyssey-white-hot-og-putter",
    title: "Odyssey White Hot OG Putter, #7 Shape",
    description:
      "Classic mallet shape, insert still soft off the face. Headcover a little frayed at the seam but the club itself is in fine shape.",
    priceEur: 120,
    category: "Putters",
    condition: "Good",
    county: "Kerry",
    createdAt: "2026-08-08T12:00:00.000Z",
    seller: SELLERS.sinead,
  },
  {
    id: "11",
    slug: "sun-mountain-micro-cart-trolley",
    title: "Sun Mountain Micro-Cart GT Trolley",
    description:
      "Folds down small for the boot, one-touch brake works perfectly. A few grass stains on the wheels, nothing that affects use.",
    priceEur: 175,
    category: "Bags & trolleys",
    condition: "Excellent",
    county: "Dublin",
    createdAt: "2026-08-05T17:50:00.000Z",
    seller: SELLERS.gerry,
  },
  {
    id: "12",
    slug: "ping-g430-hybrid-3h",
    title: "Ping G430 Hybrid, 3H",
    description:
      "Stock Alta CB shaft, stiff flex. Very forgiving off tight lies — only selling because I've picked up a second one from a fitting.",
    priceEur: 110,
    category: "Woods & hybrids",
    condition: "Excellent",
    county: "Down",
    createdAt: "2026-08-02T10:35:00.000Z",
    seller: SELLERS.darren,
  },
  {
    id: "13",
    slug: "galvin-green-waterproof-jacket-l",
    title: "Galvin Green Waterproof Jacket, Size L",
    description:
      "Full Gore-Tex jacket, worn maybe half a dozen rounds. Still fully waterproof, no marks. Navy colourway.",
    priceEur: 140,
    category: "Shoes & apparel",
    condition: "Excellent",
    county: "Kildare",
    createdAt: "2026-07-30T14:15:00.000Z",
    seller: SELLERS.colm,
  },
  {
    id: "14",
    slug: "vokey-sm10-wedge-set-52-56-60",
    title: "Titleist Vokey SM10 Wedge Set, 52/56/60",
    description:
      "Full three-wedge set, matching grinds, S200 shafts. Light rust starting on the raw finish (expected, not a fault) — grooves are still crisp.",
    priceEur: 210,
    category: "Wedges",
    condition: "Good",
    county: "Kerry",
    createdAt: "2026-07-27T09:00:00.000Z",
    seller: SELLERS.sinead,
  },
] satisfies MockListing[];

/**
 * Pure, framework-free filter/sort over the in-memory fixture — mirrors the
 * shape of the real `listings` query in the pre-existing (now retired)
 * database-backed marketplace page, so swapping this out for a real
 * Supabase call later is a like-for-like replacement. Exported directly so
 * it's trivial to unit test without rendering anything.
 */
export function listMockListings(filters: MockListingFilters = {}): MockListing[] {
  const q = filters.q?.trim().toLowerCase();
  const { category, county, sort = "recent" } = filters;

  const filtered = MOCK_LISTINGS.filter((listing) => {
    if (
      q &&
      !listing.title.toLowerCase().includes(q) &&
      !listing.description.toLowerCase().includes(q)
    ) {
      return false;
    }
    if (category && listing.category !== category) return false;
    if (county && listing.county !== county) return false;
    return true;
  });

  const sorted = filtered.slice();
  if (sort === "price_low") {
    sorted.sort((a, b) => a.priceEur - b.priceEur);
  } else if (sort === "price_high") {
    sorted.sort((a, b) => b.priceEur - a.priceEur);
  } else {
    sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  return sorted;
}

export function getMockListingBySlug(slug: string): MockListing | undefined {
  return MOCK_LISTINGS.find((listing) => listing.slug === slug);
}

/** Other active listings from the same seller, for the detail page's "more
 * from this seller" rail — excludes the listing being viewed itself. */
export function listMockListingsBySeller(sellerName: string, excludeSlug: string): MockListing[] {
  return MOCK_LISTINGS.filter(
    (listing) => listing.seller.name === sellerName && listing.slug !== excludeSlug
  );
}
