import "server-only";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  notifyInterestDeclined,
  notifyInterestReceived,
  notifyPlaceConfirmed,
  notifyPlaceOffered,
  notifyPlaceWithdrawn,
  type InviteRef,
} from "@/lib/tee-times-server";

/**
 * The three tee-time writes, in one place, callable by anything.
 *
 * WHY THIS MODULE EXISTS. Until now these lived inside Server Actions, which
 * was fine while the website was the only caller. The iOS app is a second one,
 * and it cannot simply call the RPCs itself: respond_to_tee_time_interest()
 * and confirm_tee_time_place() move `spaces_available` atomically but do NOT
 * call notify_user(). The notification — in-app row, email, and since 0075
 * push — is built in TypeScript from the row those functions return.
 *
 * An app calling the RPCs directly would therefore update the fourball and
 * tell nobody: the host accepts someone, the applicant never hears, and the
 * data looks perfectly correct. See §1 of
 * claude/mobile-app-api-build-spec.md.
 *
 * THE RULE THAT FOLLOWS, and the reason after() is imported into a lib
 * module rather than left in the callers: **the notification is scheduled in
 * here, not by the caller.** If a caller had to remember to notify, a caller
 * would eventually forget, which is the exact bug this module prevents. The
 * Next coupling is the price, and it is worth paying.
 *
 * Callers supply a Supabase client already scoped to the member — cookies on
 * the website, a bearer token in the app's API route. Every rule about who
 * may do what stays in RLS and in the SECURITY DEFINER functions, exactly as
 * before. Nothing here re-decides authorisation.
 */

export type Failure =
  | "not_found"
  | "forbidden"
  | "conflict"
  | "failed";

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; reason: Failure; message: string };

const fail = (reason: Failure, message: string): Result<never> => ({
  ok: false,
  reason,
  message,
});

// ===========================================================================
// Express interest
// ===========================================================================

type InviteRow = {
  member_id: string;
  status: string;
  club_name: string;
  play_date: string;
};

/**
 * A member asks to join someone's round.
 *
 * The pre-checks below are duplicated by the RLS INSERT policy on
 * tee_time_interests, which already requires the row to be the caller's, the
 * invite to belong to someone else, the invite to be open, and the invite to
 * be visible to them. They are kept because a policy violation surfaces as a
 * generic error, and "You can't express interest in your own invite" is worth
 * more to a member than "new row violates row-level security policy". The
 * policy remains the thing that actually enforces it.
 */
export async function expressInterest(
  supabase: SupabaseClient,
  userId: string,
  inviteId: number
): Promise<Result<{ interestId: number }>> {
  const { data: invite } = await supabase
    .from("tee_time_invites")
    .select("member_id, status, club_name, play_date")
    .eq("id", inviteId)
    .maybeSingle<InviteRow>();

  // RLS makes "not visible to you" and "doesn't exist" the same answer, which
  // is correct — distinguishing them would leak the existence of private
  // fourballs.
  if (!invite) return fail("not_found", "This invite is no longer available.");
  if (invite.member_id === userId) {
    return fail("forbidden", "You can't express interest in your own invite.");
  }
  if (invite.status !== "open") {
    return fail("conflict", "This invite is no longer open.");
  }

  const { data: interest, error } = await supabase
    .from("tee_time_interests")
    .insert({ invite_id: inviteId, member_id: userId })
    .select("id")
    .single<{ id: number }>();

  if (error) {
    // UNIQUE (invite_id, member_id). Checking first instead would race; this
    // is the constraint doing the work, and a second tap on a flaky mobile
    // connection lands here rather than creating a duplicate.
    if (error.code === "23505") {
      return fail("conflict", "You've already expressed interest in this invite.");
    }
    return fail("failed", "Couldn't record your interest — please try again.");
  }

  // Not rate-limited, unlike posting availability: the unique constraint caps
  // this at one notification per member per invite, so there is no loop.
  after(async () => {
    await notifyInterestReceived(createAdminClient(), {
      hostId: invite.member_id,
      applicantId: userId,
      interestId: interest.id,
      invite: {
        inviteId,
        clubName: invite.club_name,
        playDate: invite.play_date,
      },
    });
  });

  return { ok: true, value: { interestId: interest.id } };
}

// ===========================================================================
// Host responds
// ===========================================================================

type RespondRow = {
  interest_id: number;
  applicant_id: string;
  invite_id: number;
  club_name: string;
  play_date: string;
  new_status: string;
  spaces_remaining: number;
};

export type RespondResult = {
  interestId: number;
  applicantId: string;
  inviteId: number;
  newStatus: string;
  spacesRemaining: number;
};

/**
 * The host offers a place, or declines.
 *
 * Ownership, the pending check, the space decrement and closing the invite
 * when it fills all live inside respond_to_tee_time_interest() (0077), behind
 * a row lock on the invite. Nothing here reimplements any of it.
 */
export async function respondToInterest(
  supabase: SupabaseClient,
  userId: string,
  interestId: number,
  accept: boolean
): Promise<Result<RespondResult>> {
  const { data, error } = await supabase.rpc("respond_to_tee_time_interest", {
    p_interest_id: interestId,
    p_accept: accept,
  });

  if (error) {
    // The function raises member-facing sentences ("That request has already
    // been answered."), so the message is passed through rather than replaced
    // with something vaguer.
    //
    // It raises them all with the same SQLSTATE, so this cannot tell "already
    // answered" from "not yours" — everything becomes a conflict. Giving the
    // RPCs distinct error codes would let the API return a truer status; that
    // is a database change and deliberately not part of this extraction.
    return fail("conflict", error.message);
  }

  const row = (data as RespondRow[] | null)?.[0];
  if (!row) return fail("not_found", "That request is no longer available.");

  const invite: InviteRef = {
    inviteId: row.invite_id,
    clubName: row.club_name,
    playDate: row.play_date,
  };

  after(async () => {
    const admin = createAdminClient();
    if (accept) {
      await notifyPlaceOffered(admin, {
        applicantId: row.applicant_id,
        hostId: userId,
        interestId: row.interest_id,
        invite,
      });
    } else {
      await notifyInterestDeclined(admin, {
        applicantId: row.applicant_id,
        hostId: userId,
        interestId: row.interest_id,
        invite,
      });
    }
  });

  return {
    ok: true,
    value: {
      interestId: row.interest_id,
      applicantId: row.applicant_id,
      inviteId: row.invite_id,
      newStatus: row.new_status,
      spacesRemaining: row.spaces_remaining,
    },
  };
}

// ===========================================================================
// Golfer confirms
// ===========================================================================

type ConfirmRow = {
  interest_id: number;
  host_id: string;
  invite_id: number;
  club_name: string;
  play_date: string;
  new_status: string;
};

export type ConfirmResult = {
  interestId: number;
  hostId: string;
  inviteId: number;
  newStatus: string;
};

/**
 * The golfer confirms their place, or drops out.
 *
 * Same shape as respondToInterest: the status check and the
 * hand-the-space-back arithmetic are in confirm_tee_time_place() (0077)
 * behind the same row lock, so a member dropping out while the host is
 * accepting somebody else cannot lose or duplicate a space.
 */
export async function confirmPlace(
  supabase: SupabaseClient,
  userId: string,
  interestId: number,
  attending: boolean
): Promise<Result<ConfirmResult>> {
  const { data, error } = await supabase.rpc("confirm_tee_time_place", {
    p_interest_id: interestId,
    p_attending: attending,
  });

  if (error) return fail("conflict", error.message);

  const row = (data as ConfirmRow[] | null)?.[0];
  if (!row) return fail("not_found", "That place is no longer available.");

  const invite: InviteRef = {
    inviteId: row.invite_id,
    clubName: row.club_name,
    playDate: row.play_date,
  };

  after(async () => {
    const admin = createAdminClient();
    if (attending) {
      await notifyPlaceConfirmed(admin, {
        hostId: row.host_id,
        applicantId: userId,
        interestId: row.interest_id,
        invite,
      });
    } else {
      await notifyPlaceWithdrawn(admin, {
        hostId: row.host_id,
        applicantId: userId,
        interestId: row.interest_id,
        invite,
      });
    }
  });

  return {
    ok: true,
    value: {
      interestId: row.interest_id,
      hostId: row.host_id,
      inviteId: row.invite_id,
      newStatus: row.new_status,
    },
  };
}
