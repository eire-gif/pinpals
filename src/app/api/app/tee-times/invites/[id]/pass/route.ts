import { asId, authenticateAppRequest, badRequest, unauthenticated } from "@/lib/app-api";
import { passTeeTimePlace } from "@/lib/tee-time-groups";

/**
 * POST /api/app/tee-times/invites/[id]/pass   → { passed: true }
 *
 * "Can't make it" on a group invitation (0186). Nothing moves and nobody is
 * told; the alert just stops asking.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const id = asId((await params).id);
  if (id === null) return badRequest("Tee time id must be a positive integer.");

  const ok = await passTeeTimePlace(auth.supabase, id);
  return ok
    ? Response.json({ passed: true })
    : Response.json({ error: "Couldn't do that — please try again.", reason: "failed" }, { status: 500 });
}
