"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  fetchMarketplaceListings,
  decodeMarketplaceCursor,
  type MarketplaceFilters,
  type MarketplaceSearchResult,
} from "@/lib/marketplace-discovery";

/**
 * Favourite/un-favourite toggle for a marketplace listing card
 * (favourite-button.tsx). `listing_favourites` (0037) was added in an
 * earlier phase but never read or written by any app code until now — its
 * RLS ("users manage their own favourites", auth.uid() = user_id for every
 * operation) already does all the authorization work here; this action just
 * has to find out which way to toggle.
 */
export async function toggleFavourite(listingId: number): Promise<{ favourited: boolean } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Sign in to save favourites." };
  }

  const { data: existing } = await supabase
    .from("listing_favourites")
    .select("id")
    .eq("listing_id", listingId)
    .eq("user_id", user.id)
    .maybeSingle<{ id: number }>();

  if (existing) {
    const { error } = await supabase.from("listing_favourites").delete().eq("id", existing.id);
    if (error) return { error: "Couldn't remove that favourite — please try again." };
    revalidatePath("/marketplace");
    return { favourited: false };
  }

  const { error } = await supabase.from("listing_favourites").insert({ listing_id: listingId, user_id: user.id });
  if (error) return { error: "Couldn't save that favourite — please try again." };
  revalidatePath("/marketplace");
  return { favourited: true };
}

/**
 * The "Load more" step of cursor pagination (load-more-listings.tsx) — the
 * initial page's worth of results is server-rendered directly by
 * ./page.tsx; every batch after that (session-local, not URL-driven — see
 * that file's header comment on why) comes through this action so it stays
 * a real server-side query against the same indexed RPC, not a client-side
 * fetch of a public API route.
 */
export async function loadMoreListings(
  filters: MarketplaceFilters,
  cursorRaw: string
): Promise<MarketplaceSearchResult | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const cursor = decodeMarketplaceCursor(cursorRaw, filters.sort);
  if (!cursor) {
    // A stale/tampered cursor (e.g. the sort changed since it was issued) —
    // nothing more to safely load under these exact filters.
    return { listings: [], nextCursor: null };
  }

  try {
    return await fetchMarketplaceListings(supabase, filters, cursor, user?.id ?? null);
  } catch {
    return { error: "Couldn't load more listings — please try again." };
  }
}
