import { SITE_URL } from "./config";
import { buildThread, type ThreadPostRow, type ThreadSummary } from "./listing-thread";
import type { SmartBrand } from "./smart-search";
import { supabase } from "./supabase";

/**
 * The public questions & offers thread under a listing
 * (0162_listing_questions_offers.sql), and the brand list smart search reads.
 *
 * Every write is an RPC: the database decides who may post what and words
 * the refusal, so these just pass the message through.
 */

export const EMPTY_THREAD: ThreadSummary = { entries: [], questions: 0, offers: 0, openOffers: 0, highestOpenCents: null, total: 0 };

export async function loadThread(listingId: number): Promise<ThreadSummary> {
  const { data, error } = await supabase.rpc("listing_public_posts", { p_listing_id: listingId });
  if (error) throw new Error("Couldn't load the questions and offers.");
  return buildThread((data ?? []) as ThreadPostRow[]);
}

function fail(error: { message?: string } | null, fallback: string): never {
  const message = error?.message?.trim();
  // Database refusals are written for members; anything technical isn't.
  throw new Error(message && message.length < 160 && !/[_(){}]|violates|syntax/i.test(message) ? message : fallback);
}

export async function askQuestion(listingId: number, body: string): Promise<void> {
  const { error } = await supabase.rpc("post_listing_question", { p_listing_id: listingId, p_body: body });
  if (error) fail(error, "Couldn't post your question. Try again.");
}

export async function makeOffer(listingId: number, amountCents: number, note?: string): Promise<void> {
  const { error } = await supabase.rpc("post_listing_offer", { p_listing_id: listingId, p_amount_cents: amountCents, p_note: note?.trim() || null });
  if (error) fail(error, "Couldn't post your offer. Try again.");
}

export async function replyTo(postId: number, body: string): Promise<void> {
  const { error } = await supabase.rpc("reply_to_listing_post", { p_post_id: postId, p_body: body });
  if (error) fail(error, "Couldn't post your reply. Try again.");
}

export async function answerOffer(postId: number, action: "accept" | "decline" | "counter", counterCents?: number, note?: string): Promise<void> {
  const { error } = await supabase.rpc("answer_listing_offer", {
    p_post_id: postId,
    p_action: action,
    p_counter_cents: action === "counter" ? counterCents ?? null : null,
    p_note: note?.trim() || null,
  });
  if (error) fail(error, "Couldn't answer that offer. Try again.");
}

export async function withdrawOffer(postId: number): Promise<void> {
  const { error } = await supabase.rpc("withdraw_listing_offer", { p_post_id: postId });
  if (error) fail(error, "Couldn't withdraw your offer. Try again.");
}

export async function removePost(postId: number): Promise<void> {
  const { error } = await supabase.rpc("remove_listing_post", { p_post_id: postId });
  if (error) fail(error, "Couldn't remove that. Try again.");
}

// ---------------------------------------------------------------------------
// Brands for smart search
// ---------------------------------------------------------------------------

let brandCache: SmartBrand[] | null = null;
let brandPending: Promise<SmartBrand[]> | null = null;

/**
 * Every curated brand with its aliases ("tm", "Taylor Made"), once per launch.
 * From the website's /api/brands?all=1; if that's unreachable, the brand table
 * itself (labels only), so search still knows brand names.
 */
export function loadSmartBrands(): Promise<SmartBrand[]> {
  if (brandCache) return Promise.resolve(brandCache);
  brandPending ??= (async () => {
    try {
      const response = await fetch(`${SITE_URL}/api/brands?all=1`);
      if (response.ok) {
        const { brands } = (await response.json()) as { brands?: SmartBrand[] };
        if (brands?.length) return (brandCache = brands);
      }
    } catch {
      // Fall through to the table.
    }
    const { data } = await supabase.from("marketplace_brands").select("id, label").eq("is_fallback", false);
    brandCache = ((data ?? []) as { id: string; label: string }[]).map((b) => ({ id: b.id, label: b.label, aliases: [] }));
    brandPending = null;
    return brandCache;
  })();
  return brandPending;
}

/** Asking prices of comparable items on sale now, for "similar ads are priced…". */
export async function similarAskingPrices(category: string, brand: string | null, model: string | null): Promise<number[]> {
  if (!category) return [];
  let query = supabase.from("listings").select("price_cents").eq("status", "active").eq("category", category).not("price_cents", "is", null).limit(60);
  if (brand) query = query.eq("brand", brand);
  const first = model?.split(" ")[0];
  if (brand && first && first.length >= 2) query = query.ilike("model", `%${first.replace(/[%_]/g, "")}%`);
  const { data } = await query;
  return ((data ?? []) as { price_cents: number | null }[]).map((r) => r.price_cents ?? 0).filter((p) => p > 0);
}
