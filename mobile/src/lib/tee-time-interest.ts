import { postToSite } from "./api";
import { supabase } from "./supabase";

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
