import type { SupabaseClient } from "@supabase/supabase-js";
import { calendarLinkPath, signCalendarToken, tzForCountry, type CalEvent } from "@/lib/calendar-ics";
import { getSiteUrl } from "@/lib/site-url";

/**
 * "Add to calendar" for one tee time, shared by the app's /api/app/calendar
 * and the website's My rounds (Oct 2026). Read with the member's own client,
 * so RLS decides what they can see — and only for a round they're in: the
 * host, or a golfer with a confirmed (or offered) place.
 *
 * Moved here from the API route unchanged, so both get the same event.
 */
export type TeeTimeCalendarResult =
  | { ok: true; url: string }
  | { ok: false; status: 403 | 404; reason: "not_in_round" | "not_found"; error: string };

const HHMM = (t: string | null | undefined) => (t ? t.slice(0, 5) : null);

export async function teeTimeCalendarUrl(
  supabase: SupabaseClient,
  userId: string,
  inviteId: number
): Promise<TeeTimeCalendarResult> {
  const site = getSiteUrl();
  const { data: invite } = await supabase
    .from("tee_time_invites")
    .select("id, member_id, status, club_id, club_name, play_date, time_from, exact_tee_time, spaces_available, clubs ( country, town )")
    .eq("id", inviteId)
    .maybeSingle<{
      id: number;
      member_id: string;
      status: string;
      club_id: number | null;
      club_name: string | null;
      play_date: string;
      time_from: string | null;
      exact_tee_time: string | null;
      clubs: { country: string | null; town: string | null } | null;
    }>();
  if (!invite) return { ok: false, status: 404, reason: "not_found", error: "That tee time isn't available." };

  const hosting = invite.member_id === userId;
  if (!hosting) {
    const { data: mine } = await supabase
      .from("tee_time_interests")
      .select("status")
      .eq("invite_id", inviteId)
      .eq("member_id", userId)
      .maybeSingle<{ status: string }>();
    if (!mine || !["confirmed", "accepted"].includes(mine.status)) {
      return { ok: false, status: 403, reason: "not_in_round", error: "You can add this to your calendar once you're confirmed in the round." };
    }
  }

  const course = invite.club_name ?? "Golf";
  const exact = HHMM(invite.exact_tee_time);
  const from = HHMM(invite.time_from);
  const event: CalEvent = {
    uid: `tee-time-${invite.id}`,
    title: `⛳ Golf at ${course}`,
    date: invite.play_date,
    time: exact ?? from,
    tz: tzForCountry(invite.clubs?.country),
    durationMin: 270,
    location: [course, invite.clubs?.town].filter(Boolean).join(", "),
    description: [
      exact ? `Tee time ${exact}.` : from ? `Teeing off from about ${from} — check the exact time in PinPals.` : "Time to be confirmed in PinPals.",
      hosting ? "You're hosting." : "You're playing.",
      "Organised on PinPals.",
    ].join(" "),
    url: `${site}/invite/${invite.id}`,
  };
  return { ok: true, url: `${site}${calendarLinkPath(signCalendarToken(event))}` };
}
