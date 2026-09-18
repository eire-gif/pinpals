import {
  asBoolean,
  asId,
  authenticateAppRequest,
  badRequest,
  readJson,
  statusForFailure,
  unauthenticated,
} from "@/lib/app-api";
import { confirmPlace } from "@/lib/tee-times-operations";

/**
 * POST /api/app/tee-times/interest/confirm   { interest_id, attending }
 *
 * The golfer confirms their place, or drops out.
 *
 * `attending: false` is not a cancellation of the invite — it hands the space
 * back, and the host is told quickly, because a space that reopens two days
 * before the round is fillable and one that reopens on the morning is not.
 */
export async function POST(request: Request) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const body = await readJson<{ interest_id?: unknown; attending?: unknown }>(request);
  const interestId = asId(body?.interest_id);
  const attending = asBoolean(body?.attending);

  if (interestId === null) return badRequest("interest_id must be a positive integer");
  if (attending === null) return badRequest("attending must be true or false");

  const result = await confirmPlace(
    auth.supabase,
    auth.user.id,
    interestId,
    attending
  );

  if (!result.ok) {
    return Response.json(
      { error: result.message, reason: result.reason },
      { status: statusForFailure(result.reason) }
    );
  }

  return Response.json(
    { interest_id: result.value.interestId, status: result.value.newStatus },
    { status: 200 }
  );
}
