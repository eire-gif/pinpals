import {
  authenticateAppRequest,
  unauthenticated,
} from "@/lib/app-api";
import {
  deletionStatus,
  requestAccountDeletion,
  GRACE_DAYS,
} from "@/lib/account-deletion";

/**
 * Account deletion from the iOS app.
 *
 * Guideline 5.1.1(v) requires this to happen inside the app, and Guideline 4
 * rules out sending the member to the website to finish it — so this is not a
 * deep link with a nice label on it, it is the same operation the website's
 * Server Action calls.
 *
 * GET  /api/app/account/delete  → what the profile tab should show
 * POST /api/app/account/delete  → start the deletion
 */

/** What the app needs to render the row without a second round trip. */
export async function GET(request: Request) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const status = await deletionStatus(auth.supabase, auth.user.id);

  return Response.json(
    {
      grace_days: GRACE_DAYS,
      blocked_reason: status.blockedReason,
      pending: status.pending
        ? {
            requested_at: status.pending.requestedAt,
            scheduled_for: status.pending.scheduledFor,
          }
        : null,
    },
    { status: 200 }
  );
}

export async function POST(request: Request) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const result = await requestAccountDeletion(auth.supabase, auth.user.id);

  if (!result.ok) {
    // Not statusForFailure(): these failures are this route's own, and
    // "blocked" is a 409 rather than a 403 because the member is entitled to
    // delete — just not while they owe somebody a delivery.
    const status =
      result.reason === "blocked" || result.reason === "already_requested"
        ? 409
        : 500;

    return Response.json(
      { error: result.message, reason: result.reason },
      { status }
    );
  }

  // The bearer token the app used to make this call has just been revoked
  // along with every other session, so this response is the last thing that
  // token will ever do. The app signs out locally on receiving it.
  return Response.json(
    {
      scheduled_for: result.value.scheduledFor,
      grace_days: GRACE_DAYS,
    },
    { status: 200 }
  );
}
