import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CREATABLE_GROUP_KINDS,
  GROUP_ACTIONS,
  GROUP_FEATURES,
  GROUP_KINDS,
  GROUP_KIND_INFO,
  chatAllowed,
  groupCan,
  groupNameProblem,
  groupInvitePath,
  groupSlug,
  canStyleGroup,
  isGroupOffice,
  roleLabel,
  isCreatableGroupKind,
  isGroupInviteCode,
  isGroupKind,
  joinState,
  type GroupSettings,
} from "./groups";

const everything: GroupSettings = { privacy: "request", features: [...GROUP_FEATURES], membersCanPost: true, membersCanInvite: true };

describe("groups.ts", () => {
  it("is byte-identical in the website and the app", () => {
    const site = readFileSync(join(process.cwd(), "src/lib/groups.ts"), "utf8");
    const app = readFileSync(join(process.cwd(), "mobile/src/lib/groups.ts"), "utf8");
    expect(app).toBe(site);
  });

  it("has the four kinds the brief names, plus societies", () => {
    expect(GROUP_KINDS.map((k) => GROUP_KIND_INFO[k].example)).toEqual([
      "Saturday Golf Buddies",
      "Dublin Golfers",
      "Portmarnock members",
      "Algarve 2027",
      "Malahide Golf Society",
    ]);
    expect(isGroupKind("trip")).toBe(true);
    expect(isGroupKind("society")).toBe(true);
    expect(isGroupKind("league")).toBe(false);
  });

  it("members can start crews, trips and societies; local and club groups wait for moderation", () => {
    expect([...CREATABLE_GROUP_KINDS]).toEqual(["crew", "trip", "society"]);
    expect(isCreatableGroupKind("society")).toBe(true);
    expect(isCreatableGroupKind("area")).toBe(false);
    expect(isCreatableGroupKind("club")).toBe(false);
  });

  it("a society is found in search and asked to join, with no group chat", () => {
    const s = GROUP_KIND_INFO.society;
    expect(s.privacy).toBe("request");
    expect(s.features).not.toContain("chat");
    expect(chatAllowed("society", 4)).toBe(false);
  });

  it("group invite links are eight letters and digits under /join/g/", () => {
    expect(isGroupInviteCode("ab12cd34")).toBe(true);
    expect(isGroupInviteCode("AB12CD34")).toBe(false);
    expect(isGroupInviteCode("ab12cd3")).toBe(false);
    expect(groupInvitePath("ab12cd34")).toBe("/join/g/ab12cd34");
  });

  it("chat is only ever on where the group fits in a group conversation", () => {
    for (const k of GROUP_KINDS) {
      const info = GROUP_KIND_INFO[k];
      if (info.features.includes("chat")) expect(info.maxMembers).toBeLessThanOrEqual(20);
    }
    expect(chatAllowed("crew", 12)).toBe(true);
    expect(chatAllowed("crew", 21)).toBe(false);
    expect(chatAllowed("area", 5)).toBe(false);
  });
});

describe("groupCan", () => {
  it("non-members see only an open group's front page", () => {
    for (const action of GROUP_ACTIONS) {
      expect(groupCan(null, action, { ...everything, privacy: "open" })).toBe(action === "view");
      expect(groupCan(null, action, everything)).toBe(false);
    }
  });

  it("owner ⊃ admin ⊃ member", () => {
    expect(groupCan("owner", "delete_group", everything)).toBe(true);
    expect(groupCan("admin", "delete_group", everything)).toBe(false);
    expect(groupCan("admin", "change_roles", everything)).toBe(false);
    expect(groupCan("admin", "remove_member", everything)).toBe(true);
    expect(groupCan("member", "remove_member", everything)).toBe(false);
    expect(groupCan("member", "approve_requests", everything)).toBe(false);
    for (const a of ["view", "post", "comment", "chat", "offer_tee_time", "vote", "invite"] as const) {
      expect(groupCan("member", a, everything)).toBe(true);
    }
  });

  it("a switched-off feature is off for everyone, the owner included", () => {
    const noChat = { ...everything, features: everything.features.filter((f) => f !== "chat") };
    expect(groupCan("owner", "chat", noChat)).toBe(false);
    const noPolls = { ...everything, features: ["posts" as const] };
    expect(groupCan("owner", "create_poll", noPolls)).toBe(false);
    expect(groupCan("member", "vote", noPolls)).toBe(false);
    expect(groupCan("owner", "edit_group", noPolls)).toBe(true);
  });

  it("announcements-only and admin-invites-only groups", () => {
    const strict = { ...everything, membersCanPost: false, membersCanInvite: false };
    expect(groupCan("member", "post", strict)).toBe(false);
    expect(groupCan("member", "create_event", strict)).toBe(false);
    expect(groupCan("member", "comment", strict)).toBe(true);
    expect(groupCan("member", "vote", strict)).toBe(true);
    expect(groupCan("member", "invite", strict)).toBe(false);
    expect(groupCan("admin", "post", strict)).toBe(true);
    expect(groupCan("admin", "invite", strict)).toBe(true);
  });
});

describe("joinState", () => {
  const v = { privacy: "open" as const, isMember: false, invited: false, requested: false, blockedByAdmin: false, full: false };
  it("follows the privacy setting", () => {
    expect(joinState(v)).toBe("join");
    expect(joinState({ ...v, privacy: "request" })).toBe("request");
    expect(joinState({ ...v, privacy: "request", requested: true })).toBe("requested");
    expect(joinState({ ...v, privacy: "invite" })).toBe("hidden");
    expect(joinState({ ...v, privacy: "invite", invited: true })).toBe("invited");
    expect(joinState({ ...v, isMember: true, privacy: "invite" })).toBe("member");
  });

  it("blocking by someone who runs it closes the door; a secret group stays hidden", () => {
    expect(joinState({ ...v, blockedByAdmin: true })).toBe("closed");
    expect(joinState({ ...v, blockedByAdmin: true, invited: true })).toBe("closed");
    expect(joinState({ ...v, privacy: "invite", invited: true, blockedByAdmin: true })).toBe("hidden");
  });

  it("a full group takes nobody, invited or not", () => {
    expect(joinState({ ...v, full: true })).toBe("closed");
    expect(joinState({ ...v, full: true, invited: true })).toBe("closed");
  });
});

describe("names", () => {
  it("validates", () => {
    expect(groupNameProblem("Saturday Golf Crew")).toBeNull();
    expect(groupNameProblem("   ")).toBe("Give the group a name.");
    expect(groupNameProblem("x".repeat(61))).toMatch(/too long/);
    expect(groupNameProblem("PinPals Official")).toMatch(/can't start with PinPals/);
  });

  it("slugs", () => {
    expect(groupSlug("Saturday Golf Crew")).toBe("saturday-golf-crew");
    expect(groupSlug("  Dún Laoghaire & Dalkey Golfers!! ")).toBe("dun-laoghaire-and-dalkey-golfers");
    expect(groupSlug("Algarve 2027 ⛳")).toBe("algarve-2027");
  });
});

describe("society offices (0122)", () => {
  it("labels the owner, the officers and plain admins", () => {
    expect(roleLabel("member", null)).toBeNull();
    expect(roleLabel("owner", null)).toBe("Owner");
    expect(roleLabel("admin", "captain")).toBe("Captain");
    expect(roleLabel("owner", "secretary")).toBe("Owner · Secretary");
    expect(roleLabel("admin", null)).toBe("Admin");
  });

  it("knows the two offices", () => {
    expect(isGroupOffice("captain")).toBe(true);
    expect(isGroupOffice("secretary")).toBe(true);
    expect(isGroupOffice("treasurer")).toBe(true);
    expect(isGroupOffice("president")).toBe(false);
  });
});

describe("canStyleGroup (0124)", () => {
  it("lets a society's owner and officers change its look, and nobody else", () => {
    expect(canStyleGroup("society", "owner", null)).toBe(true);
    expect(canStyleGroup("society", "admin", "captain")).toBe(true);
    expect(canStyleGroup("society", "admin", "secretary")).toBe(true);
    expect(canStyleGroup("society", "admin", null)).toBe(false);
    expect(canStyleGroup("society", "member", null)).toBe(false);
    expect(canStyleGroup("society", null, null)).toBe(false);
  });

  it("lets whoever runs a crew or trip change its look", () => {
    expect(canStyleGroup("crew", "owner", null)).toBe(true);
    expect(canStyleGroup("trip", "admin", null)).toBe(true);
    expect(canStyleGroup("crew", "member", null)).toBe(false);
  });
});
