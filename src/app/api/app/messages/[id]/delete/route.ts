import { asId, authenticateAppRequest, badRequest, unauthenticated } from "@/lib/app-api";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/app/messages/[id]/delete   → { ok: true }
 *
 * "Delete for everyone" (0130). delete_message_for_everyone() runs as the
 * member — it is the one that decides it's their own message and inside 48
 * hours, blanks it, archives the original for moderation and pings the
 * thread. It returns the photo path the message had, and this route removes
 * that file from Storage, which only the service role can do: the sender
 * asked for the photo to be gone, not merely unlinked.
 *
 * ("Delete for me" needs no route — the app calls hide_message_for_me().)
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();
  const id = asId((await params).id);
  if (id === null) return badRequest("id must be a positive integer");

  const { data: imagePath, error } = await auth.supabase.rpc("delete_message_for_everyone", {
    p_message_id: id,
  });
  if (error) {
    const known = /own messages|48 hours|already been removed/.test(error.message);
    return Response.json(
      { error: known ? error.message : "Couldn't delete that message — please try again." },
      { status: known ? 422 : 500 }
    );
  }

  const admin = createAdminClient();

  if (typeof imagePath === "string" && imagePath) {
    // Out of the members' reach, not destroyed: the bucket's read policy
    // admits a member only when the path's first folder is a conversation
    // they're in, and "deleted/" is no conversation. Moderators can still
    // see what was sent if it was reported (message_deletions points here).
    // Best-effort — the message no longer points at it either way.
    const archived = `deleted/${imagePath}`;
    const { error: moveError } = await admin.storage.from("message-images").move(imagePath, archived);
    if (!moveError) {
      await admin.from("message_deletions").update({ image_path: archived }).eq("message_id", id);
    } else {
      await admin.storage.from("message-images").remove([imagePath]).catch(() => undefined);
    }
  }

  // The "Seán sent a message: …" alerts carried a copy of the words.
  await admin.from("notifications").delete().like("dedupe_key", `message:${id}:notify:%`);

  return Response.json({ ok: true });
}
