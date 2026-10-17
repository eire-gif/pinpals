import { useEffect, useState } from "react";

import { isOn } from "./features";
import { supabase } from "./supabase";
import { rowsToCards, CARD_COLUMNS, type Card } from "./marketplace";

/**
 * The cash marketplace (0160_cash_marketplace.sql, Oct 2026).
 *
 * PinPals introduces buyer and seller; they meet and pay each other in cash
 * or by Revolut. What the app adds is trust: the seller marks the item sold
 * and picks who bought it, and both leave feedback — thumbs up or down, a few
 * tags, a comment — that shows in the marketplace only.
 *
 * Every write is an RPC. The database decides who may do what (and words the
 * refusal); these are thin wrappers so the screens read as English.
 */

// ---------------------------------------------------------------------------
// The switch
// ---------------------------------------------------------------------------

let cached: boolean | null = null;
let pending: Promise<boolean> | null = null;

/** Whether the marketplace takes payments. Read once per launch. With the
 *  feature off the app behaves as before 0160, which means it does. */
export function paymentsEnabled(): Promise<boolean> {
  if (!isOn("cashMarketplace")) return Promise.resolve(true);
  if (cached !== null) return Promise.resolve(cached);
  pending ??= (async () => {
    const { data, error } = await supabase.rpc("marketplace_payments_enabled");
    // The website answers "off" when it can't tell, so a failed read here
    // agrees with it rather than offering a checkout the server will refuse.
    cached = error ? false : data === true;
    pending = null;
    return cached;
  })();
  return pending;
}

/** `null` while it loads, then whether checkout exists. */
export function usePaymentsEnabled(): boolean | null {
  const [on, setOn] = useState<boolean | null>(cached ?? (isOn("cashMarketplace") ? null : true));
  useEffect(() => {
    let live = true;
    void paymentsEnabled().then((value) => {
      if (live) setOn(value);
    });
    return () => {
      live = false;
    };
  }, []);
  return on;
}

/** True once we know there is no checkout — the cash screens and wording. */
export function useCashMarketplace(): boolean {
  return usePaymentsEnabled() === false;
}

// ---------------------------------------------------------------------------
// Feedback vocabulary (the CHECK constraint on marketplace_feedback.tags)
// ---------------------------------------------------------------------------

export type FeedbackTag =
  | "as_described"
  | "quick_reply"
  | "fair_price"
  | "on_time"
  | "friendly"
  | "well_packed"
  | "paid_promptly"
  | "easy_to_deal";

export const FEEDBACK_TAG_LABELS: Record<FeedbackTag, string> = {
  as_described: "As described",
  quick_reply: "Quick to reply",
  fair_price: "Fair price",
  on_time: "On time",
  friendly: "Friendly",
  well_packed: "Well packed",
  paid_promptly: "Paid promptly",
  easy_to_deal: "Easy to deal with",
};

/** What the person being reviewed can be praised for, by their role. */
export const TAGS_FOR: Record<"seller" | "buyer", FeedbackTag[]> = {
  seller: ["as_described", "quick_reply", "fair_price", "on_time", "friendly", "well_packed"],
  buyer: ["paid_promptly", "on_time", "quick_reply", "easy_to_deal", "friendly"],
};

export const FEEDBACK_MAX_LENGTH = 500;

/** Pull the sentence out of a Postgres exception raised by our RPCs. */
function message(error: { message?: string } | null, fallback: string): string {
  const text = error?.message?.trim();
  if (!text) return fallback;
  // Our functions raise plain sentences; anything technical gets the fallback.
  return /^[A-Z][^_{}]*[.?!]$/.test(text) ? text : fallback;
}

export class CashError extends Error {}

// ---------------------------------------------------------------------------
// Marking sold
// ---------------------------------------------------------------------------

export type PossibleBuyer = {
  id: string;
  name: string;
  avatarUrl: string | null;
  avatarColor: string | null;
  lastMessageAt: string | null;
  aboutListing: boolean;
};

export async function possibleBuyers(listingId: number): Promise<PossibleBuyer[]> {
  const { data: raw, error } = await supabase.rpc("marketplace_possible_buyers", { p_listing_id: listingId });
  const data = raw as {
        member_id: string;
        name: string;
        avatar_url: string | null;
        avatar_color: string | null;
        last_message_at: string | null;
        about_listing: boolean;
      }[] | null;
  if (error) throw new CashError(message(error, "Couldn't load your chats."));
  return (data ?? []).map((row) => ({
    id: row.member_id,
    name: row.name || "A member",
    avatarUrl: row.avatar_url,
    avatarColor: row.avatar_color,
    lastMessageAt: row.last_message_at,
    aboutListing: row.about_listing,
  }));
}

/** Returns the sale's id. `buyerId` null = sold somewhere else. */
export async function markSold(listingId: number, buyerId: string | null, finalPriceCents: number | null): Promise<number> {
  const { data, error } = await supabase.rpc("mark_listing_sold", {
    p_listing_id: listingId,
    p_buyer_id: buyerId,
    p_final_price_cents: finalPriceCents,
  });
  if (error || typeof data !== "number") throw new CashError(message(error, "Couldn't mark it sold. Please try again."));
  return data;
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

export type SaleSummary = {
  saleId: number;
  listingId: number;
  title: string;
  imageUrl: string | null;
  myRole: "seller" | "buyer";
  other: { id: string; name: string; avatarUrl: string | null; avatarColor: string | null } | null;
  soldAt: string;
  closesAt: string;
  declined: boolean;
  iLeft: boolean;
  theyLeft: boolean;
};

export async function saleSummary(saleId: number): Promise<SaleSummary | null> {
  const { data: raw, error } = await supabase.rpc("marketplace_sale_summary", { p_sale_id: saleId });
  const data = raw as {
        sale_id: number;
        listing_id: number;
        title: string;
        image_url: string | null;
        my_role: "seller" | "buyer";
        other_id: string | null;
        other_name: string | null;
        other_avatar_url: string | null;
        other_avatar_color: string | null;
        sold_at: string;
        closes_at: string;
        declined: boolean;
        i_left: boolean;
        they_left: boolean;
      }[] | null;
  if (error) throw new CashError(message(error, "Couldn't load that sale."));
  const row = data?.[0];
  if (!row) return null;
  return {
    saleId: row.sale_id,
    listingId: row.listing_id,
    title: row.title,
    imageUrl: row.image_url,
    myRole: row.my_role,
    other: row.other_id
      ? { id: row.other_id, name: row.other_name || "A member", avatarUrl: row.other_avatar_url, avatarColor: row.other_avatar_color }
      : null,
    soldAt: row.sold_at,
    closesAt: row.closes_at,
    declined: row.declined,
    iLeft: row.i_left,
    theyLeft: row.they_left,
  };
}

export async function leaveFeedback(saleId: number, positive: boolean, tags: FeedbackTag[], body: string): Promise<void> {
  const { error } = await supabase.rpc("leave_marketplace_feedback", {
    p_sale_id: saleId,
    p_positive: positive,
    p_tags: tags,
    p_body: body.trim() || null,
  });
  if (error) throw new CashError(message(error, "Couldn't send that. Please try again."));
}

export async function declineSale(saleId: number): Promise<void> {
  const { error } = await supabase.rpc("decline_marketplace_sale", { p_sale_id: saleId });
  if (error) throw new CashError(message(error, "Couldn't do that just now."));
}

export type MemberStats = {
  positive: number;
  negative: number;
  sales: number;
  tags: { tag: FeedbackTag; count: number }[];
};

export const EMPTY_STATS: MemberStats = { positive: 0, negative: 0, sales: 0, tags: [] };

export async function memberStats(memberId: string): Promise<MemberStats> {
  const { data: raw, error } = await supabase.rpc("marketplace_member_stats", { p_member: memberId });
  const data = raw as { positive: number; negative: number; sales: number; tag_counts: Record<string, number> | null }[] | null;
  const row = data?.[0];
  if (error || !row) return EMPTY_STATS;
  return {
    positive: row.positive,
    negative: row.negative,
    sales: row.sales,
    tags: Object.entries(row.tag_counts ?? {})
      .filter(([tag]) => tag in FEEDBACK_TAG_LABELS)
      .map(([tag, count]) => ({ tag: tag as FeedbackTag, count: Number(count) }))
      .sort((a, b) => b.count - a.count),
  };
}

/** "100% positive", or null with nothing to go on yet. */
export function positiveShare(stats: MemberStats): string | null {
  const total = stats.positive + stats.negative;
  if (total === 0) return null;
  return `${Math.round((stats.positive / total) * 100)}% positive`;
}

export type FeedbackEntry = {
  id: number;
  positive: boolean;
  tags: FeedbackTag[];
  body: string | null;
  createdAt: string;
  role: "seller" | "buyer";
  reviewerName: string;
  reviewerAvatarUrl: string | null;
  reviewerAvatarColor: string | null;
  itemTitle: string;
};

export const FEEDBACK_PAGE = 20;

export async function memberFeedback(memberId: string, beforeId: number | null = null): Promise<FeedbackEntry[]> {
  const { data: raw, error } = await supabase.rpc("marketplace_member_feedback", { p_member: memberId, p_limit: FEEDBACK_PAGE, p_before_id: beforeId });
  const data = raw as {
        id: number;
        positive: boolean;
        tags: string[];
        body: string | null;
        created_at: string;
        reviewee_role: "seller" | "buyer";
        reviewer_name: string;
        reviewer_avatar_url: string | null;
        reviewer_avatar_color: string | null;
        item_title: string;
      }[] | null;
  if (error) return [];
  return (data ?? []).map((row) => ({
    id: row.id,
    positive: row.positive,
    tags: row.tags.filter((t): t is FeedbackTag => t in FEEDBACK_TAG_LABELS),
    body: row.body,
    createdAt: row.created_at,
    role: row.reviewee_role,
    reviewerName: row.reviewer_name,
    reviewerAvatarUrl: row.reviewer_avatar_url,
    reviewerAvatarColor: row.reviewer_avatar_color,
    itemTitle: row.item_title,
  }));
}

/** Sales of mine (either side) still waiting for my feedback. */
export type FeedbackDue = { saleId: number; title: string; imageUrl: string | null; otherRole: "seller" | "buyer" };

export async function feedbackDue(userId: string): Promise<FeedbackDue[]> {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const [{ data: sales }, { data: mine }] = await Promise.all([
    supabase
      .from("marketplace_sales")
      .select("id, seller_id, buyer_id, listings (title, image_url)")
      .not("buyer_id", "is", null)
      .is("buyer_declined_at", null)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(20)
      .overrideTypes<{ id: number; seller_id: string; buyer_id: string; listings: { title: string; image_url: string | null } | null }[]>(),
    supabase.from("marketplace_feedback").select("sale_id").eq("reviewer_id", userId).overrideTypes<{ sale_id: number }[]>(),
  ]);
  const done = new Set((mine ?? []).map((r) => r.sale_id));
  return (sales ?? [])
    .filter((s) => !done.has(s.id))
    .map((s) => ({
      saleId: s.id,
      title: s.listings?.title ?? "Your sale",
      imageUrl: s.listings?.image_url ?? null,
      otherRole: s.seller_id === userId ? "buyer" : "seller",
    }));
}

/** Listings I've saved (the heart), newest first, as cards. */
export async function savedListings(userId: string): Promise<Card[]> {
  const { data } = await supabase
    .from("listing_favourites")
    .select(`created_at, listings (${CARD_COLUMNS})`)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(60)
    .overrideTypes<{ created_at: string; listings: unknown }[]>();
  const rows = (data ?? []).map((r) => r.listings).filter((r): r is NonNullable<typeof r> => !!r);
  return rowsToCards(rows, userId);
}
