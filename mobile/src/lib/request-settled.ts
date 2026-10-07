/**
 * Does a tee-time offer or request alert still want an answer?
 *
 * Pure, so it is tested without the app's Supabase client (request-settled.test.ts).
 * Used by the inbox (inbox.ts) to hide Confirm / Can't make it and
 * View request / Decline once they no longer apply.
 */

export type InterestNow = {
  id: number;
  status: "pending" | "accepted" | "confirmed" | "declined";
  tee_time_invites: { status: string; play_date: string } | null;
};

/** Today in Ireland, as the YYYY-MM-DD the invites store. */
export function todayInDublin(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin" }).format(new Date());
}

/**
 * Whether an offer or request alert still wants an answer, and if not, why.
 *
 * The alert is a snapshot of the moment it was sent; the request has moved
 * on since — confirmed nineteen seconds later from the round itself, given
 * back, or the round called off. Buttons on a settled alert invite a tap
 * that can only fail.
 */
export function settledReason(type: string, now: InterestNow | undefined, today: string): string | null {
  const offer = type === "tee_time_place_offered";
  if (!now) return offer ? "This offer is no longer available" : "This request was withdrawn";
  const invite = now.tee_time_invites;
  if (!invite) return "This round is no longer available";
  if (invite.status === "cancelled") return "This round was cancelled";
  if (invite.status === "completed" || invite.play_date < today) return "This round has been played";
  if (offer) {
    if (now.status === "accepted") return null;
    if (now.status === "confirmed") return "You confirmed your place";
    if (now.status === "declined") return "You gave this place back";
    return "This offer was withdrawn";
  }
  if (now.status === "pending") return null;
  if (now.status === "accepted" || now.status === "confirmed") return "You accepted this request";
  return "This request is closed";
}
