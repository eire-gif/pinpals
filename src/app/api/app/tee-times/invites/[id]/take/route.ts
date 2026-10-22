import { asId, authenticateAppRequest, badRequest, unauthenticated } from "@/lib/app-api";
import { takeTeeTimePlace } from "@/lib/tee-time-groups";

/**
 * POST /api/app/tee-times/invites/[id]/take   → { interest_id, status: "confirmed", spaces_remaining }
 *
 * A member invited with their group (0186) takes a place in one tap. The host
 * already said yes when they invited the group, so the place is confirmed
 * straight away — first come, first served. 409 once the places are gone.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const id = asId((await params).id);
  if (id === null) return badRequest("Tee time id must be a positive integer.");

  const result = await takeTeeTimePlace(auth.supabase, auth.user.id, id);
  if (!result.ok) {
    const status = result.reason === "forbidden" ? 403 : result.reason === "conflict" ? 409 : 500;
    return Response.json({ error: result.message, reason: result.reason }, { status });
  }
  return Response.json({
    interest_id: result.value.interestId,
    status: "confirmed",
    spaces_remaining: result.value.spacesRemaining,
  });
}
