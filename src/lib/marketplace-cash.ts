import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The cash marketplace, website side (0160_cash_marketplace.sql). Mirrors
 * mobile/src/lib/marketplace-cash.ts — the vocabulary has to agree with the
 * CHECK constraint on marketplace_feedback.tags, and there is no shared
 * package between the two.
 *
 * Every write is an RPC that checks who may do it and words its own refusal;
 * these helpers only shape the rows for the pages.
 */

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

export const TAGS_FOR: Record<"seller" | "buyer", FeedbackTag[]> = {
  seller: ["as_described", "quick_reply", "fair_price", "on_time", "friendly", "well_packed"],
  buyer: ["paid_promptly", "on_time", "quick_reply", "easy_to_deal", "friendly"],
};

export const isFeedbackTag = (value: string): value is FeedbackTag => value in FEEDBACK_TAG_LABELS;

export const FEEDBACK_MAX_LENGTH = 500;

export type MemberRecord = {
  positive: number;
  negative: number;
  sales: number;
  tags: { tag: FeedbackTag; count: number }[];
};

export const EMPTY_RECORD: MemberRecord = { positive: 0, negative: 0, sales: 0, tags: [] };

export async function memberRecord(supabase: SupabaseClient, memberId: string): Promise<MemberRecord> {
  const { data, error } = await supabase.rpc("marketplace_member_stats", { p_member: memberId });
  const row = (data as { positive: number; negative: number; sales: number; tag_counts: Record<string, number> | null }[] | null)?.[0];
  if (error || !row) return EMPTY_RECORD;
  return {
    positive: row.positive,
    negative: row.negative,
    sales: row.sales,
    tags: Object.entries(row.tag_counts ?? {})
      .filter(([tag]) => isFeedbackTag(tag))
      .map(([tag, count]) => ({ tag: tag as FeedbackTag, count: Number(count) }))
      .sort((a, b) => b.count - a.count),
  };
}

/** "98% positive", or null with no feedback yet. */
export function positiveShare(record: MemberRecord): string | null {
  const total = record.positive + record.negative;
  return total === 0 ? null : `${Math.round((record.positive / total) * 100)}% positive`;
}

export type FeedbackEntry = {
  id: number;
  positive: boolean;
  tags: FeedbackTag[];
  body: string | null;
  createdAt: string;
  role: "seller" | "buyer";
  reviewerName: string;
  reviewerAvatarColor: string | null;
  itemTitle: string;
};

export async function memberFeedback(
  supabase: SupabaseClient,
  memberId: string,
  limit = 20,
  beforeId: number | null = null
): Promise<FeedbackEntry[]> {
  const { data, error } = await supabase.rpc("marketplace_member_feedback", {
    p_member: memberId,
    p_limit: limit,
    p_before_id: beforeId,
  });
  if (error) return [];
  return (
    (data as
      | {
          id: number;
          positive: boolean;
          tags: string[];
          body: string | null;
          created_at: string;
          reviewee_role: "seller" | "buyer";
          reviewer_name: string;
          reviewer_avatar_color: string | null;
          item_title: string;
        }[]
      | null) ?? []
  ).map((row) => ({
    id: row.id,
    positive: row.positive,
    tags: row.tags.filter(isFeedbackTag),
    body: row.body,
    createdAt: row.created_at,
    role: row.reviewee_role,
    reviewerName: row.reviewer_name,
    reviewerAvatarColor: row.reviewer_avatar_color,
    itemTitle: row.item_title,
  }));
}

export type SaleSummary = {
  saleId: number;
  listingId: number;
  title: string;
  imageUrl: string | null;
  myRole: "seller" | "buyer";
  other: { id: string; name: string; avatarColor: string | null } | null;
  closesAt: string;
  /** Past the 30 days feedback stays open. */
  closed: boolean;
  declined: boolean;
  iLeft: boolean;
  theyLeft: boolean;
};

export async function saleSummary(supabase: SupabaseClient, saleId: number): Promise<SaleSummary | null> {
  const { data, error } = await supabase.rpc("marketplace_sale_summary", { p_sale_id: saleId });
  const row = (
    data as
      | {
          sale_id: number;
          listing_id: number;
          title: string;
          image_url: string | null;
          my_role: "seller" | "buyer";
          other_id: string | null;
          other_name: string | null;
          other_avatar_color: string | null;
          closes_at: string;
          declined: boolean;
          i_left: boolean;
          they_left: boolean;
        }[]
      | null
  )?.[0];
  if (error || !row) return null;
  return {
    saleId: row.sale_id,
    listingId: row.listing_id,
    title: row.title,
    imageUrl: row.image_url,
    myRole: row.my_role,
    other: row.other_id ? { id: row.other_id, name: row.other_name || "A member", avatarColor: row.other_avatar_color } : null,
    closesAt: row.closes_at,
    closed: Date.parse(row.closes_at) < Date.now(),
    declined: row.declined,
    iLeft: row.i_left,
    theyLeft: row.they_left,
  };
}

export type PossibleBuyer = { id: string; name: string; avatarColor: string | null; aboutListing: boolean };

export async function possibleBuyers(supabase: SupabaseClient, listingId: number): Promise<PossibleBuyer[]> {
  const { data, error } = await supabase.rpc("marketplace_possible_buyers", { p_listing_id: listingId });
  if (error) return [];
  return (
    (data as { member_id: string; name: string; avatar_color: string | null; about_listing: boolean }[] | null) ?? []
  ).map((row) => ({ id: row.member_id, name: row.name || "A member", avatarColor: row.avatar_color, aboutListing: row.about_listing }));
}

/** Our RPCs raise plain sentences; anything else gets the fallback. */
export function rpcMessage(error: { message?: string } | null, fallback: string): string {
  const text = error?.message?.trim();
  return text && /^[A-Z][^_{}]*[.?!]$/.test(text) ? text : fallback;
}
