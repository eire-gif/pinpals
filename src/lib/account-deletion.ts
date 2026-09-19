import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { confirmPlace } from "@/lib/tee-times-operations";
import {
  notifyInviteCancelled,
  type InviteRef,
} from "@/lib/tee-times-server";

/**
 * Account deletion, in one place, called by the website and by the app.
 *
 * App Store Guideline 5.1.1(v) requires deletion from inside the app and says
 * plainly that temporary deactivation is not enough; GDPR Article 17 requires
 * it regardless. Data the operator is legally required to keep may be
 * retained if the member is told, and Irish Revenue requires transaction
 * records for six years — which is why this is not a DELETE.
 *
 * See claude/account-deletion-build-spec.md. The schema half is migration
 * 0080.
 */

/**
 * The locked-out window. The account is unusable from the moment the member
 * confirms; the delay exists so a deletion made in temper can be undone by
 * asking, not so the account keeps working.
 */
export const GRACE_DAYS = 30;

export type DeletionFailure = "blocked" | "already_requested" | "failed";

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; reason: DeletionFailure; message: string };

export type PendingDeletion = {
  requestedAt: string;
  scheduledFor: string;
};

export type DeletionStatus = {
  /** Set when a deletion is already under way. */
  pending: PendingDeletion | null;
  /** Null when the account may be deleted, else the obligation in the way. */
  blockedReason: string | null;
};

const fail = (reason: DeletionFailure, message: string): Result<never> => ({
  ok: false,
  reason,
  message,
});

// ===========================================================================
// Reading
// ===========================================================================

/**
 * What the settings page and the app's profile tab both need to render.
 *
 * Both halves come from the database rather than from anything cached: a
 * member who has just paid for something must not be told they can delete,
 * and one who requested deletion on their phone must see that on the website.
 */
export async function deletionStatus(
  supabase: SupabaseClient,
  userId: string
): Promise<DeletionStatus> {
  const [{ data: pending }, { data: blocked }] = await Promise.all([
    supabase
      .from("account_deletion_requests")
      .select("requested_at, scheduled_for")
      .eq("user_id", userId)
      .is("completed_at", null)
      .maybeSingle<{ requested_at: string; scheduled_for: string }>(),
    // can_delete_account() takes no arguments and derives the member from
    // auth.uid(), so it can only ever answer about the caller.
    supabase.rpc("can_delete_account"),
  ]);

  return {
    pending: pending
      ? { requestedAt: pending.requested_at, scheduledFor: pending.scheduled_for }
      : null,
    blockedReason: typeof blocked === "string" ? blocked : null,
  };
}

// ===========================================================================
// Requesting
// ===========================================================================

/**
 * Start a deletion.
 *
 * Everything that protects other members happens before this returns — the
 * account is locked, the tee times are cancelled, the listings are pulled.
 * Only the notifications are allowed to be slow, and they are sent with the
 * admin client because the member's own session is about to stop existing.
 *
 * `supabase` must be the member's own client: every write below is one their
 * RLS policies already permit, which is what keeps this from becoming a
 * second implementation of those policies.
 */
export async function requestAccountDeletion(
  supabase: SupabaseClient,
  userId: string
): Promise<Result<PendingDeletion>> {
  const { data: blocked, error: checkError } = await supabase.rpc(
    "can_delete_account"
  );

  if (checkError) {
    return fail("failed", "Couldn't check your account just now.");
  }
  if (typeof blocked === "string" && blocked.length > 0) {
    return fail("blocked", blocked);
  }

  const scheduledFor = new Date(
    Date.now() + GRACE_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const { data: request, error: insertError } = await supabase
    .from("account_deletion_requests")
    .insert({ user_id: userId, scheduled_for: scheduledFor })
    .select("requested_at, scheduled_for")
    .single<{ requested_at: string; scheduled_for: string }>();

  if (insertError) {
    // The partial unique index. A second press of the button must not reset
    // the clock, and telling the member it already happened is the honest
    // answer rather than an error.
    if (insertError.code === "23505") {
      return fail("already_requested", "Your account is already scheduled for deletion.");
    }
    return fail("failed", "Couldn't start the deletion just now.");
  }

  const admin = createAdminClient();

  // Order matters. Standing down the member's commitments uses their own
  // session, so it has to happen before the ban revokes it.
  await standDownCommitments(supabase, admin, userId);
  await lockAccount(admin, userId);

  return {
    ok: true,
    value: {
      requestedAt: request.requested_at,
      scheduledFor: request.scheduled_for,
    },
  };
}

/**
 * Cancel what the member owes other people before the account goes dark.
 *
 * A fourball three of whom have confirmed is a plan other people have made
 * around a host who is leaving. Silently removing it thirty days later, or
 * leaving it open for a host who can no longer answer, are both worse than
 * cancelling it now and saying so.
 */
async function standDownCommitments(
  supabase: SupabaseClient,
  admin: SupabaseClient,
  userId: string
): Promise<void> {
  // --- Places they hold on other people's tee times -----------------------
  //
  // Routed through confirmPlace(…, false) rather than written here: that is
  // the operation the "I can't make it" button uses, so the space goes back
  // to the host under the same row lock and the host gets the same
  // notification. Re-implementing it would be a second version of a rule that
  // already exists.
  const { data: held } = await supabase
    .from("tee_time_interests")
    .select("id, status")
    .eq("member_id", userId)
    .in("status", ["accepted", "confirmed"])
    .returns<{ id: number; status: string }[]>();

  for (const interest of held ?? []) {
    await confirmPlace(supabase, userId, interest.id, false);
  }

  // Unanswered requests to join are withdrawn outright. Nobody has planned
  // around them, and a host should not be left waiting on an answer that can
  // never come.
  await supabase
    .from("tee_time_interests")
    .delete()
    .eq("member_id", userId)
    .eq("status", "pending");

  // --- Tee times they are hosting -----------------------------------------
  const { data: invites } = await supabase
    .from("tee_time_invites")
    .select("id, club_name, play_date")
    .eq("member_id", userId)
    .eq("status", "open")
    .returns<{ id: number; club_name: string | null; play_date: string }[]>();

  for (const invite of invites ?? []) {
    // Read the audience before cancelling: once the invite is closed, the
    // interest rows are still there but the reason to tell anyone has gone,
    // and a later read would have to reconstruct who had been counting on it.
    const { data: interested } = await admin
      .from("tee_time_interests")
      .select("member_id")
      .eq("invite_id", invite.id)
      .in("status", ["pending", "accepted", "confirmed"])
      .returns<{ member_id: string }[]>();

    const { error } = await supabase
      .from("tee_time_invites")
      .update({ status: "cancelled" })
      .eq("id", invite.id);

    if (error) continue;

    const ref: InviteRef = {
      inviteId: invite.id,
      clubName: invite.club_name ?? "a tee time",
      playDate: invite.play_date,
    };

    await notifyInviteCancelled(admin, {
      hostId: userId,
      recipientIds: (interested ?? []).map((row) => row.member_id),
      invite: ref,
    });
  }

  // --- Anything they are selling ------------------------------------------
  //
  // Nothing may be bought from an account on its way out. Marked removed
  // rather than deleted: orders point at listings, and an order history that
  // says "an item that no longer exists" helps nobody reading it later.
  await supabase
    .from("listings")
    .update({ status: "removed" })
    .eq("seller_id", userId)
    .in("status", ["draft", "pending_review", "active", "reserved"]);
}

/**
 * Make the account unusable immediately.
 *
 * This is the line between a deletion in progress and a deactivation the
 * member can walk back by signing in, which Apple says is not good enough.
 * A ban stops new sessions; the global sign-out ends the ones already open,
 * including the app's, which holds a refresh token in the iOS Keychain and
 * would otherwise keep working for its lifetime.
 */
async function lockAccount(admin: SupabaseClient, userId: string): Promise<void> {
  try {
    await admin.auth.admin.updateUserById(userId, {
      ban_duration: `${GRACE_DAYS * 24 + 24}h`,
    });
    await admin.auth.admin.signOut(userId, "global");
  } catch (error) {
    // Logged rather than thrown: the request row exists, the commitments are
    // already stood down, and failing the whole action here would leave the
    // member unable to try again because of the one-live-request index.
    console.error("[account-deletion] failed to lock account", error);
  }
}

// ===========================================================================
// The scrub
// ===========================================================================

export type ScrubOutcome = "deleted" | "anonymised";

export type ScrubSummary = {
  due: number;
  completed: number;
  failed: number;
  outcomes: ScrubOutcome[];
};

/**
 * Complete every deletion whose thirty days are up. Called on a schedule.
 */
export async function runDueDeletions(now = new Date()): Promise<ScrubSummary> {
  const admin = createAdminClient();

  const { data: due, error } = await admin
    .from("account_deletion_requests")
    .select("id, user_id")
    .is("completed_at", null)
    .lte("scheduled_for", now.toISOString())
    .returns<{ id: number; user_id: string }[]>();

  if (error) throw new Error(`Couldn't read due deletions: ${error.message}`);

  const summary: ScrubSummary = {
    due: due?.length ?? 0,
    completed: 0,
    failed: 0,
    outcomes: [],
  };

  // Sequential on purpose. This runs at most a handful of times a day, each
  // one touches a dozen tables, and a concurrent version would make a failure
  // much harder to read in the logs than it would make the job faster.
  for (const request of due ?? []) {
    try {
      const outcome = await scrubAccount(admin, request.id, request.user_id);
      summary.completed += 1;
      summary.outcomes.push(outcome);
    } catch (err) {
      summary.failed += 1;
      console.error(
        `[account-deletion] scrub failed for request ${request.id}`,
        err instanceof Error ? err.message : err
      );
    }
  }

  return summary;
}

/**
 * Delete the member outright where nothing legally requires otherwise;
 * anonymise where something does.
 *
 * The test is the attempt itself. orders, payouts, refunds, reports,
 * support_cases, admin_audit_log and fraud_flags all reference auth.users
 * with ON DELETE NO ACTION, so the delete simply fails for a member who has
 * traded — and it fails atomically, leaving nothing half-removed. Asking the
 * database rather than keeping a list of those tables here means the answer
 * stays right as the schema grows, which a hand-maintained list would not.
 */
async function scrubAccount(
  admin: SupabaseClient,
  requestId: number,
  userId: string
): Promise<ScrubOutcome> {
  await purgePersonalRows(admin, userId);

  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);

  if (!deleteError) {
    // Nothing to mark complete: the request row cascades from auth.users and
    // has gone with it. An account that left no legally-required trace leaves
    // none here either, which is the point.
    return "deleted";
  }

  // Legally-required history is in the way — the expected path for anyone who
  // has ever bought or sold. Anonymise instead. The outcome is recorded only
  // after that succeeds, so a scrub that dies halfway leaves the request open
  // for the next run rather than claiming a deletion that did not happen.
  console.info(`[account-deletion] retaining ${userId}: ${deleteError.message}`);

  await anonymise(admin, userId);

  await admin
    .from("account_deletion_requests")
    .update({ completed_at: new Date().toISOString(), outcome: "anonymised" })
    .eq("id", requestId);

  return "anonymised";
}

/**
 * Everything that is nobody else's record. Deleted on both paths — on the
 * clean-delete path the cascade would have taken most of it anyway, and doing
 * it explicitly means the two paths leave the same amount behind.
 */
async function purgePersonalRows(
  admin: SupabaseClient,
  userId: string
): Promise<void> {
  const byUserId = [
    "addresses",
    "push_subscriptions",
    "notification_preferences",
    "notifications",
    "member_birthdates",
    "listing_favourites",
  ];

  for (const table of byUserId) {
    await admin.from(table).delete().eq("user_id", userId);
  }

  await admin.from("tee_time_interests").delete().eq("member_id", userId);
  await admin.from("tee_time_invites").delete().eq("member_id", userId);

  // Two-sided tables. Written as two statements rather than an `.or()` filter
  // because a malformed or-filter fails open in PostgREST — it returns rows
  // rather than an error — and "fails open" on a delete is the wrong way for
  // this to be wrong.
  for (const [table, a, b] of [
    ["connections", "requester_id", "recipient_id"],
    ["blocked_users", "blocker_id", "blocked_id"],
    ["muted_users", "muter_id", "muted_id"],
  ] as const) {
    await admin.from(table).delete().eq(a, userId);
    await admin.from(table).delete().eq(b, userId);
  }

  await admin
    .from("listings")
    .update({ status: "removed" })
    .eq("seller_id", userId)
    .in("status", ["draft", "pending_review", "active", "reserved"]);
}

/**
 * Strip the person out of the records that have to stay.
 *
 * Reviews and messages are deliberately left in place. Reviews cascade on
 * reviewee_id as well as reviewer_id, so deleting them would erase other
 * sellers' ratings; messages cascade on sender_id, so deleting them would
 * leave the other party holding half a conversation. Attributed to "Former
 * member" they stay truthful and carry no identity.
 */
async function anonymise(admin: SupabaseClient, userId: string): Promise<void> {
  const { error } = await admin
    .from("profiles")
    .update({
      first_name: "Former",
      last_name: "member",
      home_club: null,
      home_club_id: null,
      county: null,
      country: null,
      handicap: null,
      handicap_visible: false,
      bio: null,
      avatar_url: null,
      gui_membership_number: null,
      deleted_at: new Date().toISOString(),
    })
    .eq("id", userId);

  if (error) {
    throw new Error(`Couldn't anonymise the profile: ${error.message}`);
  }

  // The auth row has to stay for the foreign keys, so it is emptied instead.
  // The address is given a domain that cannot receive mail, so a stray
  // password-reset or marketing send has nowhere to go, and the ban is made
  // effectively permanent rather than expiring with the grace period.
  try {
    await admin.auth.admin.updateUserById(userId, {
      email: `deleted-${userId}@deleted.pinpals.ie`,
      email_confirm: true,
      password: randomUUID(),
      phone: undefined,
      user_metadata: {},
      ban_duration: "876000h",
    });
    await admin.auth.admin.signOut(userId, "global");
  } catch (error) {
    throw new Error(
      `Couldn't anonymise the sign-in details: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
