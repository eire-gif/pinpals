import {
  asId,
  authenticateAppRequest,
  badRequest,
  readJson,
  statusForFailure,
  unauthenticated,
} from "@/lib/app-api";
import {
  changeInviteStatus,
  removeInvite,
  type InviteStatusValue,
} from "@/lib/tee-times-operations";

/**
 * PATCH  /api/app/tee-times/invites/[id]   { status }
 * DELETE /api/app/tee-times/invites/[id]
 *
 * The host changes or withdraws their own round, from the app.
 *
 * WHY THESE ARE ROUTES. The app could update the status column itself — the
 * "Update own invites" policy (0028) would allow it and refuse anyone else's.
 * What it could not do is tell the people affected. Cancelling notifies every
 * member who asked, was offered a place, or confirmed one, and that
 * notification is assembled in TypeScript with the admin client. An app
 * writing the column directly would call a fourball off and tell nobody; a
 * member with a confirmed place would simply turn up.
 *
 * That is the same reason the interest routes beside this one exist, and the
 * work lives in src/lib/tee-times-operations.ts so the website's Server
 * Action and this route run the identical sequence rather than two versions
 * of it that drift.
 *
 * Ownership is enforced by the policy and re-stated as `member_id = caller`
 * in the operation, so a request naming somebody else's round comes back
 * not_found rather than succeeding quietly against zero rows.
 */

const STATUSES: readonly InviteStatusValue[] = ["open", "full", "cancelled", "completed"];

function isStatus(value: unknown): value is InviteStatusValue {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const inviteId = asId((await params).id);
  if (inviteId === null) return badRequest("id must be a positive integer");

  const body = await readJson<{ status?: unknown }>(request);
  if (!isStatus(body?.status)) {
    return badRequest(`status must be one of ${STATUSES.join(", ")}`);
  }

  const result = await changeInviteStatus(auth.supabase, auth.user.id, inviteId, body.status);

  if (!result.ok) {
    return Response.json(
      { error: result.message, reason: result.reason },
      { status: statusForFailure(result.reason) }
    );
  }

  return Response.json({ invite_id: result.value.inviteId, status: result.value.status });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const inviteId = asId((await params).id);
  if (inviteId === null) return badRequest("id must be a positive integer");

  const result = await removeInvite(auth.supabase, auth.user.id, inviteId);

  if (!result.ok) {
    return Response.json(
      { error: result.message, reason: result.reason },
      { status: statusForFailure(result.reason) }
    );
  }

  return Response.json({ invite_id: result.value.inviteId, deleted: true });
}
