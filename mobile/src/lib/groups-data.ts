import * as SecureStore from "expo-secure-store";

import { postFormToSite, postToSite, type UploadFile } from "@/lib/api";
import { SITE_URL } from "@/lib/config";
import { groupInvitePath, isGroupKind, isGroupOffice, type GroupKind, type GroupOffice, type GroupPrivacy, type GroupRole } from "@/lib/groups";
import { supabase } from "@/lib/supabase";

/**
 * Groups (0120): reading and changing them from the app.
 *
 * READS are plain selects under RLS. Every write is one of 0120's functions,
 * which hold all the rules (who may invite, capacity, blocks); their error
 * messages are written for members, so screens show them as they come.
 *
 * NEVER `select("*")` FROM groups. Its invite_code column is withheld from
 * members by a column grant (the link comes only from group_invite_code()),
 * so a star select is refused outright. GROUP_COLUMNS is the list.
 *
 * NOTIFICATIONS go through the website (push, email and preferences live
 * there): after an invite, a request or an approval, the app asks
 * /api/app/groups/<id>/notify, fire-and-forget, the same way live scoring
 * does. A failed notify never fails the action itself.
 */

const GROUP_COLUMNS = "id, kind, name, about, privacy, features, members_can_invite, member_count, club_id, starts_on, ends_on, conversation_id, created_at, cover_url, logo_url, club:clubs(name)";

type GroupRow = {
  id: number;
  kind: string;
  name: string;
  about: string | null;
  privacy: GroupPrivacy;
  features: string[];
  members_can_invite: boolean;
  member_count: number;
  club_id: number | null;
  starts_on: string | null;
  ends_on: string | null;
  conversation_id: number | null;
  created_at: string;
  cover_url?: string | null;
  logo_url?: string | null;
  club: { name: string } | null;
};

export type Group = {
  id: number;
  kind: GroupKind;
  name: string;
  about: string | null;
  privacy: GroupPrivacy;
  features: string[];
  membersCanInvite: boolean;
  memberCount: number;
  clubId: number | null;
  clubName: string | null;
  startsOn: string | null;
  endsOn: string | null;
  conversationId: number | null;
  /** The photograph across the top of its page (0124). */
  coverUrl: string | null;
  /** Its own badge, in place of the kind's icon (0124). */
  logoUrl: string | null;
};

const toGroup = (r: GroupRow): Group => ({
  id: r.id,
  kind: isGroupKind(r.kind) ? r.kind : "crew",
  name: r.name,
  about: r.about,
  privacy: r.privacy,
  features: r.features ?? [],
  membersCanInvite: r.members_can_invite,
  memberCount: r.member_count,
  clubId: r.club_id,
  clubName: r.club?.name ?? null,
  startsOn: r.starts_on,
  endsOn: r.ends_on,
  conversationId: r.conversation_id,
  coverUrl: r.cover_url ?? null,
  logoUrl: r.logo_url ?? null,
});

type PersonRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  home_club: string | null;
  avatar_url: string | null;
  avatar_color: string | null;
};

const PERSON = "id, first_name, last_name, home_club, avatar_url, avatar_color";

export type Person = { id: string; name: string; homeClub: string | null; avatarUrl: string | null; avatarColor: string | null };

const toPerson = (p: PersonRow | null, fallbackId: string): Person => ({
  id: p?.id ?? fallbackId,
  name: [p?.first_name, p?.last_name].filter(Boolean).join(" ") || "A member",
  homeClub: p?.home_club ?? null,
  avatarUrl: p?.avatar_url ?? null,
  avatarColor: p?.avatar_color ?? null,
});

function fail(error: { message: string } | null, fallback: string): never {
  throw new Error(error?.message || fallback);
}

// ---------------------------------------------------------------------------
// Your groups
// ---------------------------------------------------------------------------

export type MyGroups = {
  groups: (Group & { role: GroupRole; office?: GroupOffice | null })[];
  /** Pending invitations to you, newest first. */
  invitations: (Group & { invitedBy: string | null })[];
  /** Societies you've asked to join and are waiting on. */
  requested: Group[];
};

export async function loadMyGroups(userId: string): Promise<MyGroups> {
  const [mine, waiting] = await Promise.all([
    supabase
      .from("group_members")
      .select(`role, office, joined_at, group:groups(${GROUP_COLUMNS})`)
      .eq("member_id", userId)
      .order("joined_at", { ascending: false })
      .overrideTypes<{ role: GroupRole; office: string | null; joined_at: string; group: GroupRow | null }[]>(),
    supabase
      .from("group_invitations")
      .select(`direction, created_at, inviter:profiles!group_invitations_invited_by_fkey(first_name), group:groups(${GROUP_COLUMNS})`)
      .eq("member_id", userId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .overrideTypes<{ direction: "invite" | "request"; created_at: string; inviter: { first_name: string | null } | null; group: GroupRow | null }[]>(),
  ]);
  if (mine.error) fail(mine.error, "Couldn't load your groups.");
  if (waiting.error) fail(waiting.error, "Couldn't load your groups.");

  return {
    groups: (mine.data ?? []).filter((r) => r.group).map((r) => ({ ...toGroup(r.group as GroupRow), role: r.role, office: isGroupOffice(r.office) ? r.office : null })),
    invitations: (waiting.data ?? [])
      .filter((r) => r.direction === "invite" && r.group)
      .map((r) => ({ ...toGroup(r.group as GroupRow), invitedBy: r.inviter?.first_name ?? null })),
    requested: (waiting.data ?? []).filter((r) => r.direction === "request" && r.group).map((r) => toGroup(r.group as GroupRow)),
  };
}

/** How many invitations are waiting on you — for Home's strip. */
export async function countGroupInvitations(userId: string): Promise<number> {
  const { count } = await supabase
    .from("group_invitations")
    .select("id", { count: "exact", head: true })
    .eq("member_id", userId)
    .eq("direction", "invite")
    .eq("status", "pending");
  return count ?? 0;
}

/** Societies anyone can find and ask to join, by name. */
export async function searchSocieties(query: string): Promise<Group[]> {
  const q = query.trim().replace(/[%_\\]/g, (c) => `\\${c}`);
  let request = supabase.from("groups").select(GROUP_COLUMNS).eq("privacy", "request").order("name").limit(30);
  if (q) request = request.ilike("name", `%${q}%`);
  const { data, error } = await request;
  if (error) fail(error, "Couldn't search just now.");
  return ((data ?? []) as unknown as GroupRow[]).map(toGroup);
}

// ---------------------------------------------------------------------------
// One group
// ---------------------------------------------------------------------------

export type GroupMember = Person & {
  role: GroupRole;
  /** A society's captain or secretary (0122). */
  office: GroupOffice | null;
  /** The index the society plays them off, when an officer has set one (0122). */
  societyIndex: number | null;
  joinedAt: string;
};
export type JoinRequest = Person & { askedAt: string };

export type GroupPage = {
  group: Group;
  /** Null when you're not in it. */
  myRole: GroupRole | null;
  /** Your office in a society, if you hold one (0122). */
  myOffice: GroupOffice | null;
  /** Your own invitation or request to it, if any is waiting. */
  myPending: "invite" | "request" | null;
  muted: boolean;
  /** Empty unless you're a member: who's in a group is for its members. */
  members: GroupMember[];
  /** Only for owner and admins. */
  requests: JoinRequest[];
};

const ROLE_ORDER: Record<GroupRole, number> = { owner: 0, admin: 1, member: 2 };
/** Captain before secretary, both before everyone else. */
const officeOrder = (o: GroupOffice | null) => (o === "captain" ? 0 : o === "secretary" ? 1 : 2);

/** Null when the group doesn't exist or you can't see it. */
export async function loadGroupPage(groupId: number, userId: string): Promise<GroupPage | null> {
  const { data: row, error } = await supabase.from("groups").select(GROUP_COLUMNS).eq("id", groupId).maybeSingle<GroupRow>();
  if (error) fail(error, "Couldn't load this group.");
  if (!row) return null;

  const [me, pending] = await Promise.all([
    supabase.from("group_members").select("role, muted").eq("group_id", groupId).eq("member_id", userId).maybeSingle<{ role: GroupRole; muted: boolean }>(),
    supabase
      .from("group_invitations")
      .select("direction")
      .eq("group_id", groupId)
      .eq("member_id", userId)
      .eq("status", "pending")
      .maybeSingle<{ direction: "invite" | "request" }>(),
  ]);
  const myRole = me.data?.role ?? null;

  let members: GroupMember[] = [];
  let requests: JoinRequest[] = [];
  if (myRole) {
    const { data, error: membersError } = await supabase
      .from("group_members")
      .select(`member_id, role, office, society_index, joined_at, profile:profiles(${PERSON})`)
      .eq("group_id", groupId)
      .overrideTypes<{ member_id: string; role: GroupRole; office: string | null; society_index: number | null; joined_at: string; profile: PersonRow | null }[]>();
    if (membersError) fail(membersError, "Couldn't load the members.");
    members = (data ?? [])
      .map((m) => ({
        ...toPerson(m.profile, m.member_id),
        role: m.role,
        office: isGroupOffice(m.office) ? m.office : null,
        societyIndex: m.society_index != null ? Number(m.society_index) : null,
        joinedAt: m.joined_at,
      }))
      .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || officeOrder(a.office) - officeOrder(b.office) || a.name.localeCompare(b.name, "en-IE"));

    if (myRole !== "member") {
      const { data: asks } = await supabase
        .from("group_invitations")
        .select(`member_id, created_at, profile:profiles!group_invitations_member_id_fkey(${PERSON})`)
        .eq("group_id", groupId)
        .eq("direction", "request")
        .eq("status", "pending")
        .order("created_at")
        .overrideTypes<{ member_id: string; created_at: string; profile: PersonRow | null }[]>();
      requests = (asks ?? []).map((r) => ({ ...toPerson(r.profile, r.member_id), askedAt: r.created_at }));
    }
  }

  return {
    group: toGroup(row),
    myRole,
    myOffice: members.find((m) => m.id === userId)?.office ?? null,
    myPending: myRole ? null : (pending.data?.direction ?? null),
    muted: me.data?.muted ?? false,
    members,
    requests,
  };
}

// ---------------------------------------------------------------------------
// Changes (each one of 0120's functions)
// ---------------------------------------------------------------------------

const notify = (groupId: number, body: { event: "invited" | "requested" | "approved"; memberId?: string }) =>
  void postToSite(`/api/app/groups/${groupId}/notify`, body).catch(() => undefined);

export async function createGroup(input: {
  kind: "crew" | "trip" | "society";
  name: string;
  about?: string | null;
  clubId?: number | null;
  startsOn?: string | null;
  endsOn?: string | null;
}): Promise<number> {
  const { data, error } = await supabase.rpc("create_group", {
    p_kind: input.kind,
    p_name: input.name,
    p_about: input.about ?? null,
    p_club_id: input.clubId ?? null,
    p_starts_on: input.startsOn ?? null,
    p_ends_on: input.endsOn ?? null,
  });
  if (error) fail(error, "Couldn't create the group.");
  return Number(data);
}

export async function updateGroup(
  groupId: number,
  input: { name: string; about: string | null; membersCanInvite: boolean; clubId: number | null; startsOn: string | null; endsOn: string | null }
): Promise<void> {
  const { error } = await supabase.rpc("update_group", {
    p_group_id: groupId,
    p_name: input.name,
    p_about: input.about,
    p_members_can_invite: input.membersCanInvite,
    p_club_id: input.clubId,
    p_starts_on: input.startsOn,
    p_ends_on: input.endsOn,
  });
  if (error) fail(error, "Couldn't save the changes.");
}

export async function deleteGroup(groupId: number): Promise<void> {
  const { error } = await supabase.rpc("delete_group", { p_group_id: groupId });
  if (error) fail(error, "Couldn't delete the group.");
}

/** Returns how many were invited. Skips anyone who can't be. */
export async function inviteToGroup(groupId: number, memberIds: string[]): Promise<number> {
  const { data, error } = await supabase.rpc("invite_to_group", { p_group_id: groupId, p_member_ids: memberIds });
  if (error) fail(error, "Couldn't send the invitations.");
  const sent = Number(data ?? 0);
  if (sent > 0) notify(groupId, { event: "invited" });
  return sent;
}

export async function respondToInvitation(groupId: number, accept: boolean): Promise<void> {
  const { error } = await supabase.rpc("respond_group_invitation", { p_group_id: groupId, p_accept: accept });
  if (error) fail(error, "Couldn't answer the invitation.");
}

export async function requestToJoin(groupId: number): Promise<"joined" | "requested"> {
  const { data, error } = await supabase.rpc("request_to_join_group", { p_group_id: groupId });
  if (error) fail(error, "Couldn't send your request.");
  const result = data === "joined" ? "joined" : "requested";
  if (result === "requested") notify(groupId, { event: "requested" });
  return result;
}

export async function withdrawRequest(groupId: number): Promise<void> {
  const { error } = await supabase.rpc("withdraw_group_request", { p_group_id: groupId });
  if (error) fail(error, "Couldn't withdraw your request.");
}

export async function reviewRequest(groupId: number, memberId: string, approve: boolean): Promise<void> {
  const { error } = await supabase.rpc("review_group_request", { p_group_id: groupId, p_member_id: memberId, p_approve: approve });
  if (error) fail(error, "Couldn't answer that request.");
  if (approve) notify(groupId, { event: "approved", memberId });
}

export async function leaveGroup(groupId: number): Promise<void> {
  const { error } = await supabase.rpc("leave_group", { p_group_id: groupId });
  if (error) fail(error, "Couldn't leave the group.");
}

export async function removeMember(groupId: number, memberId: string): Promise<void> {
  const { error } = await supabase.rpc("remove_group_member", { p_group_id: groupId, p_member_id: memberId });
  if (error) fail(error, "Couldn't remove them.");
}

export async function setMemberRole(groupId: number, memberId: string, role: GroupRole): Promise<void> {
  const { error } = await supabase.rpc("set_group_role", { p_group_id: groupId, p_member_id: memberId, p_role: role });
  if (error) fail(error, "Couldn't change their role.");
}

/** The owner appoints a society's captain or secretary, or (null) stands
 *  them down. A new captain replaces the old one (0122). */
export async function setMemberOffice(groupId: number, memberId: string, office: GroupOffice | null): Promise<void> {
  const { error } = await supabase.rpc("set_group_office", { p_group_id: groupId, p_member_id: memberId, p_office: office });
  if (error) fail(error, "Couldn't change that.");
}

export async function setGroupMuted(groupId: number, muted: boolean): Promise<void> {
  const { error } = await supabase.rpc("set_group_muted", { p_group_id: groupId, p_muted: muted });
  if (error) fail(error, "Couldn't change that setting.");
}

// ---------------------------------------------------------------------------
// Invite links
// ---------------------------------------------------------------------------

export const groupInviteUrl = (code: string) => `${SITE_URL}${groupInvitePath(code)}`;

export async function getGroupInviteCode(groupId: number): Promise<string> {
  const { data, error } = await supabase.rpc("group_invite_code", { p_group_id: groupId });
  if (error) fail(error, "Couldn't get the invite link.");
  return String(data);
}

export async function resetGroupInviteCode(groupId: number): Promise<string> {
  const { data, error } = await supabase.rpc("reset_group_invite_code", { p_group_id: groupId });
  if (error) fail(error, "Couldn't reset the link.");
  return String(data);
}

export type InvitePreview = { groupId: number; name: string; kind: GroupKind; about: string | null; memberCount: number; clubName: string | null; ownerFirstName: string | null };

export async function previewGroupInvite(code: string): Promise<InvitePreview | null> {
  const { data } = await supabase.rpc("group_invite_preview", { p_code: code });
  const r = (data as { group_id: number; name: string; kind: string; about: string | null; member_count: number; club_name: string | null; owner_first_name: string | null }[] | null)?.[0];
  if (!r) return null;
  return {
    groupId: r.group_id,
    name: r.name,
    kind: isGroupKind(r.kind) ? r.kind : "crew",
    about: r.about,
    memberCount: r.member_count,
    clubName: r.club_name,
    ownerFirstName: r.owner_first_name,
  };
}

export async function joinGroupByCode(code: string): Promise<number> {
  const { data, error } = await supabase.rpc("join_group_by_code", { p_code: code.toLowerCase() });
  if (error) fail(error, "Couldn't join the group.");
  return Number(data);
}

/** A society's emailed invitation (0170): /join/s/<token>. */
export const isEmailInviteToken = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);

export type EmailInvitePreview = InvitePreview & { email: string; firstName: string | null; status: "pending" | "joined" | "cancelled" };

export async function previewEmailInvite(token: string): Promise<EmailInvitePreview | null> {
  const { data } = await supabase.rpc("group_email_invite_preview", { p_token: token });
  const r = (
    data as
      | {
          group_id: number;
          name: string;
          kind: string;
          about: string | null;
          member_count: number;
          club_name: string | null;
          owner_first_name: string | null;
          email: string;
          first_name: string | null;
          status: "pending" | "joined" | "cancelled";
        }[]
      | null
  )?.[0];
  if (!r) return null;
  return {
    groupId: r.group_id,
    name: r.name,
    kind: isGroupKind(r.kind) ? r.kind : "society",
    about: r.about,
    memberCount: r.member_count,
    clubName: r.club_name,
    ownerFirstName: r.owner_first_name,
    email: r.email,
    firstName: r.first_name,
    status: r.status,
  };
}

/** Joins with the signed-in account, whatever its email. */
export async function claimEmailInvite(token: string): Promise<number> {
  const { data, error } = await supabase.rpc("claim_group_email_invite", { p_token: token });
  if (error) fail(error, "Couldn't join the society.");
  return Number(data);
}

// A group link opened before signing in is kept until they are
// (app/_layout.tsx), like a member's own invite link (find-pinpals.ts).
// An emailed invitation's token is kept the same way, as "s:<token>".
const PENDING_KEY = "pp_pending_group_invite";

export async function rememberPendingGroupInvite(code: string): Promise<void> {
  await SecureStore.setItemAsync(PENDING_KEY, code.toLowerCase()).catch(() => undefined);
}

export async function rememberPendingEmailInvite(token: string): Promise<void> {
  await SecureStore.setItemAsync(PENDING_KEY, `s:${token.toLowerCase()}`).catch(() => undefined);
}

/** Joins the group a link was opened for, then forgets it. Returns its id. */
export async function consumePendingGroupInvite(): Promise<number | null> {
  const code = await SecureStore.getItemAsync(PENDING_KEY).catch(() => null);
  if (!code) return null;
  await SecureStore.deleteItemAsync(PENDING_KEY).catch(() => undefined);
  try {
    if (code.startsWith("s:")) {
      const token = code.slice(2);
      return isEmailInviteToken(token) ? await claimEmailInvite(token) : null;
    }
    return await joinGroupByCode(code);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Playing together (0121): a group as a list of golfers for a draw
// ---------------------------------------------------------------------------

/** Whether you can put this group's members on cards (0121's
 *  live_can_add_player): anyone in a crew or trip; only whoever runs a
 *  society (owner or admin). The database applies the same rule. */
export const canDrawFrom = (g: { kind: GroupKind; role: GroupRole; office?: GroupOffice | null }): boolean =>
  g.kind === "crew" || g.kind === "trip" || g.role === "owner" || g.role === "admin" || g.office === "vice_captain" || g.office === "event_organiser";

export type RosterPlayer = {
  id: string;
  name: string;
  /** The society's index for them if it has set one, else their own when
   *  they've chosen to share it. */
  index: number | null;
  /** True when `index` is the society's figure. */
  fromSociety: boolean;
  avatarUrl: string | null;
  avatarColor: string | null;
};

/** Everyone in a group, with handicaps where shared, by name. Members only
 *  (RLS): a non-member gets an empty list. */
export async function loadGroupRoster(groupId: number): Promise<RosterPlayer[]> {
  const { data, error } = await supabase
    .from("group_members")
    .select("member_id, society_index, profile:profiles(id, first_name, last_name, handicap, handicap_visible, avatar_url, avatar_color)")
    .eq("group_id", groupId)
    .overrideTypes<
      {
        member_id: string;
        society_index: number | null;
        profile: {
          id: string;
          first_name: string | null;
          last_name: string | null;
          handicap: number | null;
          handicap_visible: boolean | null;
          avatar_url: string | null;
          avatar_color: string | null;
        } | null;
      }[]
    >();
  if (error) fail(error, "Couldn't load the group's members.");
  return (data ?? [])
    .map((r) => ({
      id: r.member_id,
      name: [r.profile?.first_name, r.profile?.last_name].filter(Boolean).join(" ") || "A member",
      // A society's own figure first (set by its secretary, 0122), then the
      // member's own index where they share it.
      index:
        r.society_index != null
          ? Number(r.society_index)
          : r.profile?.handicap_visible && r.profile.handicap != null
            ? Number(r.profile.handicap)
            : null,
      fromSociety: r.society_index != null,
      avatarUrl: r.profile?.avatar_url ?? null,
      avatarColor: r.profile?.avatar_color ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "en-IE"));
}

// ---------------------------------------------------------------------------
// Society handicaps (0122): the secretary's list
// ---------------------------------------------------------------------------

export type SocietyHandicap = {
  memberId: string;
  /** The handicap the member set on their own profile. */
  ownIndex: number | null;
  /** Worked out from their last 20 scorecards; null with fewer than 3. */
  indicator: number | null;
  /** How many eligible scorecards the indicator is from. */
  rounds: number;
  /** What the society plays them off, if an officer has set it. */
  societyIndex: number | null;
  societyIndexSetAt: string | null;
};

/** Owner, captain and secretary only; anyone else gets the database's refusal. */
export async function loadSocietyHandicaps(groupId: number): Promise<Map<string, SocietyHandicap>> {
  const { data, error } = await supabase.rpc("society_handicaps", { p_group_id: groupId });
  if (error) fail(error, "Couldn't load the handicaps.");
  const rows = (data ?? []) as {
    member_id: string;
    own_index: number | null;
    indicator: number | null;
    rounds: number | null;
    society_index: number | null;
    society_index_set_at: string | null;
  }[];
  const num = (v: number | null) => (v == null ? null : Number(v));
  return new Map(
    rows.map((r) => [
      r.member_id,
      {
        memberId: r.member_id,
        ownIndex: num(r.own_index),
        indicator: num(r.indicator),
        rounds: r.rounds ?? 0,
        societyIndex: num(r.society_index),
        societyIndexSetAt: r.society_index_set_at,
      },
    ])
  );
}

/** Null clears it: the member plays off their own again. */
export async function setSocietyHandicap(groupId: number, memberId: string, index: number | null): Promise<void> {
  const { error } = await supabase.rpc("set_society_handicap", { p_group_id: groupId, p_member_id: memberId, p_index: index });
  if (error) fail(error, "Couldn't save that handicap.");
}

// ---------------------------------------------------------------------------
// Cover photo and logo (0124): society owner, captain or secretary; whoever
// runs a crew or trip. Through the website, which strips the photo's EXIF.
// ---------------------------------------------------------------------------

export type GroupImage = "cover" | "logo";

/** Returns the new image's address. */
export async function uploadGroupImage(groupId: number, which: GroupImage, file: UploadFile): Promise<string | null> {
  const res = await postFormToSite<{ ok: true; url: string | null }>(`/api/app/groups/${groupId}/image`, { which }, { field: "image", file });
  return res.url;
}

/** Back to the default: the kind's icon, or the plain header. */
export async function removeGroupImage(groupId: number, which: GroupImage): Promise<void> {
  await postFormToSite<{ ok: true }>(`/api/app/groups/${groupId}/image`, { which, remove: "on" });
}
