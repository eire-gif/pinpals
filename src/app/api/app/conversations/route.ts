import {
  authenticateAppRequest,
  badRequest,
  readJson,
  unauthenticated,
} from "@/lib/app-api";
import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";
import type { Conversation } from "@/lib/types";

/**
 * POST /api/app/conversations
 *
 * Finds or starts the conversation between the caller and another member,
 * and returns its id. The app's member directory and connections screens
 * both need it: a "Message" button has to land on a thread, and a thread has
 * to exist before it can be landed on.
 *
 * WHY THIS IS A ROUTE AND NOT A CLIENT INSERT. Two things the app must not
 * be the second opinion on.
 *
 * `can_message()` (0025, folded together with is_blocked() in 0049) is what
 * decides whether a pair may talk at all — connected, mid-offer, or sharing
 * an accepted tee-time interest. It is enforced by the INSERT policy, so a
 * client insert would be refused correctly; what the client could not do is
 * explain the refusal in the same words the website uses.
 *
 * The rate limit is the real reason. Starting conversations is the one
 * messaging action a script would use to probe who is eligible to be
 * messaged, one member at a time. That ceiling lives on the server, and an
 * app that inserted directly would simply not have it.
 *
 * The pair is ordered before it is used, because `conversations` stores a
 * sorted (user_a_id, user_b_id) and a unique index on it — the same sort the
 * website's startConversation() does, for the same reason.
 */

const START_CONVERSATION_MAX_ATTEMPTS = 20;
const START_CONVERSATION_WINDOW_SECONDS = 3600;

export async function POST(request: Request) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const body = await readJson<{ other_user_id?: unknown; listing_id?: unknown }>(request);
  const otherUserId = body?.other_user_id;
  // Optional: a thread about one listing (0160). Anyone may start one with
  // the seller of an on-sale listing; the insert policy checks that, not us.
  const rawListing = body?.listing_id;
  const listingId =
    typeof rawListing === "number" && Number.isInteger(rawListing) && rawListing > 0 ? rawListing : null;
  if (rawListing !== undefined && rawListing !== null && listingId === null) {
    return badRequest("listing_id must be a positive integer");
  }
  if (typeof otherUserId !== "string" || otherUserId.trim() === "") {
    return badRequest("other_user_id is required");
  }
  if (otherUserId === auth.user.id) {
    return Response.json({ error: "You can't message yourself." }, { status: 422 });
  }

  const rateLimit = await checkRateLimit({
    action: "start-conversation",
    identifier: auth.user.id,
    maxHits: START_CONVERSATION_MAX_ATTEMPTS,
    windowSeconds: START_CONVERSATION_WINDOW_SECONDS,
  });
  if (!rateLimit.allowed) {
    return Response.json(
      { error: rateLimitMessage(rateLimit.retryAfterSeconds), reason: "rate_limited" },
      { status: 429 }
    );
  }

  const [a, b] = [auth.user.id, otherUserId].sort();

  // One thread per pair, plus one per pair per listing (0049) — the same
  // lookup the website's startConversation() does. `.is(null)` keeps a plain
  // "Message" from landing in somebody's listing thread.
  let lookup = auth.supabase.from("conversations").select("id").eq("user_a_id", a).eq("user_b_id", b);
  lookup = listingId ? lookup.eq("listing_id", listingId) : lookup.is("listing_id", null);
  const { data: existing } = await lookup.maybeSingle<Pick<Conversation, "id">>();

  if (existing) {
    return Response.json({ conversation_id: existing.id }, { status: 200 });
  }

  const { data: created, error } = await auth.supabase
    .from("conversations")
    .insert({ user_a_id: a, user_b_id: b, listing_id: listingId })
    .select("id")
    .single<Pick<Conversation, "id">>();

  if (error || !created) {
    // can_message() (or, for a listing, can_message_about_listing()) is what
    // rejected this, so the message is the website's wording for the refusal.
    return Response.json(
      {
        error: listingId
          ? "That listing isn't for sale any more, so you can't message the seller about it."
          : "You can only message a golfer you're connected with, have exchanged a marketplace offer with, or have an accepted tee-time interest with.",
        reason: "forbidden",
      },
      { status: 403 }
    );
  }

  return Response.json({ conversation_id: created.id }, { status: 201 });
}
