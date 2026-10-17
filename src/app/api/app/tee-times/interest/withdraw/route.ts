import {
  asId,
  authenticateAppRequest,
  badRequest,
  readJson,
  statusForFailure,
  unauthenticated,
} from "@/lib/app-api";
import { withdrawRequest } from "@/lib/tee-times-operations";

/**
 * POST /api/app/tee-times/interest/withdraw   { interest_id }
 *
 * The golfer takes back a request the host hasn't answered yet (0167).
 * Once the host has offered a place this refuses — that is "Can't make it",
 * through /confirm, which hands the space back and tells the host.
 */
export async function POST(request: Request) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const body = await readJson<{ interest_id?: unknown }>(request);
  const interestId = asId(body?.interest_id);
  if (interestId === null) return badRequest("interest_id must be a positive integer");

  const result = await withdrawRequest(auth.supabase, interestId);
  if (!result.ok) {
    return Response.json({ error: result.message, reason: result.reason }, { status: statusForFailure(result.reason) });
  }

  return Response.json({ interest_id: result.value.interestId, status: "declined" }, { status: 200 });
}
