"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { isFeedbackTag, rpcMessage, FEEDBACK_MAX_LENGTH } from "@/lib/marketplace-cash";

/**
 * The cash marketplace's two writes from the website (0160). Each is one RPC
 * that checks who may do it — a Server Action is a public endpoint, so
 * nothing here trusts the form beyond shaping its values. A refusal comes
 * back as the page with ?error=<the database's own sentence>.
 */

function back(path: string, error: string): never {
  redirect(`${path}?error=${encodeURIComponent(error)}`);
}

export async function markSoldAction(formData: FormData): Promise<void> {
  const listingId = Number(formData.get("listing_id"));
  if (!Number.isInteger(listingId) || listingId <= 0) redirect("/marketplace");
  const path = `/marketplace/${listingId}/sold`;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${path}`);

  const buyer = String(formData.get("buyer") ?? "");
  if (!buyer) back(path, "Pick who bought it, or Sold somewhere else.");
  const buyerId = buyer === "elsewhere" ? null : buyer;

  const rawPrice = String(formData.get("final_price") ?? "").replace(/[^0-9.,]/g, "").replace(",", ".");
  let priceCents: number | null = null;
  if (rawPrice) {
    const euros = Number.parseFloat(rawPrice);
    if (!Number.isFinite(euros) || euros < 0) back(path, "That price doesn't look right — or leave it blank.");
    priceCents = Math.round(euros * 100);
  }

  const { data, error } = await supabase.rpc("mark_listing_sold", {
    p_listing_id: listingId,
    p_buyer_id: buyerId,
    p_final_price_cents: priceCents,
  });
  if (error || typeof data !== "number") back(path, rpcMessage(error, "Couldn't mark it sold. Please try again."));

  revalidatePath(`/marketplace/${listingId}`);
  revalidatePath("/marketplace");
  redirect(buyerId ? `/marketplace/feedback/${data}` : `/marketplace/${listingId}`);
}

export async function leaveFeedbackAction(formData: FormData): Promise<void> {
  const saleId = Number(formData.get("sale_id"));
  if (!Number.isInteger(saleId) || saleId <= 0) redirect("/marketplace");
  const path = `/marketplace/feedback/${saleId}`;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${path}`);

  const verdict = formData.get("verdict");
  if (verdict !== "good" && verdict !== "bad") back(path, "Choose Good or Not good first.");
  const tags = formData.getAll("tags").map(String).filter(isFeedbackTag);
  const body = String(formData.get("body") ?? "").trim().slice(0, FEEDBACK_MAX_LENGTH);

  const { error } = await supabase.rpc("leave_marketplace_feedback", {
    p_sale_id: saleId,
    p_positive: verdict === "good",
    p_tags: tags,
    p_body: body || null,
  });
  if (error) back(path, rpcMessage(error, "Couldn't send that. Please try again."));

  revalidatePath(path);
  redirect(path);
}

export async function declineSaleAction(formData: FormData): Promise<void> {
  const saleId = Number(formData.get("sale_id"));
  if (!Number.isInteger(saleId) || saleId <= 0) redirect("/marketplace");
  const path = `/marketplace/feedback/${saleId}`;

  const supabase = await createClient();
  const { error } = await supabase.rpc("decline_marketplace_sale", { p_sale_id: saleId });
  if (error) back(path, rpcMessage(error, "Couldn't do that just now."));

  revalidatePath(path);
  redirect(path);
}
