import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyUser } from "./notifications-server";
import { LADIES_ONLY_BADGE, formatInviteDate, formatTimeRange } from "./tee-times";

/**
 * Telling a member's connections that they've posted a tee time.
 *
 * This is the app's first *broadcast* notification. Everything before it was
 * one-to-one and reactive — someone messaged you, someone bid on your
 * listing, your payment cleared. Here one action by one member produces N
 * notifications and up to N emails, which changes what the code has to worry
 * about, hence this being its own module rather than four more lines inside
 * the Server Action:
 *
 *   - It must never fail the post. A member's tee time is on the board the
 *     moment the insert succeeds; whether their connections were told is a
 *     separate, best-effort concern. Nothing in here throws.
 *   - It must not make the member wait. The caller runs it through Next's
 *     after() so the fan-out happens once the response has been sent — see
 *     the call site in src/app/dashboard/availability/new/actions.ts.
 *   - It must be bounded. FANOUT_LIMIT and CONCURRENCY below.
 *
 * It is also the seam for the channels that aren't email. Adding push or
 * WhatsApp means adding a delivery call inside this function's loop (or
 * alongside notifyUser), not finding every place a tee time gets posted.
 * Right now notifyUser() writes the in-app record and sends the email; a
 * second channel would sit beside it, reading the same recipient list built
 * by connectionIdsFor() below.
 */

/** How many connections one post will reach. Nobody on Pinpals is near this
 * today; it exists so that a member who accumulates hundreds of connections
 * can't turn one form submit into hundreds of provider calls. If this is
 * ever actually hit, the answer is a queue, not a bigger number. */
const FANOUT_LIMIT = 200;

/** Recipients processed at a time. Each one costs an auth lookup plus a
 * provider call, so serial would be slow and unbounded-parallel would open
 * as many sockets as there are connections. Six is enough to keep a typical
 * fan-out inside a couple of seconds without either problem. */
const CONCURRENCY = 6;

/**
 * Every member with an accepted connection to `userId`.
 *
 * Connections are stored one row per pair with no canonical direction (see
 * migration 0006's least/greatest unique index), so the other party is
 * whichever column isn't the user. Deduplicated defensively: the unique
 * index should already make a repeat impossible, but sending someone the
 * same email twice is a worse failure than one redundant Set.
 *
 * Takes a service-role client because its caller already holds one and
 * because this runs after the response, outside any request's session.
 */
export async function connectionIdsFor(admin: SupabaseClient, userId: string): Promise<string[]> {
  const { data, error } = await admin
    .from("connections")
    .select("requester_id, recipient_id")
    .eq("status", "accepted")
    .or(`requester_id.eq.${userId},recipient_id.eq.${userId}`)
    .returns<{ requester_id: string; recipient_id: string }[]>();

  if (error) {
    console.error(`[tee-times] Couldn't load connections for ${userId}:`, error.message);
    return [];
  }

  const ids = new Set<string>();
  for (const row of data ?? []) {
    const other = row.requester_id === userId ? row.recipient_id : row.requester_id;
    // Guard against a self-row that connections_not_self should prevent.
    if (other !== userId) ids.add(other);
  }
  return [...ids];
}

export type InviteAnnouncement = {
  inviteId: number;
  hostId: string;
  clubName: string;
  playDate: string;
  timeFrom: string | null;
  timeTo: string | null;
  spaces: number;
  ladiesOnly: boolean;
};

/**
 * The body text, built from the invite's own safe fields.
 *
 * Deliberately excludes the host's free-text notes. They're the one part of
 * an invite another member wrote, and this string goes to an inbox — the
 * same reason sendMessage() sends "X sent you a message" rather than the
 * message. Club, date, time and spaces are all chosen from fixed lists or
 * formatted from typed columns.
 */
export function announcementBody(invite: InviteAnnouncement, hostName: string): string {
  const when = formatInviteDate(invite.playDate);
  const timeRange = formatTimeRange(invite.timeFrom, invite.timeTo);
  const spaces = invite.spaces === 1 ? "1 space" : `${invite.spaces} spaces`;
  // Appended rather than woven in, so it reads as the qualifier it is and
  // survives any later change to the sentence in front of it. A member who
  // shouldn't be asking to join deserves to know that from the email, not
  // after they've already asked.
  return `${hostName} has ${spaces} at ${invite.clubName} on ${when}${
    timeRange ? `, ${timeRange}` : ""
  }.${invite.ladiesOnly ? ` ${LADIES_ONLY_BADGE}.` : ""}`;
}

/**
 * The host's display name, resolved here rather than passed in by the
 * Server Action: the action doesn't have it (the form posts a club and a
 * date, not the poster's name), and this runs after the response anyway, so
 * one extra read costs the member nothing.
 *
 * Falls back to a generic name rather than aborting. A tee time worth
 * telling people about is still worth telling them about if the profile
 * read hiccups.
 */
async function hostNameFor(admin: SupabaseClient, hostId: string): Promise<string> {
  const { data } = await admin
    .from("profiles")
    .select("first_name, last_name")
    .eq("id", hostId)
    .maybeSingle<{ first_name: string | null; last_name: string | null }>();

  const name = [data?.first_name, data?.last_name].filter(Boolean).join(" ").trim();
  return name || "A Pinpals member";
}

/**
 * Notify everyone connected to the host. Returns how many were told, for
 * logging; callers ignore it.
 *
 * Runs for every invite, whatever its audience. A "connections only" invite
 * obviously goes to connections; a public one goes to them too, because the
 * people a member has connected with are the ones most likely to actually
 * play with them, and a round that reaches nobody's attention is the problem
 * this feature exists to solve.
 */
export async function notifyConnectionsOfInvite(
  admin: SupabaseClient,
  invite: InviteAnnouncement
): Promise<number> {
  const recipients = (await connectionIdsFor(admin, invite.hostId)).slice(0, FANOUT_LIMIT);
  // Resolved only once there's actually someone to tell — a member with no
  // connections yet costs one query, not two.
  if (recipients.length === 0) return 0;

  const hostName = await hostNameFor(admin, invite.hostId);
  const body = announcementBody(invite, hostName);
  let sent = 0;

  for (let i = 0; i < recipients.length; i += CONCURRENCY) {
    const batch = recipients.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (userId) => {
        try {
          await notifyUser(admin, {
            userId,
            type: "tee_time_posted",
            title: `${hostName} posted a tee time`,
            body,
            href: "/tee-times",
            data: { inviteId: invite.inviteId, hostId: invite.hostId },
            // One notification per (recipient, invite). A retry, a double
            // submit, or a future re-announcement can't produce a second
            // copy for the same person.
            dedupeKey: `tee_time:${invite.inviteId}:posted`,
          });
          sent += 1;
        } catch (err) {
          // notifyUser is already best-effort internally; this is the belt
          // for anything it doesn't catch, so one bad recipient can't stop
          // the rest of the fan-out.
          console.error(`[tee-times] Notify failed for ${userId}:`, err instanceof Error ? err.message : err);
        }
      })
    );
  }

  return sent;
}
