import { getFromSite, postToSite } from "./api";

/**
 * Account deletion from the app.
 *
 * App Store Guideline 5.1.1(v) requires an app that creates accounts to offer
 * deletion inside the app, and Guideline 4 rules out handing the member off to
 * the website to finish it. So this posts to the site's API and the site runs
 * exactly the operation its own settings page runs — one implementation, one
 * set of rules about what may be deleted and what must be kept.
 */

export type DeletionState = {
  graceDays: number;
  /** Null when the account may go, else the obligation in the way. */
  blockedReason: string | null;
  /** Set when a deletion is already under way. */
  scheduledFor: string | null;
};

type DeletionPayload = {
  grace_days: number;
  blocked_reason: string | null;
  pending: { requested_at: string; scheduled_for: string } | null;
};

export async function getDeletionState(): Promise<DeletionState> {
  const payload = await getFromSite<DeletionPayload>("/api/app/account/delete");
  return {
    graceDays: payload.grace_days,
    blockedReason: payload.blocked_reason,
    scheduledFor: payload.pending?.scheduled_for ?? null,
  };
}

/**
 * Start the deletion. Resolves with the date everything is removed.
 *
 * The access token this call used is revoked by the time it returns — the
 * server signs every session out — so the caller must sign out locally
 * immediately afterwards rather than making another request with it.
 */
export async function requestDeletion(): Promise<string> {
  const { scheduled_for } = await postToSite<{ scheduled_for: string }>(
    "/api/app/account/delete",
    {}
  );
  return scheduled_for;
}

export const deletionDateLabel = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-IE", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
