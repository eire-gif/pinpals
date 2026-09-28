import { supabase } from "./supabase";
import { clockTime, todayIso } from "./tee-times";

/**
 * The two tee-time screens that are about YOUR rounds rather than everyone's.
 *
 * Reads only. RLS decides what comes back — 0078's policy on
 * `tee_time_interests` is what lets a confirmed player see the rest of the
 * fourball, and nothing here re-implements that. Both writes these screens
 * offer (confirm a place, pull out) already live in tee-time-interest.ts and
 * go through /api/app/tee-times/interest/confirm, because the RPC moves the
 * spaces and the TypeScript around it is what tells the host.
 */

// ---------------------------------------------------------------------------
// Shared invite shape
// ---------------------------------------------------------------------------

type InviteRow = {
  id: number;
  club_name: string | null;
  play_date: string;
  time_from: string | null;
  time_to: string | null;
  exact_tee_time: string | null;
  club: { name: string } | null;
};

const INVITE_SELECT =
  "id, club_name, play_date, time_from, time_to, exact_tee_time, club:clubs!tee_time_invites_club_id_fkey (name)";

/** Both are checked, same as home.ts: an invite posted from the app carries
 *  `club_id` and leaves `club_name` null, while older website rows have the
 *  text. The website's own confirmed page reads `club_name` raw and shows a
 *  blank for every app-posted round — this does not. */
const clubOf = (row: InviteRow): string =>
  row.club?.name ?? row.club_name ?? "Tee time";

const whenOf = (row: InviteRow): string => {
  const exact = clockTime(row.exact_tee_time);
  if (exact) return exact;
  const from = clockTime(row.time_from);
  const to = clockTime(row.time_to);
  if (from && to) return `${from} – ${to}`;
  return from ?? "Time flexible";
};

// ---------------------------------------------------------------------------
// Confirmed rounds
// ---------------------------------------------------------------------------

export type Player = { name: string; homeClub: string | null };

export type ConfirmedRound = {
  inviteId: number;
  club: string;
  playDate: string;
  when: string;
  role: "hosting" | "playing";
  /** Everyone else confirmed for this round. Empty while a host waits for
   *  someone to confirm, which is a different thing from nobody being
   *  interested — the screen says so. */
  players: Player[];
};

export type ConfirmedRounds = { upcoming: ConfirmedRound[]; past: ConfirmedRound[] };

type PlayerRow = {
  invite_id: number;
  member_id: string;
  profiles: { first_name: string | null; last_name: string | null; home_club: string | null } | null;
};

/**
 * Every round you are actually playing in, hosted or joined.
 *
 * Three queries, because there is no single one that reaches both sides:
 * a round you posted is a row in `tee_time_invites`, a round you joined is a
 * row in `tee_time_interests`, and the other players are a third read across
 * whichever invites came back. Two round trips, not one per round.
 */
export async function listConfirmedRounds(userId: string): Promise<ConfirmedRounds> {
  const [hostedResult, joinedResult] = await Promise.all([
    // `!inner` plus the status filter is what makes this "rounds I host that
    // somebody has confirmed for" rather than "rounds I posted".
    supabase
      .from("tee_time_invites")
      .select(`${INVITE_SELECT}, tee_time_interests!inner (id)`)
      .eq("member_id", userId)
      .eq("tee_time_interests.status", "confirmed")
      .overrideTypes<InviteRow[]>(),

    supabase
      .from("tee_time_interests")
      .select(`invite:tee_time_invites (${INVITE_SELECT})`)
      .eq("member_id", userId)
      .eq("status", "confirmed")
      .overrideTypes<{ invite: InviteRow | null }[]>(),
  ]);

  const rounds = new Map<number, ConfirmedRound>();

  for (const row of hostedResult.data ?? []) {
    rounds.set(row.id, {
      inviteId: row.id,
      club: clubOf(row),
      playDate: row.play_date,
      when: whenOf(row),
      role: "hosting",
      players: [],
    });
  }

  for (const row of joinedResult.data ?? []) {
    // A round you host cannot also be one you joined, but the guard is free
    // and keeps a duplicate off the screen if that ever stops being true.
    if (row.invite && !rounds.has(row.invite.id)) {
      rounds.set(row.invite.id, {
        inviteId: row.invite.id,
        club: clubOf(row.invite),
        playDate: row.invite.play_date,
        when: whenOf(row.invite),
        role: "playing",
        players: [],
      });
    }
  }

  const inviteIds = [...rounds.keys()];
  if (inviteIds.length > 0) {
    const { data } = await supabase
      .from("tee_time_interests")
      .select("invite_id, member_id, profiles (first_name, last_name, home_club)")
      .in("invite_id", inviteIds)
      .eq("status", "confirmed")
      .overrideTypes<PlayerRow[]>();

    for (const row of data ?? []) {
      // You are not one of your own playing partners.
      if (row.member_id === userId) continue;
      const round = rounds.get(row.invite_id);
      if (!round) continue;
      round.players.push({
        name:
          [row.profiles?.first_name, row.profiles?.last_name]
            .filter(Boolean)
            .join(" ") || "A member",
        homeClub: row.profiles?.home_club ?? null,
      });
    }
  }

  // Soonest first for what is still to come, most recent first for what is
  // done — the two lists answer opposite questions.
  const today = todayIso();
  const all = [...rounds.values()];

  return {
    upcoming: all
      .filter((round) => round.playDate >= today)
      .sort((a, b) => a.playDate.localeCompare(b.playDate)),
    past: all
      .filter((round) => round.playDate < today)
      .sort((a, b) => b.playDate.localeCompare(a.playDate)),
  };
}

// ---------------------------------------------------------------------------
// Rounds I have asked to join
// ---------------------------------------------------------------------------

export type RequestStatus = "pending" | "accepted" | "confirmed" | "declined";

export type MyRequest = {
  interestId: number;
  inviteId: number;
  status: RequestStatus;
  club: string;
  playDate: string;
  when: string;
  createdAt: string;
};

type MyRequestRow = {
  id: number;
  status: RequestStatus;
  created_at: string;
  invite: InviteRow | null;
};

/**
 * Every round you have asked to join, whatever came of it.
 *
 * Declined ones stay in the list on purpose — "they said no" is an answer,
 * and a request that silently vanishes reads as a bug. `accepted` is sorted
 * to the top because it is the only status that needs the member to do
 * something: a place has been offered and it expires if nobody confirms it.
 */
export async function listMyRequests(userId: string): Promise<MyRequest[]> {
  const { data } = await supabase
    .from("tee_time_interests")
    .select(`id, status, created_at, invite:tee_time_invites (${INVITE_SELECT})`)
    .eq("member_id", userId)
    .order("created_at", { ascending: false })
    .overrideTypes<MyRequestRow[]>();

  const rows = (data ?? []).filter(
    (row): row is MyRequestRow & { invite: InviteRow } => row.invite !== null
  );

  return rows
    .map((row) => ({
      interestId: row.id,
      inviteId: row.invite.id,
      status: row.status,
      club: clubOf(row.invite),
      playDate: row.invite.play_date,
      when: whenOf(row.invite),
      createdAt: row.created_at,
    }))
    .sort((a, b) => {
      const byAction = Number(b.status === "accepted") - Number(a.status === "accepted");
      return byAction !== 0 ? byAction : b.createdAt.localeCompare(a.createdAt);
    });
}

/** The label a member reads, rather than the column value. */
export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  pending: "Waiting on the host",
  accepted: "Place offered — confirm it",
  confirmed: "You're playing",
  declined: "Not this time",
};

// ---------------------------------------------------------------------------
// Who is already playing
// ---------------------------------------------------------------------------

/**
 * The confirmed players on one round, for the invite screen.
 *
 * Whether this returns anything is RLS's decision, not this function's. Until
 * 0084 only the host and the other confirmed players could read these rows;
 * now anyone who can see a round that is still open with a space left can see
 * who is in it, because "who would I be playing with" is the question that
 * decides whether somebody asks to join at all.
 *
 * Once the round fills, this quietly returns nothing again, and the screen
 * says nothing rather than something wrong. That is the right shape for a
 * permission boundary: ask, render what comes back.
 */
export async function listConfirmedPlayers(
  inviteId: number,
  excludeUserId: string | null
): Promise<Player[]> {
  const { data } = await supabase
    .from("tee_time_interests")
    .select("member_id, profiles (first_name, last_name, home_club)")
    .eq("invite_id", inviteId)
    .eq("status", "confirmed")
    .overrideTypes<Omit<PlayerRow, "invite_id">[]>();

  return (data ?? [])
    .filter((row) => row.member_id !== excludeUserId)
    .map((row) => ({
      name:
        [row.profiles?.first_name, row.profiles?.last_name].filter(Boolean).join(" ") ||
        "A member",
      homeClub: row.profiles?.home_club ?? null,
    }));
}
