import { authenticateAppRequest, badRequest, readJson, unauthenticated } from "@/lib/app-api";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyTeeTimeToken } from "@/lib/tee-time-links";

/**
 * POST /api/app/tee-times/link   { token: string }   → { invite_id }
 *
 * A signed-in member opened a shared tee time link (/t/<token>, 0132). Once
 * the signature checks out, tee_time_link_claim() adds them to the round's
 * invitations — so they can see it and ask for the place — if it's still
 * open and the sharer is still the host or playing. The app then opens the
 * round as usual, with the usual RLS.
 */
export async function POST(request: Request) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const body = await readJson<{ token?: unknown }>(request);
  const payload = typeof body?.token === "string" ? verifyTeeTimeToken(body.token) : null;
  if (!payload) return badRequest("That link isn't a PinPals tee time.");

  const { data, error } = await createAdminClient().rpc("tee_time_link_claim", {
    p_invite_id: payload.t,
    p_sharer: payload.s,
    p_member: auth.user.id,
  });
  if (error || data !== true) {
    return Response.json({ error: "This round has filled up or isn't available any more.", reason: "not_found" }, { status: 404 });
  }
  return Response.json({ invite_id: payload.t });
}
