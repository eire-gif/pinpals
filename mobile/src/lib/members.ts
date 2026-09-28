import { postToSite } from "./api";
import { countryName } from "./courses";
import { supabase } from "./supabase";

/**
 * The member directory, and your connections.
 *
 * Reads go straight to Supabase: `profiles` is readable by any signed-in
 * member (0001), and `member_age_bands` is a security-definer view that
 * returns a band and never a date of birth (0059).
 *
 * The connection writes go direct too, which is a deliberate exception to the
 * app's "every write goes through the site" rule — and the reason the rule
 * exists is worth restating so the exception stays honest. Writes go through
 * the website when a notification, an email or a push follows them, because
 * that code is TypeScript on the server. Connections have none: accepting a
 * request today tells the other member nothing at all. The RLS policies on
 * `connections` (0006) are also an exact match for the guards the website's
 * server action applies by hand — recipient only, pending only, accepted or
 * declined only — so a direct write is checked by the same rules and loses
 * nothing.
 *
 * If a connection ever starts notifying anybody, these two writes move to a
 * route and this comment comes with them.
 */

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export type Member = {
  id: string;
  name: string;
  homeClub: string | null;
  county: string | null;
  country: string | null;
  /** Null when not set, or when the member chose not to share it. */
  handicap: number | null;
  avatarUrl: string | null;
  avatarColor: string | null;
  ageBand: string | null;
};

export const MEMBER_SCOPES = ["everyone", "club", "connections"] as const;

export type MemberScope = (typeof MEMBER_SCOPES)[number];

export const MEMBER_SCOPE_LABELS: Record<MemberScope, string> = {
  everyone: "Everyone",
  club: "My club",
  connections: "Connected",
};

/** Same cap as the website's directory. No paging there either — and 60
 *  cards is already more than anyone scrolls before searching instead. */
const DIRECTORY_LIMIT = 60;

type ProfileRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  home_club: string | null;
  home_club_id: number | null;
  county: string | null;
  country: string | null;
  handicap: number | null;
  handicap_visible: boolean | null;
  avatar_url: string | null;
  avatar_color: string | null;
  created_at: string;
};

const PROFILE_SELECT =
  "id, first_name, last_name, home_club, home_club_id, county, country, handicap, handicap_visible, avatar_url, avatar_color, created_at";

const nameOf = (row: { first_name: string | null; last_name: string | null }): string =>
  [row.first_name, row.last_name].filter(Boolean).join(" ") || "A member";

const toMember = (row: ProfileRow, ageBand: string | null): Member => ({
  id: row.id,
  name: nameOf(row),
  homeClub: row.home_club,
  county: row.county,
  country: row.country,
  // handicap_visible is the member's own choice and the only place it is
  // honoured — so it is applied here, once, rather than in each screen.
  handicap: row.handicap_visible ? row.handicap : null,
  avatarUrl: row.avatar_url,
  avatarColor: row.avatar_color,
  ageBand,
});

export type Directory = {
  members: Member[];
  /** Keyed by member id, for the button on each card. */
  connections: Map<string, ConnectionState>;
  /** True when the chosen scope cannot return anything yet — no home club
   *  set, or nobody connected. The screen says which rather than showing an
   *  empty list that looks like a failure. */
  unavailable: false | "no-club" | "no-connections";
};

export async function listMembers(
  userId: string,
  scope: MemberScope,
  query: string
): Promise<Directory> {
  const [{ data: me }, links] = await Promise.all([
    supabase
      .from("profiles")
      .select("home_club, home_club_id")
      .eq("id", userId)
      .maybeSingle()
      .overrideTypes<{ home_club: string | null; home_club_id: number | null }>(),
    listConnectionLinks(userId),
  ]);

  const connectedIds = [...links.entries()]
    .filter(([, state]) => state.status === "accepted")
    .map(([id]) => id);

  if (scope === "club" && !me?.home_club_id && !me?.home_club) {
    return { members: [], connections: stateMap(links), unavailable: "no-club" };
  }
  if (scope === "connections" && connectedIds.length === 0) {
    return { members: [], connections: stateMap(links), unavailable: "no-connections" };
  }

  let request = supabase.from("profiles").select(PROFILE_SELECT).neq("id", userId);

  if (scope === "club") {
    request = me?.home_club_id
      ? request.eq("home_club_id", me.home_club_id)
      : request.eq("home_club", me?.home_club ?? "");
  } else if (scope === "connections") {
    request = request.in("id", connectedIds);
  }

  const trimmed = query.trim();
  if (trimmed) {
    // ilike on three columns, same as the website. Commas and parentheses
    // would break .or()'s own syntax, so they come out first.
    const safe = trimmed.replace(/[,()]/g, " ").trim();
    if (safe) {
      request = request.or(
        `first_name.ilike.%${safe}%,last_name.ilike.%${safe}%,home_club.ilike.%${safe}%`
      );
    }
  }

  const { data } = await request
    .order("created_at", { ascending: false })
    .limit(DIRECTORY_LIMIT)
    .overrideTypes<ProfileRow[]>();

  const rows = data ?? [];
  const bands = await ageBands(rows.map((row) => row.id));

  return {
    members: rows.map((row) => toMember(row, bands.get(row.id) ?? null)),
    connections: stateMap(links),
    unavailable: false,
  };
}

/** Age is shown as a band and never a date. The view is what enforces that,
 *  not this call — a member with no birthdate on file simply has no row. */
async function ageBands(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabase
    .from("member_age_bands")
    .select("user_id, age_band")
    .in("user_id", ids)
    .overrideTypes<{ user_id: string; age_band: string }[]>();
  return new Map((data ?? []).map((row) => [row.user_id, row.age_band]));
}

export const memberPlace = (member: Member): string =>
  [member.county, countryName(member.country ?? "")].filter(Boolean).join(", ");

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

export type ConnectionStatus = "pending" | "accepted" | "declined";

export type ConnectionState = {
  connectionId: number;
  status: ConnectionStatus;
  /** True when the other member asked and the answer is yours to give. */
  theirsToAnswer: boolean;
};

type ConnectionRow = {
  id: number;
  requester_id: string;
  recipient_id: string;
  status: ConnectionStatus;
  updated_at: string;
  requester: ProfileRow | null;
  recipient: ProfileRow | null;
};

const CONNECTION_SELECT = `id, requester_id, recipient_id, status, updated_at, requester:profiles!connections_requester_id_fkey (${PROFILE_SELECT}), recipient:profiles!connections_recipient_id_fkey (${PROFILE_SELECT})`;

/** Every row involving me, keyed by the OTHER member. One query answers both
 *  "who am I connected to" and "what should this card's button say". */
async function listConnectionLinks(
  userId: string
): Promise<Map<string, ConnectionState & { row: ConnectionRow }>> {
  const { data } = await supabase
    .from("connections")
    .select(CONNECTION_SELECT)
    .or(`requester_id.eq.${userId},recipient_id.eq.${userId}`)
    .order("updated_at", { ascending: false })
    .overrideTypes<ConnectionRow[]>();

  const map = new Map<string, ConnectionState & { row: ConnectionRow }>();
  for (const row of data ?? []) {
    const otherId = row.requester_id === userId ? row.recipient_id : row.requester_id;
    map.set(otherId, {
      connectionId: row.id,
      status: row.status,
      theirsToAnswer: row.recipient_id === userId && row.status === "pending",
      row,
    });
  }
  return map;
}

const stateMap = (
  links: Map<string, ConnectionState & { row: ConnectionRow }>
): Map<string, ConnectionState> =>
  new Map(
    [...links.entries()].map(([id, { connectionId, status, theirsToAnswer }]) => [
      id,
      { connectionId, status, theirsToAnswer },
    ])
  );

export type Connections = {
  /** Requests waiting on YOU. First on the screen, because they are the only
   *  thing here that needs doing. */
  incoming: { connectionId: number; member: Member }[];
  accepted: Member[];
  /** Requests you sent that have not been answered. Shown so nobody sends
   *  the same one twice wondering why nothing happened. */
  outgoing: Member[];
};

export async function listConnections(userId: string): Promise<Connections> {
  const links = await listConnectionLinks(userId);

  const ids = [...links.keys()];
  const bands = await ageBands(ids);

  const incoming: Connections["incoming"] = [];
  const accepted: Member[] = [];
  const outgoing: Member[] = [];

  for (const [otherId, link] of links) {
    const profile = link.row.requester_id === userId ? link.row.recipient : link.row.requester;
    if (!profile) continue;
    const member = toMember(profile, bands.get(otherId) ?? null);

    if (link.status === "accepted") accepted.push(member);
    else if (link.theirsToAnswer) incoming.push({ connectionId: link.connectionId, member });
    else if (link.status === "pending") outgoing.push(member);
  }

  return { incoming, accepted, outgoing };
}

/**
 * Asks to connect.
 *
 * A previously declined row is deleted first, exactly as the website does —
 * the unique index is on the PAIR, so "connect again" after a no would
 * otherwise fail on a duplicate rather than send anything. RLS only allows
 * that delete while the row is declined, which is the whole guard.
 */
export async function requestConnection(userId: string, recipientId: string): Promise<void> {
  const { data: existing } = await supabase
    .from("connections")
    .select("id, status")
    .or(
      `and(requester_id.eq.${userId},recipient_id.eq.${recipientId}),and(requester_id.eq.${recipientId},recipient_id.eq.${userId})`
    )
    .maybeSingle()
    .overrideTypes<{ id: number; status: ConnectionStatus }>();

  if (existing?.status === "pending" || existing?.status === "accepted") {
    throw new Error("You've already got a request with this golfer.");
  }

  if (existing?.status === "declined") {
    await supabase.from("connections").delete().eq("id", existing.id);
  }

  const { error } = await supabase
    .from("connections")
    .insert({ requester_id: userId, recipient_id: recipientId });

  if (error) throw new Error("Couldn't send that request. Please try again.");
}

/** Accept or decline a request somebody sent you. The `.eq` guards mirror the
 *  UPDATE policy rather than replacing it — RLS refuses the row either way,
 *  and matching it here turns a refusal into zero rows instead of an error. */
export async function respondToConnection(
  connectionId: number,
  userId: string,
  accept: boolean
): Promise<void> {
  const { error } = await supabase
    .from("connections")
    .update({ status: accept ? "accepted" : "declined" })
    .eq("id", connectionId)
    .eq("recipient_id", userId)
    .eq("status", "pending");

  if (error) throw new Error("Couldn't save that. Please try again.");
}

// ---------------------------------------------------------------------------
// Messaging a member
// ---------------------------------------------------------------------------

/**
 * Finds or starts the conversation with another member, and returns its id.
 *
 * Through the site, not direct: `can_message()` decides whether this pair may
 * talk at all, and the website's own version rate-limits how many
 * conversations one member may start. Reimplementing either here would mean
 * two answers to the same question.
 */
export async function conversationWith(otherUserId: string): Promise<number> {
  const { conversation_id } = await postToSite<{ conversation_id: number }>(
    "/api/app/conversations",
    { other_user_id: otherUserId }
  );
  return conversation_id;
}
