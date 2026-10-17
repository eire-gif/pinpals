import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildMyRounds,
  localIso,
  type InterestRow,
  type InterestStatus,
  type InviteStatus,
  type MyRoundsView,
  type Person,
  type RoundRow,
} from "./my-rounds-rules";

/**
 * My rounds on the website (/tee-times/mine): reading every tee time a
 * member is part of, either side. The same three reads as the app's
 * mobile/src/lib/my-rounds.ts, with the caller's own cookie client, so RLS
 * decides exactly as it does there. What each round SAYS is decided in
 * my-rounds-rules.ts, which is the same file in both.
 *
 * Three reads, two of them in parallel:
 *   1. rounds I posted                      tee_time_invites, my member_id
 *   2. rounds I asked to join, with mine    tee_time_interests, my member_id
 *   3. everyone else on any of those        tee_time_interests by invite_id
 *
 * RLS decides who comes back in the third. A host sees every request on
 * their own round; a golfer sees the other confirmed players (0078/0084).
 * Since 0165 a golfer can also still read a round once it is full,
 * cancelled or played — before that, those rows simply came back empty.
 *
 * The writes are the shared operations in tee-times-operations.ts, which
 * tell the other side; the page's Server Actions call them.
 */

/** How far back Played reaches. */
const PLAYED_DAYS = 30;

type ProfileRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  avatar_color: string | null;
  home_club: string | null;
  handicap: number | null;
  handicap_visible: boolean | null;
};

const PROFILE = "id, first_name, last_name, avatar_url, avatar_color, home_club, handicap, handicap_visible";

type InviteRowDb = {
  id: number;
  club_name: string | null;
  club_id: number | null;
  club: { name: string; town: string | null; country: string } | null;
  play_date: string;
  exact_tee_time: string | null;
  time_from: string | null;
  time_to: string | null;
  spaces_available: number;
  status: InviteStatus;
  host?: ProfileRow | null;
};

const INVITE =
  "id, club_name, club_id, club:clubs!tee_time_invites_club_id_fkey (name, town, country), play_date, exact_tee_time, time_from, time_to, spaces_available, status";

type InterestRowDb = {
  id: number;
  invite_id: number;
  member_id: string;
  status: InterestStatus;
  withdrawn_at: string | null;
  updated_at: string;
  member?: ProfileRow | null;
};

function toPerson(p: ProfileRow | null | undefined, fallbackId: string): Person {
  return {
    id: p?.id ?? fallbackId,
    name: [p?.first_name, p?.last_name].filter(Boolean).join(" ") || "A member",
    avatarUrl: p?.avatar_url ?? null,
    avatarColor: p?.avatar_color ?? null,
    homeClub: p?.home_club ?? null,
    handicap: p?.handicap_visible && p.handicap !== null ? p.handicap : null,
  };
}

function toRound(row: InviteRowDb, host: Person): RoundRow {
  return {
    id: row.id,
    // The club embed before club_name: an app-posted round carries club_id
    // and leaves club_name blank (rounds.ts says why).
    club: row.club?.name ?? row.club_name ?? "Tee time",
    clubRef: row.club_id && row.club ? { id: row.club_id, ...row.club } : null,
    playDate: row.play_date,
    exactTeeTime: row.exact_tee_time,
    timeFrom: row.time_from,
    timeTo: row.time_to,
    spacesAvailable: row.spaces_available,
    status: row.status,
    host,
  };
}

function toInterest(row: InterestRowDb): InterestRow {
  return {
    id: row.id,
    inviteId: row.invite_id,
    memberId: row.member_id,
    status: row.status,
    withdrawn: !!row.withdrawn_at,
    updatedAt: row.updated_at,
    member: row.member ? toPerson(row.member, row.member_id) : null,
  };
}

export async function loadMyRounds(supabase: SupabaseClient, userId: string, now = new Date()): Promise<MyRoundsView> {
  const since = new Date(now);
  since.setDate(since.getDate() - PLAYED_DAYS);
  const sinceIso = localIso(since);

  const [hostedResult, joinedResult] = await Promise.all([
    supabase
      .from("tee_time_invites")
      .select(INVITE)
      .eq("member_id", userId)
      .gte("play_date", sinceIso)
      .order("play_date", { ascending: true })
      .limit(80)
      .overrideTypes<InviteRowDb[]>(),

    supabase
      .from("tee_time_interests")
      .select(
        `id, invite_id, member_id, status, withdrawn_at, updated_at,
         invite:tee_time_invites!inner (${INVITE},
           host:profiles!tee_time_invites_member_id_fkey (${PROFILE}))`
      )
      .eq("member_id", userId)
      .gte("invite.play_date", sinceIso)
      .limit(80)
      .overrideTypes<(InterestRowDb & { invite: InviteRowDb | null })[]>(),
  ]);

  if (hostedResult.error) throw hostedResult.error;
  if (joinedResult.error) throw joinedResult.error;

  const you: Person = { id: userId, name: "You", avatarUrl: null, avatarColor: null, homeClub: null, handicap: null };
  const hosted = (hostedResult.data ?? []).map((row) => toRound(row, you));

  const joined: { mine: InterestRow; round: RoundRow }[] = [];
  for (const row of joinedResult.data ?? []) {
    const invite = row.invite;
    // A round you posted can't also be one you joined; the guard is free.
    if (!invite || invite.host?.id === userId) continue;
    joined.push({ mine: toInterest(row), round: toRound(invite, toPerson(invite.host, "")) });
  }

  const ids = [...hosted.map((r) => r.id), ...joined.map((j) => j.round.id)];
  let interests: InterestRow[] = [];
  if (ids.length > 0) {
    const { data, error } = await supabase
      .from("tee_time_interests")
      .select(
        `id, invite_id, member_id, status, withdrawn_at, updated_at,
         member:profiles!tee_time_interests_member_id_fkey (${PROFILE})`
      )
      .in("invite_id", ids)
      .neq("member_id", userId)
      .overrideTypes<InterestRowDb[]>();
    if (error) throw error;
    interests = (data ?? []).map(toInterest);
  }

  return buildMyRounds({ userId, hosted, joined, interests, now });
}

/**
 * Just the number of answers owed — the count on the My rounds tab. Requests
 * on my own rounds still to come, and places offered to me on rounds still
 * to come: the rows the page puts in "Needs your answer".
 */
export async function countNeedsAnswer(supabase: SupabaseClient, userId: string): Promise<number> {
  const today = localIso(new Date());
  const [mine, offers] = await Promise.all([
    supabase
      .from("tee_time_invites")
      .select("id")
      .eq("member_id", userId)
      .in("status", ["open", "full"])
      .gte("play_date", today)
      .overrideTypes<{ id: number }[]>(),
    supabase
      .from("tee_time_interests")
      .select("id, invite:tee_time_invites!inner(play_date, status)", { count: "exact", head: true })
      .eq("member_id", userId)
      .eq("status", "accepted")
      .gte("invite.play_date", today)
      .neq("invite.status", "cancelled"),
  ]);

  const ids = (mine.data ?? []).map((r) => r.id);
  let requests = 0;
  if (ids.length > 0) {
    const { count } = await supabase
      .from("tee_time_interests")
      .select("id", { count: "exact", head: true })
      .in("invite_id", ids)
      .eq("status", "pending");
    requests = count ?? 0;
  }
  return requests + (offers.count ?? 0);
}
