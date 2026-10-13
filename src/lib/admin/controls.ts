// Pure, framework-free rules for the admin console's shared controls: which
// staff roles may Edit, Hide / Restore, Remove / Add back and Delete
// permanently on each kind of record, what an edit form may change, and when
// a permanent delete is refused. No Supabase, no Next.js — the Server Actions
// in src/app/admin/controls/actions.ts gather the facts and call these, and
// the list/detail pages call the same functions to decide what to show, so
// the page and the action can never disagree. See claude/admin.md.

import type { StaffRole } from "./roles";
import { MODERATION_ROLES, LISTING_REMOVAL_ROLES } from "./moderation";
import { FINANCE_ROLES } from "./finance";
import { MEMBER_EDIT_ROLES } from "./member-profile";

// ============ Roles ============

/** Change the facts on a record (titles, descriptions, names). */
export const EDIT_ROLES = ["admin", "super_admin"] as const;
/** Delete permanently. Always super admin alone, always reason-required. */
export const DELETE_ROLES = ["super_admin"] as const;

// ============ Entities and verbs ============

export const CONTROL_ENTITIES = [
  "user",
  "listing",
  "tee_time",
  "club",
  "group",
  "outing",
  "post",
  "post_comment",
  "course_review",
  "review",
  "store",
  "article",
] as const;
export type ControlEntity = (typeof CONTROL_ENTITIES)[number];

export function isControlEntity(value: unknown): value is ControlEntity {
  return typeof value === "string" && (CONTROL_ENTITIES as readonly string[]).includes(value);
}

/**
 * hide/restore — the everyday, reversible takedown.
 * remove/add_back — only where the domain has its own "removed" state that
 *   is distinct from hidden (a listing force-removed from any status, an
 *   event cancelled). add_back returns it to where it was.
 * delete — permanent; super admin only.
 */
export const CONTROL_VERBS = ["hide", "restore", "remove", "add_back", "delete"] as const;
export type ControlVerb = (typeof CONTROL_VERBS)[number];

export function isControlVerb(value: unknown): value is ControlVerb {
  return typeof value === "string" && (CONTROL_VERBS as readonly string[]).includes(value);
}

export type VerbRule = {
  /** Button / menu text, e.g. "Hide", "Suspend", "Cancel event". */
  label: string;
  /** Shown in the confirmation dialog. */
  description: string;
  roles: readonly StaffRole[];
  tone?: "danger";
};

export type EditField = {
  name: string;
  label: string;
  kind: "text" | "textarea" | "select" | "number";
  required?: boolean;
  /** Max characters for text, max value for number. */
  max?: number;
  /** Min characters for text (after trimming), min value for number. */
  min?: number;
  /** Stored as null when left empty (otherwise as ""). */
  nullable?: boolean;
  options?: readonly { value: string; label: string }[];
  integer?: boolean;
};

export type EntityControls = {
  noun: string;
  plural: string;
  /** The database table (for the generic actions). Users, articles and
   * courses have their own edit paths and never go through the generic edit. */
  table: string;
  /** "uuid" for profiles, "bigint" for everything else. */
  idKind: "uuid" | "bigint";
  listHref: string;
  detailHref: (id: string | number) => string;
  verbs: Partial<Record<ControlVerb, VerbRule>>;
  /** Generic edit (fields below) or an existing edit page (href). */
  edit?: { roles: readonly StaffRole[]; fields?: readonly EditField[]; href?: (id: string | number) => string };
};

const DELETE_RULE = (noun: string): VerbRule => ({
  label: "Delete permanently",
  description: `Deletes this ${noun} for good. It can't be undone; a copy of the row is kept in the audit log.`,
  roles: DELETE_ROLES,
  tone: "danger",
});

const HIDE = (noun: string, roles: readonly StaffRole[] = MODERATION_ROLES): VerbRule => ({
  label: "Hide",
  description: `Hides this ${noun} from members and visitors. Nothing is deleted, and it can be restored.`,
  roles,
});

const RESTORE = (noun: string, roles: readonly StaffRole[] = MODERATION_ROLES): VerbRule => ({
  label: "Restore",
  description: `Makes this ${noun} visible again.`,
  roles,
});

export const ENTITY_CONTROLS: Record<ControlEntity, EntityControls> = {
  user: {
    noun: "member",
    plural: "members",
    table: "profiles",
    idKind: "uuid",
    listHref: "/admin/users",
    detailHref: (id) => `/admin/users/${id}`,
    verbs: {
      hide: {
        label: "Suspend",
        description: "Signs the member out and stops them signing in. Their content stays. Reinstate to undo.",
        roles: MODERATION_ROLES,
      },
      restore: { label: "Reinstate", description: "Lets the member sign in again.", roles: MODERATION_ROLES },
      delete: {
        label: "Delete account",
        description:
          "Starts the member's account deletion, the same process a member starts themselves: the account is locked now, their tee times and listings come down, and the scrub runs when it is due. The profile row is never hard-deleted here.",
        roles: DELETE_ROLES,
        tone: "danger",
      },
    },
    edit: { roles: MEMBER_EDIT_ROLES, href: (id) => `/admin/users/${id}#edit` },
  },
  listing: {
    noun: "listing",
    plural: "listings",
    table: "listings",
    idKind: "bigint",
    listHref: "/admin/listings",
    detailHref: (id) => `/admin/listings/${id}`,
    verbs: {
      hide: HIDE("listing"),
      remove: {
        label: "Remove",
        description:
          "Takes the listing down from any status, including reserved or sold. Orders and payments are unaffected. Add back returns it to the status it had.",
        roles: LISTING_REMOVAL_ROLES,
      },
      restore: {
        label: "Restore / add back",
        description: "Puts the listing back to the status it had before it was hidden or removed.",
        roles: MODERATION_ROLES,
      },
      delete: DELETE_RULE("listing"),
    },
    edit: {
      roles: EDIT_ROLES,
      fields: [
        { name: "title", label: "Title", kind: "text", required: true, min: 1, max: 120 },
        { name: "description", label: "Description", kind: "textarea", max: 2000, nullable: true },
      ],
    },
  },
  tee_time: {
    noun: "tee time",
    plural: "tee times",
    table: "tee_time_invites",
    idKind: "bigint",
    listHref: "/admin/tee-times",
    detailHref: (id) => `/admin/tee-times/${id}`,
    verbs: {
      // A tee time's own "taken down" state is 'cancelled': members other
      // than the host no longer see it (RLS, 0004). So hide = cancel.
      hide: {
        label: "Cancel (hide)",
        description: "Cancels the tee time so members no longer see it. The host still does. Add back to undo.",
        roles: MODERATION_ROLES,
      },
      restore: {
        label: "Add back",
        description: "Re-opens the tee time (or marks it expired if its date has passed).",
        roles: MODERATION_ROLES,
      },
      delete: DELETE_RULE("tee time"),
    },
    edit: {
      roles: EDIT_ROLES,
      fields: [{ name: "notes", label: "Notes", kind: "textarea", max: 500, nullable: true }],
    },
  },
  club: {
    noun: "course",
    plural: "courses",
    table: "clubs",
    idKind: "bigint",
    listHref: "/admin/clubs",
    detailHref: (id) => `/admin/clubs/${id}`,
    verbs: {
      // Courses are reference data, not member content: admin, per the role
      // model in admin-architecture-review.md §6.
      hide: HIDE("course", EDIT_ROLES),
      restore: RESTORE("course", EDIT_ROLES),
      delete: DELETE_RULE("course"),
    },
    edit: { roles: EDIT_ROLES, href: (id) => `/admin/clubs/${id}#edit` },
  },
  group: {
    noun: "group",
    plural: "groups",
    table: "groups",
    idKind: "bigint",
    listHref: "/admin/groups",
    detailHref: (id) => `/admin/groups/${id}`,
    verbs: {
      hide: HIDE("group"),
      restore: RESTORE("group"),
      delete: DELETE_RULE("group"),
    },
    edit: {
      roles: EDIT_ROLES,
      fields: [
        { name: "name", label: "Name", kind: "text", required: true, min: 1, max: 60 },
        // Privacy isn't here: it's set by the kind of group when it's made,
        // and update_group() (0120/0122) doesn't change it either.
        { name: "about", label: "About", kind: "textarea", max: 500, nullable: true },
      ],
    },
  },
  outing: {
    noun: "event",
    plural: "events",
    table: "society_outings",
    idKind: "bigint",
    listHref: "/admin/groups/events",
    detailHref: (id) => `/admin/records/outing/${id}`,
    verbs: {
      hide: HIDE("event"),
      restore: RESTORE("event"),
      remove: {
        label: "Cancel event",
        description: "Marks the event cancelled, as an organiser would. Members still see it, marked cancelled.",
        roles: MODERATION_ROLES,
      },
      add_back: {
        label: "Re-open event",
        description: "Takes the event out of cancelled so members can enter again.",
        roles: MODERATION_ROLES,
      },
      delete: DELETE_RULE("event"),
    },
    edit: {
      roles: EDIT_ROLES,
      fields: [
        { name: "title", label: "Title", kind: "text", required: true, min: 1, max: 80 },
        { name: "details", label: "Details", kind: "textarea", max: 1000, nullable: true },
      ],
    },
  },
  post: {
    noun: "post",
    plural: "posts",
    table: "posts",
    idKind: "bigint",
    listHref: "/admin/feed",
    detailHref: (id) => `/admin/records/post/${id}`,
    verbs: { hide: HIDE("post"), restore: RESTORE("post"), delete: DELETE_RULE("post") },
    edit: { roles: EDIT_ROLES, fields: [{ name: "body", label: "Text", kind: "textarea", max: 2000 }] },
  },
  post_comment: {
    noun: "comment",
    plural: "comments",
    table: "post_comments",
    idKind: "bigint",
    listHref: "/admin/feed",
    detailHref: (id) => `/admin/records/post_comment/${id}`,
    verbs: { hide: HIDE("comment"), restore: RESTORE("comment"), delete: DELETE_RULE("comment") },
    edit: {
      roles: EDIT_ROLES,
      fields: [{ name: "body", label: "Text", kind: "textarea", required: true, min: 1, max: 1000 }],
    },
  },
  course_review: {
    noun: "course review",
    plural: "course reviews",
    table: "course_reviews",
    idKind: "bigint",
    listHref: "/admin/course-reviews",
    detailHref: (id) => `/admin/records/course_review/${id}`,
    verbs: { hide: HIDE("review"), restore: RESTORE("review"), delete: DELETE_RULE("review") },
    edit: {
      roles: EDIT_ROLES,
      fields: [
        { name: "rating", label: "Rating (1–5)", kind: "number", required: true, min: 1, max: 5, integer: true },
        { name: "body", label: "Review", kind: "textarea", max: 1000, nullable: true },
      ],
    },
  },
  review: {
    noun: "review",
    plural: "reviews",
    table: "reviews",
    idKind: "bigint",
    listHref: "/admin/reviews",
    detailHref: (id) => `/admin/records/review/${id}`,
    verbs: { hide: HIDE("review"), restore: RESTORE("review"), delete: DELETE_RULE("review") },
    edit: {
      roles: EDIT_ROLES,
      fields: [
        { name: "rating", label: "Rating (1–5)", kind: "number", required: true, min: 1, max: 5, integer: true },
        { name: "body", label: "Review", kind: "textarea", max: 2000, nullable: true },
      ],
    },
  },
  store: {
    noun: "pro shop",
    plural: "pro shops",
    table: "stores",
    idKind: "bigint",
    listHref: "/admin/marketplace?tab=shops",
    detailHref: (id) => `/admin/records/store/${id}`,
    verbs: {
      // A shop's own "hidden" state is 'suspended' (0115): visitors and
      // members no longer see it. Same roles as the existing shop actions.
      hide: {
        label: "Suspend",
        description: "Hides the shop and stops it adding stock. Its existing listings are left as they are.",
        roles: FINANCE_ROLES,
      },
      restore: { label: "Reinstate", description: "Makes the shop live again.", roles: FINANCE_ROLES },
      delete: DELETE_RULE("pro shop"),
    },
    edit: {
      roles: EDIT_ROLES,
      fields: [
        { name: "name", label: "Shop name", kind: "text", required: true, min: 2, max: 80 },
        { name: "description", label: "Description", kind: "textarea", max: 1000, nullable: true },
      ],
    },
  },
  article: {
    noun: "article",
    plural: "articles",
    table: "articles",
    idKind: "bigint",
    listHref: "/admin/news",
    detailHref: (id) => `/admin/news/${id}`,
    // Hiding a news article is the existing Reject (draft) or Retract
    // (published) on its review page — both carry their own public-record
    // rules, so the row menu links there rather than duplicating them.
    verbs: { delete: DELETE_RULE("article") },
    edit: { roles: ["support", "moderator", "finance", "admin", "super_admin"], href: (id) => `/admin/news/${id}` },
  },
};

// ============ Permissions ============

type StaffLike = { role: StaffRole; status: string } | null;

export function canUseVerb(staff: StaffLike, entity: ControlEntity, verb: ControlVerb): boolean {
  if (!staff || staff.status !== "active") return false;
  const rule = ENTITY_CONTROLS[entity].verbs[verb];
  return !!rule && rule.roles.includes(staff.role);
}

export function canEdit(staff: StaffLike, entity: ControlEntity): boolean {
  if (!staff || staff.status !== "active") return false;
  const edit = ENTITY_CONTROLS[entity].edit;
  return !!edit && edit.roles.includes(staff.role);
}

/** The state of one row, as far as the menu cares. */
export type RowState = {
  /** Currently hidden / suspended / cancelled (its everyday takedown state). */
  hidden: boolean;
  /** Currently in its separate "removed" state (cancelled event). */
  removed?: boolean;
  /** False when the everyday Hide doesn't apply in this state — a listing
   * that isn't live (Remove covers those), a tee time already played. */
  hideable?: boolean;
};

/**
 * Which verbs to offer for one row, given who is looking and the row's
 * state: Hide on a visible row, Restore on a hidden one, and so on. The
 * Server Action re-checks everything; this only decides what to show.
 */
export function verbsFor(staff: StaffLike, entity: ControlEntity, state: RowState): ControlVerb[] {
  const out: ControlVerb[] = [];
  const allowed = (v: ControlVerb) => canUseVerb(staff, entity, v);

  if (state.hidden) {
    if (allowed("restore")) out.push("restore");
  } else if (allowed("hide") && state.hideable !== false) {
    out.push("hide");
  }

  // Listings: Remove reaches statuses Hide can't (reserved, sold). It is
  // offered on anything not already down.
  if (entity === "listing" && !state.hidden && allowed("remove")) out.push("remove");

  if (entity !== "listing") {
    if (state.removed) {
      if (allowed("add_back")) out.push("add_back");
    } else if (allowed("remove")) {
      out.push("remove");
    }
  }

  if (allowed("delete")) out.push("delete");
  return out;
}

/** Verbs a bulk bar can offer for a whole selection (state differs per row,
 * so both directions are offered and the action skips rows already there). */
export function bulkVerbsFor(staff: StaffLike, entity: ControlEntity): ControlVerb[] {
  return CONTROL_VERBS.filter((v) => canUseVerb(staff, entity, v));
}

// ============ Confirmation ============

const normalise = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * A permanent delete asks the person to type the item's name. Compared
 * case-insensitively with whitespace collapsed — the point is to make them
 * read what they are deleting, not to fail them on a capital letter.
 */
export function confirmationMatches(expected: string, typed: string): boolean {
  const e = normalise(expected);
  return e.length > 0 && e === normalise(typed);
}

/** What to type for a bulk delete, where there's no single name. */
export function bulkConfirmationPhrase(count: number): string {
  return `delete ${count}`;
}

/** The name a row is confirmed by: its title, or "<noun> #<id>" when it has
 * none worth typing (a comment, a review). Kept short. */
export function confirmationName(entity: ControlEntity, id: string | number, title?: string | null): string {
  const t = (title ?? "").trim().replace(/\s+/g, " ");
  if (t && t.length <= 80) return t;
  return `${ENTITY_CONTROLS[entity].noun} #${id}`;
}

// ============ Delete guards ============

export type DeleteFacts =
  | { entity: "user"; isStaff: boolean; isSelf: boolean; blockedReason: string | null; pendingDeletion: boolean }
  | { entity: "listing"; orders: number; offers: number; auctions: number; promotions: number }
  | { entity: "tee_time" }
  | { entity: "club"; references: readonly { label: string; count: number }[] }
  | { entity: "group"; payments: number; results: number }
  | { entity: "outing"; payments: number }
  | { entity: "store"; orders: number; listings: number }
  | { entity: "article"; status: string }
  | { entity: "post" | "post_comment" | "course_review" | "review" };

export type DeleteCheck =
  | { allowed: false; reason: string }
  | { allowed: true; mode: "hard" | "account_deletion" };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Whether a permanent delete may go ahead. Pure: the action gathers the
 * counts with the service role and asks this. Refusals tell staff what to do
 * instead (nearly always: hide it).
 */
export function checkPermanentDelete(facts: DeleteFacts): DeleteCheck {
  switch (facts.entity) {
    case "user":
      // Never a hard delete of the profile row: GDPR erasure, Revenue's
      // six-year records and Apple's rules are all handled by the existing
      // account-deletion process (src/lib/account-deletion.ts), which this
      // starts on the member's behalf.
      if (facts.isSelf) return { allowed: false, reason: "You can't delete your own account from here." };
      if (facts.isStaff) {
        return { allowed: false, reason: "This member is on the staff list. Remove their staff role first (Staff page)." };
      }
      if (facts.pendingDeletion) return { allowed: false, reason: "This account is already scheduled for deletion." };
      if (facts.blockedReason) return { allowed: false, reason: facts.blockedReason };
      return { allowed: true, mode: "account_deletion" };

    case "listing": {
      if (facts.orders > 0) {
        return {
          allowed: false,
          reason: `This listing has ${plural(facts.orders, "order")} against it, so it's part of the sales record. Hide or remove it instead.`,
        };
      }
      if (facts.promotions > 0) {
        return {
          allowed: false,
          reason: `This listing has ${plural(facts.promotions, "paid promotion")}. Hide or remove it instead.`,
        };
      }
      if (facts.offers > 0 || facts.auctions > 0) {
        return {
          allowed: false,
          reason: "This listing has offers or an auction on record, which can lead to a payment. Hide or remove it instead.",
        };
      }
      return { allowed: true, mode: "hard" };
    }

    case "club": {
      const used = facts.references.filter((r) => r.count > 0);
      if (used.length > 0) {
        const list = used.map((r) => `${r.count} ${r.label}`).join(", ");
        return { allowed: false, reason: `This course is in use (${list}). Hide it instead.` };
      }
      return { allowed: true, mode: "hard" };
    }

    case "group":
      if (facts.payments > 0) {
        return {
          allowed: false,
          reason: `This group's events have ${plural(facts.payments, "payment record")}. Hide the group instead.`,
        };
      }
      if (facts.results > 0) {
        return { allowed: false, reason: "This group has competition results on record. Hide the group instead." };
      }
      return { allowed: true, mode: "hard" };

    case "outing":
      if (facts.payments > 0) {
        return {
          allowed: false,
          reason: `This event has ${plural(facts.payments, "payment record")}. Hide or cancel it instead.`,
        };
      }
      return { allowed: true, mode: "hard" };

    case "store":
      if (facts.orders > 0) {
        return { allowed: false, reason: `This shop has ${plural(facts.orders, "order")}. Suspend it instead.` };
      }
      if (facts.listings > 0) {
        return {
          allowed: false,
          reason: `This shop still has ${plural(facts.listings, "listing")}. Suspend it instead, or remove its listings first.`,
        };
      }
      return { allowed: true, mode: "hard" };

    case "article":
      if (facts.status === "published" || facts.status === "retracted") {
        return {
          allowed: false,
          reason: "A published article stays on the record. Retract it instead (on its review page).",
        };
      }
      return { allowed: true, mode: "hard" };

    case "tee_time":
    case "post":
    case "post_comment":
    case "course_review":
    case "review":
      return { allowed: true, mode: "hard" };
  }
}

// ============ Edit parsing ============

export type EditValues = Record<string, string | number | null>;
export type ParsedEdit = { ok: true; values: EditValues } | { ok: false; error: string };

/**
 * Validate an edit form against its field list. Mirrors the database's own
 * check constraints (lengths, ranges, allowed values) so a staff edit can't
 * save something a member's own form would have been refused.
 */
export function parseEdit(fields: readonly EditField[], raw: Record<string, unknown>): ParsedEdit {
  const values: EditValues = {};

  for (const f of fields) {
    const input = raw[f.name];
    const text = typeof input === "string" ? input : input == null ? "" : String(input);
    const trimmed = f.kind === "textarea" ? text.replace(/\s+$/, "").replace(/^\s+/, "") : text.trim();

    if (!trimmed) {
      if (f.required) return { ok: false, error: `${f.label} is required.` };
      values[f.name] = f.nullable ? null : "";
      continue;
    }

    if (f.kind === "number") {
      const n = Number(trimmed);
      if (!Number.isFinite(n)) return { ok: false, error: `${f.label} must be a number.` };
      if (f.integer && !Number.isInteger(n)) return { ok: false, error: `${f.label} must be a whole number.` };
      if (f.min != null && n < f.min) return { ok: false, error: `${f.label} must be at least ${f.min}.` };
      if (f.max != null && n > f.max) return { ok: false, error: `${f.label} must be at most ${f.max}.` };
      values[f.name] = n;
      continue;
    }

    if (f.kind === "select") {
      if (!f.options?.some((o) => o.value === trimmed)) return { ok: false, error: `Pick a value for ${f.label}.` };
      values[f.name] = trimmed;
      continue;
    }

    if (f.min != null && trimmed.length < f.min) {
      return { ok: false, error: `${f.label} needs at least ${f.min} characters.` };
    }
    if (f.max != null && trimmed.length > f.max) {
      return { ok: false, error: `${f.label} is limited to ${f.max} characters.` };
    }
    values[f.name] = trimmed;
  }

  return { ok: true, values };
}

export type FieldChange = { from: unknown; to: unknown };

/** Before/after for every field that actually changed — what goes in the
 * audit row. Numbers compared as numbers (PostgREST may hand back "4"). */
export function diffValues(before: Record<string, unknown>, after: EditValues): Record<string, FieldChange> {
  const changed: Record<string, FieldChange> = {};
  // "" and null are the same "nothing" — a nullable column cleared through a
  // form that once stored "" is not a change.
  const norm = (v: unknown) => (v === "" || v === undefined ? null : v);
  for (const [key, to] of Object.entries(after)) {
    const from = norm(before[key]);
    const same = typeof to === "number" ? from != null && Number(from) === to : from === norm(to);
    if (!same) changed[key] = { from, to };
  }
  return changed;
}

/** One reason, trimmed and bounded — every control requires one. */
export function readReason(raw: unknown): { ok: true; reason: string } | { ok: false; error: string } {
  const reason = typeof raw === "string" ? raw.trim() : "";
  if (!reason) return { ok: false, error: "A reason is required." };
  if (reason.length > 500) return { ok: false, error: "Please keep the reason under 500 characters." };
  return { ok: true, reason };
}

/** Ids from a form: one per `id` field or comma-separated. Validated by kind;
 * duplicates dropped; capped so one click can't fan out without limit. */
export const BULK_LIMIT = 100;

export function parseIds(raw: readonly unknown[], idKind: "uuid" | "bigint"): { ok: true; ids: string[] } | { ok: false; error: string } {
  const parts = raw
    .flatMap((v) => (typeof v === "string" ? v.split(",") : []))
    .map((s) => s.trim())
    .filter(Boolean);
  const ids = [...new Set(parts)];
  if (ids.length === 0) return { ok: false, error: "Nothing selected." };
  if (ids.length > BULK_LIMIT) return { ok: false, error: `Select at most ${BULK_LIMIT} at a time.` };
  const valid =
    idKind === "uuid"
      ? ids.every((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
      : ids.every((id) => /^[1-9][0-9]{0,17}$/.test(id));
  if (!valid) return { ok: false, error: "That selection isn't valid." };
  return { ok: true, ids };
}

// ============ Menus ============

/** One entry in a row "…" menu or a detail page's actions panel —
 * serialisable, so a Server Component can hand it to the client menu. */
export type MenuItem = { verb: ControlVerb; label: string; description: string; tone?: "danger" };

export function menuFor(staff: StaffLike, entity: ControlEntity, state: RowState): MenuItem[] {
  return verbsFor(staff, entity, state).map((verb) => {
    const rule = ENTITY_CONTROLS[entity].verbs[verb]!;
    return { verb, label: rule.label, description: rule.description, tone: rule.tone };
  });
}

export function bulkMenuFor(staff: StaffLike, entity: ControlEntity): MenuItem[] {
  return bulkVerbsFor(staff, entity).map((verb) => {
    const rule = ENTITY_CONTROLS[entity].verbs[verb]!;
    return { verb, label: rule.label, description: rule.description, tone: rule.tone };
  });
}

/** The edit link for a row, when the viewer may edit it. Generic edits live
 * on the record's detail page (#edit). */
export function editHrefFor(staff: StaffLike, entity: ControlEntity, id: string | number): string | null {
  if (!canEdit(staff, entity)) return null;
  const edit = ENTITY_CONTROLS[entity].edit!;
  return edit.href ? edit.href(id) : `${ENTITY_CONTROLS[entity].detailHref(id)}#edit`;
}

/** Everything a row's "…" menu needs, in one call from a Server Component. */
export function rowActionProps(
  staff: StaffLike,
  entity: ControlEntity,
  id: string | number,
  state: RowState,
  title?: string | null,
  opts: { view?: boolean } = {}
) {
  const c = ENTITY_CONTROLS[entity];
  return {
    entity,
    id,
    noun: c.noun,
    confirmName: confirmationName(entity, id, title),
    items: menuFor(staff, entity, state),
    editHref: editHrefFor(staff, entity, id),
    viewHref: opts.view === false ? null : c.detailHref(id),
  };
}

/** Props for a list's BulkBar. */
export function bulkBarProps(staff: StaffLike, entity: ControlEntity) {
  const c = ENTITY_CONTROLS[entity];
  return { entity, items: bulkMenuFor(staff, entity), noun: c.noun, plural: c.plural };
}
