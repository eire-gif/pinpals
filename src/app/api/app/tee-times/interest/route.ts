import {
  asId,
  authenticateAppRequest,
  badRequest,
  readJson,
  statusForFailure,
  unauthenticated,
} from "@/lib/app-api";
import { expressInterest } from "@/lib/tee-times-operations";

/**
 * POST /api/app/tee-times/interest   { invite_id: number }
 *
 * A member asks to join someone's round, from the iOS app.
 *
 * Identical in every respect to the website's Server Action — same shared
 * operation, same RLS, same notification to the host — because both call
 * expressInterest() in src/lib/tee-times-operations.ts. The only difference
 * is where the session comes from and what shape the answer takes.
 */
export async function POST(request: Request) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const body = await readJson<{ invite_id?: unknown }>(request);
  const inviteId = asId(body?.invite_id);
  if (inviteId === null) return badRequest("invite_id must be a positive integer");

  const result = await expressInterest(auth.supabase, auth.user.id, inviteId);

  if (!result.ok) {
    return Response.json(
      { error: result.message, reason: result.reason },
      { status: statusForFailure(result.reason) }
    );
  }

  return Response.json({ interest_id: result.value.interestId }, { status: 200 });
}
