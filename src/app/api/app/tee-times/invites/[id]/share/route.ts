import { asId, authenticateAppRequest, badRequest, unauthenticated } from "@/lib/app-api";
import { getSiteUrl } from "@/lib/site-url";
import { signTeeTimeToken, teeTimeLinkPath } from "@/lib/tee-time-links";

/**
 * POST /api/app/tee-times/invites/[id]/share   → { url }
 *
 * A link to a round with an open place (0132), for sending by WhatsApp or
 * text. Only the host or someone with a confirmed place can make one, and
 * only while there's a place to fill. Signed, not stored — see
 * src/lib/tee-time-links.ts.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const id = asId((await params).id);
  if (id === null) return badRequest("Tee time id must be a positive integer.");

  const { data: invite } = await auth.supabase
    .from("tee_time_invites")
    .select("id, status, spaces_available")
    .eq("id", id)
    .maybeSingle<{ id: number; status: string; spaces_available: number }>();
  const { data: canFill } = await auth.supabase.rpc("tee_time_can_fill", { p_invite_id: id, p_user: auth.user.id });
  if (!invite || canFill !== true) {
    return Response.json({ error: "Only the host or someone playing can share this round.", reason: "forbidden" }, { status: 403 });
  }
  if (invite.status !== "open" || invite.spaces_available < 1) {
    return Response.json({ error: "This round is full.", reason: "conflict" }, { status: 409 });
  }

  return Response.json({ url: `${getSiteUrl()}${teeTimeLinkPath(signTeeTimeToken(id, auth.user.id))}` });
}
