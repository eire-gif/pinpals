import { postToSite } from "./api";
import { supabase } from "./supabase";
import { todayIso } from "./tee-times";

/**
 * A member's own interest in someone else's tee time.
 *
 * The read comes straight from Postgres — the "See own interest or interest on
 * your invites" policy on tee_time_interests means a member can only ever read
 * back their own row here, so no ownership check is needed in the app.
 *
 * The writes go through the website. See src/lib/api.ts for why.
 */

export type InterestStatus = "pending" | "accepted" | "confirmed" | "declined";

export type MyInterest = {
  id: number;
  status: InterestStatus;
};

/**
 * The signed-in member's interest in one invite, or null if they haven't
 * asked to join it.
 *
 * `member_id` is passed rather than relying on the policy alone: a host
 * looking at their own invite can read every interest row on it, and without
 * the filter this would return whichever one came back first and show the host
 * a stranger's status as their own.
 */
export async function getMyInterest(
  inviteId: number,
  memberId: string
): Promise<MyInterest | null> {
  const { data, error } = await supabase
    .from("tee_time_interests")
    .select("id, status")
    .eq("invite_id", inviteId)
    .eq("member_id", memberId)
    .maybeSingle()
    .overrideTypes<MyInterest>();

  if (error) throw error;
  return data;
}

/** Ask to join a tee time. Resolves to the new interest row. */
export async function expressInterest(inviteId: number): Promise<MyInterest> {
  const { interest_id } = await postToSite<{ interest_id: number }>(
    "/api/app/tee-times/interest",
    { invite_id: inviteId }
  );
  return { id: interest_id, status: "pending" };
}

/**
 * Take the place the host offered, or hand it back.
 *
 * The returned status is the server's, not a guess: `attending: false` frees
 * the space and lands on 'declined', and the host is told straight away so
 * they can offer it to somebody else while the round is still fillable.
 */
export async function confirmPlace(
  interestId: number,
  attending: boolean
): Promise<MyInterest> {
  const { status } = await postToSite<{
    interest_id: number;
    status: InterestStatus;
  }>("/api/app/tee-times/interest/confirm", {
    interest_id: interestId,
    attending,
  });
  return { id: interestId, status };
}

// ===========================================================================
// The host's side
// ===========================================================================

export type IncomingRequest = {
  id: number;
  status: InterestStatus;
  created_at: string;
  invite_id: number;
  member: {
    first_name: string | null;
    last_name: string | null;
    home_club: string | null;
    handicap: number | null;
    handicap_visible: boolean | null;
  } | null;
  invite: {
    id: number;
    club_name: string | null;
    play_date: string;
    time_from: string | null;
    time_to: string | null;
    exact_tee_time: string | null;
    spaces_available: number;
  } | null;
};

/**
 * Everyone who has asked to join one of this member's upcoming tee times.
 *
 * Two queries rather than one: PostgREST can embed the invite, but it cannot
 * filter the outer rows by a column on the embedded table, so asking for
 * "interests on invites I host" in a single call is not expressible. Reading
 * the host's own invite ids first is both correct and cheap — a host has a
 * handful of open rounds, not thousands.
 *
 * Past rounds are excluded. An answer to "can I join on Saturday" is no use
 * the following Tuesday, and a list that fills up with them is a list nobody
 * opens.
 */
export async function listIncomingRequests(
  hostId: string
): Promise<IncomingRequest[]> {
  const { data: invites, error: invitesError } = await supabase
    .from("tee_time_invites")
    .select("id")
    .eq("member_id", hostId)
    .in("status", ["open", "full"])
    .gte("play_date", todayIso())
    .returns<{ id: number }[]>();

  if (invitesError) throw invitesError;

  const ids = (invites ?? []).map((row) => row.id);
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from("tee_time_interests")
    .select(
      `id, status, created_at, invite_id,
       member:profiles!tee_time_interests_member_id_fkey (
         first_name, last_name, home_club, handicap, handicap_visible
       ),
       invite:tee_time_invites!tee_time_interests_invite_id_fkey (
         id, club_name, play_date, time_from, time_to, exact_tee_time,
         spaces_available
       )`
    )
    .in("invite_id", ids)
    .order("created_at", { ascending: true })
    .overrideTypes<IncomingRequest[]>();

  if (error) throw error;
  return data ?? [];
}

/**
 * Offer a place, or decline.
 *
 * Through the site for the usual reason: respond_to_tee_time_interest() moves
 * the space under a row lock but tells nobody, and an offer the other member
 * never hears about is worse than no offer at all.
 */
export async function respondToRequest(
  interestId: number,
  accept: boolean
): Promise<{ status: InterestStatus; spacesRemaining: number }> {
  const result = await postToSite<{
    status: InterestStatus;
    spaces_remaining: number;
  }>("/api/app/tee-times/interest/respond", {
    interest_id: interestId,
    accept,
  });

  return {
    status: result.status,
    spacesRemaining: result.spaces_remaining,
  };
}
