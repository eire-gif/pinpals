/**
 * Groups — the model (Oct 2026 feed redesign, phase 11). Architecture only:
 * nothing reads this yet, and there are no group tables.
 *
 * KEPT IDENTICAL in two places, like post-details.ts and shared-round.ts:
 *
 *   src/lib/groups.ts          (website: the future /api/app/groups routes)
 *   mobile/src/lib/groups.ts   (app: the future group screens)
 *
 * src/lib/groups.test.ts fails if they differ. No imports.
 *
 * A group is a standing community — "Saturday Golf Crew", "Dublin Golfers",
 * "Portmarnock members", "Algarve 2027". It is NOT a new kind of post, chat
 * or tee time. Each thing a group has is an existing PinPals system pointed
 * at the group as its audience:
 *
 *   members       new: group_members (owner / admin / member)
 *   posts         posts, with a third audience: visibility 'group'
 *   tee times     tee_time_invites, with a third visibility: 'group'
 *   group chat    a conversations row (kind 'group', 0087)
 *   events        new: group_events, a dated plan that can spawn tee times
 *   polls         new: group_polls
 *
 * The design, the draft SQL and the rollout are in
 * claude/groups-architecture.md. This file holds the decisions every screen
 * and route must agree on: what kinds exist, who may do what, and how
 * someone gets in.
 */

// ---------------------------------------------------------------------------
// Kinds
// ---------------------------------------------------------------------------

export const GROUP_KINDS = ["crew", "area", "club", "trip"] as const;
export type GroupKind = (typeof GROUP_KINDS)[number];

export const GROUP_FEATURES = ["posts", "events", "polls", "chat", "tee_times"] as const;
export type GroupFeature = (typeof GROUP_FEATURES)[number];

export const GROUP_PRIVACIES = ["open", "request", "invite"] as const;
export type GroupPrivacy = (typeof GROUP_PRIVACIES)[number];

export type GroupKindInfo = {
  label: string;
  /** What the create screen shows as an example name. */
  example: string;
  description: string;
  /** An Ionicons name (plain string: no icon package here). */
  icon: string;
  /** What a new group of this kind starts as; the owner can change it. */
  privacy: GroupPrivacy;
  /** Turned on at creation; the owner can change them. */
  features: GroupFeature[];
  /** The PinPals record the group is tied to, if any. */
  anchor: "none" | "county" | "club" | "dates";
  maxMembers: number;
};

export const GROUP_KIND_INFO: Record<GroupKind, GroupKindInfo> = {
  crew: {
    label: "Crew",
    example: "Saturday Golf Crew",
    description: "Your regular fourball and the friends who fill in.",
    icon: "people",
    privacy: "invite",
    features: ["posts", "events", "polls", "chat", "tee_times"],
    anchor: "none",
    // Two or three fourballs plus subs. A group chat (0087) holds 20.
    maxMembers: 20,
  },
  area: {
    label: "Local",
    example: "Dublin Golfers",
    description: "Golfers near you, looking for a game.",
    icon: "location",
    privacy: "open",
    // A chat with hundreds of strangers is a moderation job, not a feature.
    features: ["posts", "events", "polls", "tee_times"],
    anchor: "county",
    maxMembers: 2000,
  },
  club: {
    label: "Club",
    example: "Portmarnock members",
    description: "Members of one golf club.",
    icon: "flag",
    privacy: "request",
    features: ["posts", "events", "polls", "tee_times"],
    anchor: "club",
    maxMembers: 2000,
  },
  trip: {
    label: "Trip",
    example: "Algarve 2027",
    description: "Everyone on a golf trip — the plan, the polls, the photos.",
    icon: "airplane",
    privacy: "invite",
    features: ["posts", "events", "polls", "chat", "tee_times"],
    anchor: "dates",
    maxMembers: 20,
  },
};

export function isGroupKind(value: unknown): value is GroupKind {
  return typeof value === "string" && (GROUP_KINDS as readonly string[]).includes(value);
}

/** The group chat is a 0087 conversation, which holds 20 people at most. */
export const GROUP_CHAT_MAX = 20;

/** Chat can be on only while the group fits in a conversation. */
export function chatAllowed(kind: GroupKind, memberCount: number): boolean {
  return GROUP_KIND_INFO[kind].maxMembers <= GROUP_CHAT_MAX && memberCount <= GROUP_CHAT_MAX;
}

// ---------------------------------------------------------------------------
// Roles and permissions
// ---------------------------------------------------------------------------

export const GROUP_ROLES = ["owner", "admin", "member"] as const;
export type GroupRole = (typeof GROUP_ROLES)[number];

export const GROUP_ACTIONS = [
  "view",
  "post",
  "comment",
  "chat",
  "offer_tee_time",
  "create_event",
  "create_poll",
  "vote",
  "invite",
  "approve_requests",
  "remove_member",
  "moderate",
  "edit_group",
  "change_roles",
  "delete_group",
] as const;
export type GroupAction = (typeof GROUP_ACTIONS)[number];

export type GroupSettings = {
  privacy: GroupPrivacy;
  features: GroupFeature[];
  /** Off: only owner and admins post (an announcements-style club group). */
  membersCanPost: boolean;
  /** Off: only owner and admins invite. */
  membersCanInvite: boolean;
};

/** Which feature an action needs switched on, if any. */
const NEEDS: Partial<Record<GroupAction, GroupFeature>> = {
  post: "posts",
  comment: "posts",
  chat: "chat",
  offer_tee_time: "tee_times",
  create_event: "events",
  create_poll: "polls",
  vote: "polls",
};

const ADMIN_ONLY: GroupAction[] = ["approve_requests", "remove_member", "moderate", "edit_group"];
const OWNER_ONLY: GroupAction[] = ["change_roles", "delete_group"];

/**
 * May someone with this role (null = not a member) do this in this group?
 *
 *   - non-members can only `view`, and only an open group's front page —
 *     never its posts, chat or tee times (those are members-only audiences)
 *   - a switched-off feature refuses its actions for everyone, owner included
 *   - owner ⊃ admin ⊃ member; `post` and `invite` for members follow the
 *     group's settings
 *
 * The database enforces the same rules; this is what screens use to decide
 * which buttons to draw.
 */
export function groupCan(role: GroupRole | null, action: GroupAction, settings: GroupSettings): boolean {
  if (role === null) return action === "view" && settings.privacy === "open";
  const feature = NEEDS[action];
  if (feature && !settings.features.includes(feature)) return false;
  if (OWNER_ONLY.includes(action)) return role === "owner";
  if (ADMIN_ONLY.includes(action)) return role === "owner" || role === "admin";
  if (role === "member") {
    if (action === "post" || action === "create_event" || action === "create_poll") return settings.membersCanPost;
    if (action === "invite") return settings.membersCanInvite;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Getting in
// ---------------------------------------------------------------------------

export type JoinState =
  | "member"
  /** Open group: one tap. */
  | "join"
  /** Request group: ask, an admin approves. */
  | "request"
  | "requested"
  /** Someone in the group invited you: accept or decline. */
  | "invited"
  /** Invite-only and not invited: the group isn't shown at all. */
  | "hidden"
  /** Full, or blocked by someone who runs it. */
  | "closed";

/**
 * What the group page offers this viewer. Blocking wins, as in 0087: if the
 * owner or an admin and the viewer have blocked each other either way, the
 * door is closed — whatever the privacy. (Blocks with ordinary members are
 * handled the way group chats handle them; see the doc.)
 */
export function joinState(v: {
  privacy: GroupPrivacy;
  isMember: boolean;
  invited: boolean;
  requested: boolean;
  blockedByAdmin: boolean;
  full: boolean;
}): JoinState {
  if (v.isMember) return "member";
  if (v.blockedByAdmin) return v.privacy === "invite" ? "hidden" : "closed";
  if (v.invited) return v.full ? "closed" : "invited";
  if (v.privacy === "invite") return "hidden";
  if (v.full) return "closed";
  if (v.privacy === "request") return v.requested ? "requested" : "request";
  return "join";
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

export const GROUP_NAME_MAX = 60;
export const GROUP_ABOUT_MAX = 500;

/** Null when the name will do. Same shape as the 0087 group-chat title. */
export function groupNameProblem(name: string): string | null {
  const n = name.trim();
  if (n.length === 0) return "Give the group a name.";
  if (n.length > GROUP_NAME_MAX) return `That name is too long — ${GROUP_NAME_MAX} characters at most.`;
  if (/^pinpals\b/i.test(n)) return "Group names can't start with PinPals.";
  return null;
}

/** "Saturday Golf Crew" → "saturday-golf-crew", for links. */
export function groupSlug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
}
