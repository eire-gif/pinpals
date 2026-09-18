import {
  asBoolean,
  asId,
  authenticateAppRequest,
  badRequest,
  readJson,
  statusForFailure,
  unauthenticated,
} from "@/lib/app-api";
import { respondToInterest } from "@/lib/tee-times-operations";

/**
 * POST /api/app/tee-times/interest/respond   { interest_id, accept }
 *
 * The host offers a place, or declines.
 *
 * Ownership is not checked here. respond_to_tee_time_interest() (0077) does
 * it, behind a row lock, as the calling member — so a request to answer
 * somebody else's invite fails in Postgres, not in a TypeScript check that
 * could drift from the policy.
 */
export async function POST(request: Request) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const body = await readJson<{ interest_id?: unknown; accept?: unknown }>(request);
  const interestId = asId(body?.interest_id);
  const accept = asBoolean(body?.accept);

  if (interestId === null) return badRequest("interest_id must be a positive integer");
  if (accept === null) return badRequest("accept must be true or false");

  const result = await respondToInterest(
    auth.supabase,
    auth.user.id,
    interestId,
    accept
  );

  if (!result.ok) {
    return Response.json(
      { error: result.message, reason: result.reason },
      { status: statusForFailure(result.reason) }
    );
  }

  // spaces_remaining lets the app update the card without a re-fetch, which
  // matters on a train.
  return Response.json(
    {
      interest_id: result.value.interestId,
      status: result.value.newStatus,
      spaces_remaining: result.value.spacesRemaining,
    },
    { status: 200 }
  );
}
