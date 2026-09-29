import { asId, authenticateAppRequest, unauthenticated } from "@/lib/app-api";
import {
  ImageProcessingError,
  deleteMessageImage,
  uploadMessageImage,
} from "@/lib/images/upload";
import { sendMessageTo } from "@/lib/messaging-server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Conversation } from "@/lib/types";

/**
 * POST /api/app/messages/photo
 *
 * A photo sent into a conversation, with an optional caption. Multipart:
 * `conversation_id`, `file`, and an optional `body`.
 *
 * WHY THIS IS ONE REQUEST AND NOT TWO. The obvious shape — upload here, then
 * POST /api/app/messages with the path — leaves a window where the photo is
 * in Storage and no message points at it. A phone that loses signal between
 * the two calls leaves an orphan behind every time, and nothing would ever
 * collect them. Doing both here means the failure has somewhere to be
 * handled: if the send fails, the object this request just created is
 * removed again, below.
 *
 * WHY THE ADMIN CLIENT UPLOADS. `message-images` is private and gives
 * `authenticated` no insert policy at all (0086) — the service role is the
 * only writer, so there is exactly one path a photo can take into that
 * bucket and it runs through sharp. That is stricter than `listing-images`,
 * which lets a member's own client write into their own folder, and it is
 * stricter on purpose: a photo sent in a chat is usually taken on the spot,
 * and EXIF taken on the spot is a home address.
 *
 * Because the admin client bypasses RLS, participation is checked here
 * explicitly, against the member's OWN client, before anything is written.
 * Skipping that would let anyone with a token drop a file into any
 * conversation's folder.
 *
 * The send itself is the same sendMessageTo() the website and the JSON route
 * both use — same rate limit, same card-number rule, same block check, same
 * broadcasts, same notification.
 */
export async function POST(request: Request) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json(
      { error: "Expected a multipart form with a photo." },
      { status: 400 }
    );
  }

  const conversationId = asId(form.get("conversation_id"));
  if (conversationId === null) {
    return Response.json(
      { error: "conversation_id must be a positive integer" },
      { status: 400 }
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "No photo received." }, { status: 400 });
  }

  const raw = form.get("body");
  const body = typeof raw === "string" ? raw : "";

  // Read with the MEMBER's client, so RLS answers the question. A
  // conversation they are not in comes back as nothing, exactly as it would
  // to any other query they made.
  const { data: conversation } = await auth.supabase
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .maybeSingle<Pick<Conversation, "id">>();

  if (!conversation) {
    return Response.json({ error: "Conversation not found." }, { status: 404 });
  }

  const admin = createAdminClient();

  let imagePath: string;
  try {
    imagePath = await uploadMessageImage(admin, conversationId, file);
  } catch (err) {
    // ImageProcessingError's messages are written for the member — "Photos
    // must be under 5MB" — so they go straight through. 422: the request was
    // understood, the photo is the problem, and it is the member who can fix
    // it.
    if (err instanceof ImageProcessingError) {
      return Response.json({ error: err.message, reason: "invalid" }, { status: 422 });
    }
    return Response.json(
      { error: "Couldn't upload that photo — please try again." },
      { status: 500 }
    );
  }

  const result = await sendMessageTo({
    supabase: auth.supabase,
    userId: auth.user.id,
    conversationId,
    body,
    imagePath,
  });

  if (!result.ok) {
    // The photo is already in Storage and no message will ever reference it.
    // Take it back out rather than leaving it for nobody.
    await deleteMessageImage(admin, imagePath);

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

    return Response.json({ error: result.message, reason: result.reason }, { status });
  }

  return Response.json({ message: result.value }, { status: 201 });
}
