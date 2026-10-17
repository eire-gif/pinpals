"use server";

import { revalidatePath } from "next/cache";

import { parseEuroInput } from "@/lib/listing-thread";
import { rpcMessage } from "@/lib/marketplace-cash";
import { createClient } from "@/lib/supabase/server";

/**
 * The public questions & offers thread's writes (0162). Each is one RPC that
 * decides who may do it and words any refusal — a Server Action is a public
 * endpoint, so nothing here trusts the form beyond shaping its values.
 * Returns the refusal for the form to show, or null.
 */

export type ThreadActionState = { error: string | null; done: number };

const ok = (prev: ThreadActionState): ThreadActionState => ({ error: null, done: prev.done + 1 });
const fail = (prev: ThreadActionState, error: string): ThreadActionState => ({ error, done: prev.done });

function id(formData: FormData, name: string): number | null {
  const value = Number(formData.get(name));
  return Number.isInteger(value) && value > 0 ? value : null;
}

async function signedIn() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? supabase : null;
}

export async function postToThreadAction(prev: ThreadActionState, formData: FormData): Promise<ThreadActionState> {
  const listingId = id(formData, "listing_id");
  if (!listingId) return fail(prev, "That listing couldn't be found.");
  const supabase = await signedIn();
  if (!supabase) return fail(prev, "Sign in first.");

  const kind = String(formData.get("kind") ?? "question");
  const text = String(formData.get("text") ?? "").trim();

  if (kind === "offer") {
    const cents = parseEuroInput(text);
    if (cents === null) return fail(prev, "Enter your offer in euro, like 220.");
    const { error } = await supabase.rpc("post_listing_offer", { p_listing_id: listingId, p_amount_cents: cents, p_note: null });
    if (error) return fail(prev, rpcMessage(error, "Couldn't post your offer. Please try again."));
  } else {
    if (!text) return fail(prev, "Write your question first.");
    const { error } = await supabase.rpc("post_listing_question", { p_listing_id: listingId, p_body: text.slice(0, 500) });
    if (error) return fail(prev, rpcMessage(error, "Couldn't post your question. Please try again."));
  }

  revalidatePath(`/marketplace/${listingId}`);
  return ok(prev);
}

export async function replyInThreadAction(prev: ThreadActionState, formData: FormData): Promise<ThreadActionState> {
  const listingId = id(formData, "listing_id");
  const postId = id(formData, "post_id");
  if (!listingId || !postId) return fail(prev, "That post couldn't be found.");
  const supabase = await signedIn();
  if (!supabase) return fail(prev, "Sign in first.");
  const text = String(formData.get("text") ?? "").trim();
  if (!text) return fail(prev, "Write your reply first.");

  const { error } = await supabase.rpc("reply_to_listing_post", { p_post_id: postId, p_body: text.slice(0, 500) });
  if (error) return fail(prev, rpcMessage(error, "Couldn't post your reply. Please try again."));
  revalidatePath(`/marketplace/${listingId}`);
  return ok(prev);
}

export async function answerOfferAction(prev: ThreadActionState, formData: FormData): Promise<ThreadActionState> {
  const listingId = id(formData, "listing_id");
  const postId = id(formData, "post_id");
  if (!listingId || !postId) return fail(prev, "That offer couldn't be found.");
  const supabase = await signedIn();
  if (!supabase) return fail(prev, "Sign in first.");

  const action = String(formData.get("action") ?? "");
  if (!["accept", "decline", "counter"].includes(action)) return fail(prev, "Choose accept, decline or counter.");
  let counter: number | null = null;
  if (action === "counter") {
    counter = parseEuroInput(String(formData.get("counter") ?? ""));
    if (counter === null) return fail(prev, "Say what you'd take, like 235.");
  }

  const { error } = await supabase.rpc("answer_listing_offer", {
    p_post_id: postId,
    p_action: action,
    p_counter_cents: counter,
    p_note: null,
  });
  if (error) return fail(prev, rpcMessage(error, "Couldn't answer that offer. Please try again."));
  revalidatePath(`/marketplace/${listingId}`);
  return ok(prev);
}

export async function withdrawOrRemoveAction(prev: ThreadActionState, formData: FormData): Promise<ThreadActionState> {
  const listingId = id(formData, "listing_id");
  const postId = id(formData, "post_id");
  if (!listingId || !postId) return fail(prev, "That post couldn't be found.");
  const supabase = await signedIn();
  if (!supabase) return fail(prev, "Sign in first.");

  const what = String(formData.get("what") ?? "");
  const { error } =
    what === "withdraw"
      ? await supabase.rpc("withdraw_listing_offer", { p_post_id: postId })
      : await supabase.rpc("remove_listing_post", { p_post_id: postId });
  if (error) return fail(prev, rpcMessage(error, "Couldn't do that. Please try again."));
  revalidatePath(`/marketplace/${listingId}`);
  return ok(prev);
}
