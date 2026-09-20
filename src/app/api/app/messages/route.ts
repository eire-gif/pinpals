import {
  asId,
  authenticateAppRequest,
  readJson,
  unauthenticated,
} from "@/lib/app-api";
import { sendMessageTo } from "@/lib/messaging-server";

/**
 * POST /api/app/messages
 *
 * A member sends a message from the app. Identical in every respect to the
 * website's own message form — same rate limit, same card-number rule, same
 * block check, same live broadcast, same notification — because both call
 * sendMessageTo().
 *
 * There is no GET here. Reading a conversation is a plain Supabase query the
 * app makes for itself: RLS already scopes `conversations` and `messages` to
 * their participants, so a route in front of them would add a hop and decide
 * nothing. Writing is different — the two broadcasts and the notification
 * that follow an insert live in TypeScript on this server, and an app that
 * inserted directly would deliver a message nobody was told about. Same
 * reasoning as /api/app/tee-times/invites; see mobile/src/lib/api.ts.
 */
export async function POST(request: Request) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const body = await readJson<Record<string, unknown>>(request);
  if (!body) {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const conversationId = asId(body.conversation_id);
  if (conversationId === null) {
    return Response.json(
      { error: "conversation_id must be a positive integer" },
      { status: 400 }
    );
  }

  const result = await sendMessageTo({
    supabase: auth.supabase,
    userId: auth.user.id,
    conversationId,
    // Not coerced with String(): a client sending a number or an object for
    // `body` has sent something this route does not understand, and turning
    // it into "[object Object]" would post that to a real conversation.
    body: typeof body.body === "string" ? body.body : "",
  });

  if (!result.ok) {
    // 422 rather than 400 for "invalid": the request was well-formed JSON
    // this route understood, and the app should show the message — "that
    // looks like a card number" is for the member, not for the log. 429
    // carries its own meaning and the app backs off.
    const status =
      result.reason === "rate_limited"
        ? 429
        : result.reason === "invalid"
          ? 422
          : result.reason === "not_found"
            ? 404
            : result.reason === "forbidden"
              ? 403
              : 500;

    return Response.json(
      { error: result.message, reason: result.reason },
      { status }
    );
  }

  return Response.json({ message: result.value }, { status: 201 });
}
