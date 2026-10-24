import { asId, authenticateAppRequest, unauthenticated } from "@/lib/app-api";
import { createAdminClient } from "@/lib/supabase/admin";
import { myVerification, submitVerification, VerificationError } from "@/lib/verification/server";

/**
 * /api/app/verification — the Verified golfer check (0188).
 *
 * GET   the member's own state
 * POST  multipart: `file` (photo of the card), `number`, `club_name`,
 *       optional `club_id`. Runs the AI check and answers with the result —
 *       verified, rejected (with a reason) or needs_review.
 *
 * The website's own page (/profile/verify) posts here too, with the
 * member's session token, so there is one way in.
 */

export const dynamic = "force-dynamic";
// The card check is one model call; give it room on a slow day.
export const maxDuration = 60;

export async function GET(request: Request) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();
  return Response.json(await myVerification(auth.supabase, auth.user.id));
}

export async function POST(request: Request) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Expected a photo of your card." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "Add a photo of your membership card." }, { status: 400 });
  }

  try {
    const view = await submitVerification({
      admin: createAdminClient(),
      userId: auth.user.id,
      file,
      number: String(form.get("number") ?? ""),
      clubName: String(form.get("club_name") ?? ""),
      clubId: asId(form.get("club_id")),
    });
    return Response.json(view, { status: 200 });
  } catch (err) {
    if (err instanceof VerificationError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
