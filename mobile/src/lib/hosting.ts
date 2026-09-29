import { deleteFromSite, patchSite } from "@/lib/api";
import { supabase } from "@/lib/supabase";

/**
 * The rounds you are hosting.
 *
 * Reading is a plain RLS query over your own invites. Changing one is NOT:
 * both writes go through /api/app/tee-times/invites/[id].
 *
 * The app could perfectly well update the status column itself — the "Update
 * own invites" policy (0028) allows it and refuses everyone else's. What it
 * could not do is tell anyone. Cancelling notifies every member who asked,
 * was offered a place, or confirmed one, and that notification is assembled
 * on the server with the admin client. A round called off silently is a
 * member turning up to a tee time that isn't happening, which is the one
 * failure this whole feature exists to prevent.
 */

export type HostedRound = {
  id: number;
  club: string;
  playDate: string;
  timeFrom: string | null;
  timeTo: string | null;
  exactTeeTime: string | null;
  spacesAvailable: number;
  status: InviteStatus;
  ladiesOnly: boolean;
  /** Members still waiting on an answer from you. */
  pending: number;
  /** Members who have a place. */
  confirmed: number;
};

export type InviteStatus = "open" | "full" | "cancelled" | "completed";

export const STATUS_LABELS: Record<InviteStatus, string> = {
  open: "Open",
  full: "Full",
  cancelled: "Cancelled",
  completed: "Played",
};

type InviteRow = {
  id: number;
  club_name: string | null;
  play_date: string;
  time_from: string | null;
  time_to: string | null;
  exact_tee_time: string | null;
  spaces_available: number;
  status: InviteStatus;
  ladies_only: boolean;
  club: { name: string } | null;
};

/**
 * Every round you have posted, soonest first.
 *
 * The club embed is checked before `club_name`, for the reason rounds.ts
 * already documents: an invite posted from the app carries a club_id and
 * leaves club_name blank, so reading the raw column alone shows nothing for
 * exactly the rounds this screen is most likely to be showing.
 */
export async function listHostedRounds(userId: string): Promise<HostedRound[]> {
  const { data } = await supabase
    .from("tee_time_invites")
    .select(
      "id, club_name, play_date, time_from, time_to, exact_tee_time, spaces_available, status, ladies_only, club:clubs!tee_time_invites_club_id_fkey (name)"
    )
    .eq("member_id", userId)
    .order("play_date", { ascending: true })
    .order("id", { ascending: true })
    .limit(60)
    .returns<InviteRow[]>();

  const rows = data ?? [];
  if (rows.length === 0) return [];

  // One query for the interest counts rather than one per round.
  const { data: interests } = await supabase
    .from("tee_time_interests")
    .select("invite_id, status")
    .in(
      "invite_id",
      rows.map((row) => row.id)
    )
    .in("status", ["pending", "accepted", "confirmed"])
    .returns<{ invite_id: number; status: string }[]>();

  const pending = new Map<number, number>();
  const confirmed = new Map<number, number>();
  for (const row of interests ?? []) {
    const bucket = row.status === "pending" ? pending : confirmed;
    bucket.set(row.invite_id, (bucket.get(row.invite_id) ?? 0) + 1);
  }

  return rows.map((row) => ({
    id: row.id,
    club: row.club?.name ?? row.club_name ?? "A round",
    playDate: row.play_date,
    timeFrom: row.time_from,
    timeTo: row.time_to,
    exactTeeTime: row.exact_tee_time,
    spacesAvailable: row.spaces_available,
    status: row.status,
    ladiesOnly: row.ladies_only,
    pending: pending.get(row.id) ?? 0,
    confirmed: confirmed.get(row.id) ?? 0,
  }));
}

export async function setRoundStatus(inviteId: number, status: InviteStatus): Promise<void> {
  await patchSite<{ invite_id: number }>(`/api/app/tee-times/invites/${inviteId}`, { status });
}

export async function deleteRound(inviteId: number): Promise<void> {
  await deleteFromSite<{ deleted: true }>(`/api/app/tee-times/invites/${inviteId}`);
}

/** Rounds in the past are not things you can still fill, so the screen splits
 *  on this rather than on status alone — a round last month that is still
 *  "open" is history, not an opportunity. */
export function isPast(round: HostedRound): boolean {
  const day = new Date(`${round.playDate}T23:59:59`);
  return !Number.isNaN(day.getTime()) && day.getTime() < Date.now();
}
