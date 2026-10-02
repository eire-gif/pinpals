import { discardStagedPostPhoto, stagePostPhoto, statusForFeedFailure } from "@/lib/feed-operations";
import { createClient } from "@/lib/supabase/server";

/**
 * POST   /feed/photo  — stage one photo for a post being written (multipart, `file`)
 * DELETE /feed/photo  — discard one, when it is removed from the composer ({ path })
 *
 * A Route Handler rather than a Server Action because a Server Action caps
 * its request body at 1MB, and a phone photo is several. The composer
 * downscales before sending, and sends one photo per request, so each stays
 * well inside Vercel's 4.5MB limit too. Session from the cookie, exactly as
 * a Server Action would have it.
 */

async function signedIn() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function POST(request: Request) {
  const user = await signedIn();
  if (!user) return Response.json({ error: "Please sign in again." }, { status: 401 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Expected a photo." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "No photo received." }, { status: 400 });

  const result = await stagePostPhoto({ userId: user.id, file });
  if (!result.ok) {
    return Response.json({ error: result.message, reason: result.reason }, { status: statusForFeedFailure(result.reason) });
  }
  return Response.json(result.value);
}

export async function DELETE(request: Request) {
  const user = await signedIn();
  if (!user) return Response.json({ error: "Please sign in again." }, { status: 401 });

  let path: unknown;
  try {
    path = ((await request.json()) as { path?: unknown }).path;
  } catch {
    return Response.json({ error: "Expected a path." }, { status: 400 });
  }
  if (typeof path !== "string") return Response.json({ error: "Expected a path." }, { status: 400 });

  const result = await discardStagedPostPhoto({ userId: user.id, path });
  // Not found is still "it's gone", which is all the composer wanted.
  return Response.json({ ok: result.ok || result.reason === "not_found" });
}
