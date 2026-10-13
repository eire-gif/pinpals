import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { formatClock, formatInviteDate, formatTimeRange } from "@/lib/tee-times";
import { verifyTeeTimeToken } from "@/lib/tee-time-links";

export type SharedTeeTime = {
  inviteId: number;
  sharerId: string;
  clubName: string;
  place: string | null;
  dateLabel: string;
  timeLabel: string;
  spaces: number;
  ladiesOnly: boolean;
  hostFirstName: string;
  sharerFirstName: string;
};

/**
 * What a shared tee time link (/t/<token>, 0132) shows. Read with the service
 * role, because a link preview has no session — and then only if the token
 * is genuine, the round is still open with a place, it hasn't been played,
 * and the sharer is still the host or playing in it. Anything else is null.
 *
 * Public, so it says only what an "anyone for golf?" message would: the
 * course, the day, the time, how many places, and first names. Never the
 * notes, the handicap limit or who else is playing.
 */
export async function loadSharedTeeTime(token: string): Promise<SharedTeeTime | null> {
  const payload = verifyTeeTimeToken(token);
  if (!payload) return null;
  const admin = createAdminClient();

  const { data: t } = await admin
    .from("tee_time_invites")
    .select("id, member_id, club_name, play_date, time_from, time_to, exact_tee_time, spaces_available, status, ladies_only, club:clubs ( name, town, region )")
    .eq("id", payload.t)
    .maybeSingle<{
      id: number;
      member_id: string;
      club_name: string | null;
      play_date: string;
      time_from: string | null;
      time_to: string | null;
      exact_tee_time: string | null;
      spaces_available: number;
      status: string;
      ladies_only: boolean | null;
      club: { name: string; town: string | null; region: string | null } | null;
    }>();

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin" }).format(new Date());
  if (!t || t.status !== "open" || t.spaces_available < 1 || t.play_date < today) return null;

  const { data: canFill } = await admin.rpc("tee_time_can_fill", { p_invite_id: t.id, p_user: payload.s });
  if (canFill !== true) return null;

  const { data: people } = await admin
    .from("profiles")
    .select("id, first_name, deleted_at")
    .in("id", [t.member_id, payload.s])
    .overrideTypes<{ id: string; first_name: string | null; deleted_at: string | null }[]>();
  const host = people?.find((p) => p.id === t.member_id);
  const sharer = people?.find((p) => p.id === payload.s);
  if (!host || host.deleted_at || !sharer || sharer.deleted_at) return null;

  return {
    inviteId: t.id,
    sharerId: payload.s,
    clubName: t.club?.name ?? t.club_name ?? "A course to be confirmed",
    place: [t.club?.town, t.club?.region].filter(Boolean).join(", ") || null,
    dateLabel: formatInviteDate(t.play_date),
    timeLabel: t.exact_tee_time ? `Tee time ${formatClock(t.exact_tee_time)}` : formatTimeRange(t.time_from, t.time_to) ?? "Time flexible",
    spaces: t.spaces_available,
    ladiesOnly: !!t.ladies_only,
    hostFirstName: host.first_name || "A golfer",
    sharerFirstName: sharer.first_name || "A golfer",
  };
}
