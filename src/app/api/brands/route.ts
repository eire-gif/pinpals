import { NextResponse } from "next/server";

import { sellableBrandsFor } from "@/lib/marketplace-brands";

/**
 * The brands a seller may choose for a category, for the app's listing form.
 *
 * Exactly what the website's own brand picker offers: sellableBrandsFor() is
 * the function behind brand-combobox.tsx, so the two forms cannot end up
 * offering different lists. Include the subcategory where there is one —
 * "Rangefinders / GPS" offers Bushnell and Garmin but not Titleist, and the
 * narrowing happens in there, not here.
 *
 * Served rather than bundled into the app, for the same reason as
 * /api/regions: src/data/golf-brands.json is a hand-maintained list that
 * gets brands added to it, and a copy inside a binary that takes a week to
 * ship would be a second source of truth with no way to tell which was
 * right. `listings.brand` carries a foreign key into marketplace_brands
 * (0060), so a stale app offering a brand the database no longer knows
 * would fail at insert rather than fail politely.
 *
 * Public and unauthenticated, like /api/regions and /api/clubs: it is a list
 * of manufacturers already rendered on every marketplace filter.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const category = params.get("category") ?? "";
  const subcategory = params.get("subcategory");

  const brands = sellableBrandsFor(category, subcategory);

  // An unknown category returns an empty list rather than a 400. The app
  // asks for brands the moment a category is chosen, and a 400 there would
  // turn a typo in a query string into an error in front of a member who is
  // simply filling in a form.
  return NextResponse.json(
    { brands: brands.map((brand) => ({ id: brand.id, label: brand.label })) },
    {
      // Changes only when someone edits the JSON and redeploys, so a long
      // shared cache is free and keeps repeated form opens off the server.
      headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" },
    }
  );
}
