"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStaff } from "@/lib/admin/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAdminAction, type AdminAction, type AuditTargetType } from "@/lib/admin/audit";
import type { StaffRole } from "@/lib/admin/roles";
import {
  ENTITY_CONTROLS,
  bulkConfirmationPhrase,
  checkPermanentDelete,
  confirmationMatches,
  confirmationName,
  diffValues,
  isControlEntity,
  isControlVerb,
  parseEdit,
  parseIds,
  readReason,
  type ControlEntity,
  type ControlVerb,
  type DeleteFacts,
} from "@/lib/admin/controls";
import { requestAccountDeletionByStaff, cancelAccountDeletionByStaff, pendingDeletionFor } from "@/lib/account-deletion";
import { suspendUser, reinstateUser } from "../users/[id]/actions";
import { hideListing, restoreListing, forceRemoveListing } from "../listings/[id]/actions";
import { cancelInvite, restoreInvite } from "../tee-times/[id]/actions";
import { hidePost, restorePost, hideComment, restoreComment } from "../feed/actions";
import { hideCourseReview, restoreCourseReview } from "../course-reviews/actions";
import { hideReview, restoreReview } from "../reviews/actions";
import { suspendStore, reinstateStore } from "../marketplace/growth-actions";

/**
 * The admin console's shared controls — one Server Action behind every row
 * "…" menu, every bulk bar and every detail page's actions panel. See
 * claude/admin.md and src/lib/admin/controls.ts (the rules).
 *
 * Wherever an action already existed (suspend, hide a listing, cancel a tee
 * time, hide a post, suspend a shop…) this calls it, unchanged, so its own
 * checks, notifications and audit row stay exactly as they were. What's new
 * here: hide/restore for courses, groups and events (0140), cancel/re-open
 * for events, generic edits, and Delete permanently.
 *
 * Every path: requireStaff() with the verb's roles, service-role writes, an
 * audit row (reason, before/after or a snapshot), revalidatePath.
 */

export type ControlState = {
  error?: string;
  success?: boolean;
  message?: string;
};

type Actor = { id: string; role: StaffRole };
type Ctx = { actor: Actor; reason: string; admin: SupabaseClient; formData: FormData };
/** null on success, else the error to show. */
type Handler = (ctx: Ctx, id: string) => Promise<string | null>;

const AUDIT: Record<ControlEntity, { target: AuditTargetType; prefix: string }> = {
  user: { target: "user", prefix: "user" },
  listing: { target: "listing", prefix: "listing" },
  tee_time: { target: "tee_time_invite", prefix: "invite" },
  club: { target: "club", prefix: "club" },
  group: { target: "group", prefix: "group" },
  outing: { target: "outing", prefix: "outing" },
  post: { target: "post", prefix: "post" },
  post_comment: { target: "post_comment", prefix: "post_comment" },
  course_review: { target: "course_review", prefix: "course_review" },
  review: { target: "review", prefix: "review" },
  store: { target: "store", prefix: "store" },
  article: { target: "article", prefix: "article" },
};

/** The column a row is named by, for the "type its name" confirmation. */
const TITLE_SELECT: Partial<Record<ControlEntity, string>> = {
  user: "first_name, last_name",
  listing: "title",
  tee_time: "club_name",
  club: "name",
  group: "name",
  outing: "title",
  store: "name",
  article: "headline",
};

function titleOf(entity: ControlEntity, row: Record<string, unknown> | null): string | null {
  if (!row) return null;
  if (entity === "user") return [row.first_name, row.last_name].filter(Boolean).join(" ") || null;
  const col = TITLE_SELECT[entity];
  return col ? ((row[col] as string | null) ?? null) : null;
}

/** Where to refresh after a change: the admin list and detail, and the
 * member-facing pages that read the row. */
function revalidateFor(entity: ControlEntity, ids: string[]) {
  const c = ENTITY_CONTROLS[entity];
  revalidatePath(c.listHref.split("?")[0]);
  for (const id of ids.slice(0, 20)) revalidatePath(c.detailHref(id));
  revalidatePath("/admin");
  const publicPaths: Partial<Record<ControlEntity, string[]>> = {
    listing: ["/marketplace"],
    tee_time: ["/tee-times"],
    club: ["/courses"],
    group: ["/groups"],
    post: ["/feed"],
    post_comment: ["/feed"],
    course_review: ["/courses"],
    store: ["/marketplace"],
    article: ["/news"],
  };
  for (const p of publicPaths[entity] ?? []) revalidatePath(p, "layout");
}

// ============ Calling the existing actions ============

type ExistingAction = (prev: { error?: string; success?: boolean }, fd: FormData) => Promise<{ error?: string; success?: boolean }>;

/** Run one of the pre-existing single-item actions with its own field name. */
function viaExisting(action: ExistingAction, idField: string): Handler {
  return async (ctx, id) => {
    const fd = new FormData();
    fd.set(idField, id);
    fd.set("reason", ctx.reason);
    const result = await action({}, fd);
    return result.error ?? null;
  };
}

// ============ hidden_at for courses, groups and events (0140) ============

function setHidden(entity: "club" | "group" | "outing", hide: boolean): Handler {
  return async ({ actor, reason, admin }, id) => {
    const table = ENTITY_CONTROLS[entity].table;
    const noun = ENTITY_CONTROLS[entity].noun;
    const { data: row, error: readError } = await admin
      .from(table)
      .select("id, hidden_at")
      .eq("id", id)
      .maybeSingle<{ id: number; hidden_at: string | null }>();
    if (readError) return `Couldn't read that ${noun}${readError.code === "42703" ? " — is migration 0140 applied?" : "."}`;
    if (!row) return `That ${noun} no longer exists.`;
    if (hide && row.hidden_at) return `This ${noun} is already hidden.`;
    if (!hide && !row.hidden_at) return `This ${noun} isn't hidden.`;

    const { error } = await admin
      .from(table)
      .update(
        hide
          ? { hidden_at: new Date().toISOString(), hidden_by: actor.id, hidden_reason: reason }
          : { hidden_at: null, hidden_by: null, hidden_reason: null }
      )
      .eq("id", id);

    await recordAdminAction({
      actor,
      action: `${entity}.${hide ? "hide" : "restore"}` as AdminAction,
      targetType: AUDIT[entity].target,
      targetId: id,
      reason,
      outcome: error ? "failure" : "success",
      metadata: error ? { error: error.message } : { hidden: { from: !!row.hidden_at, to: hide } },
    });
    return error ? `Couldn't ${hide ? "hide" : "restore"} that ${noun} — please try again.` : null;
  };
}

/** Events: cancelled is their own "removed" state (0125). */
function setOutingCancelled(cancel: boolean): Handler {
  return async ({ actor, reason, admin }, id) => {
    const { data: row } = await admin.from("society_outings").select("id, status").eq("id", id).maybeSingle<{ id: number; status: string }>();
    if (!row) return "That event no longer exists.";
    if (cancel && row.status === "cancelled") return "This event is already cancelled.";
    if (!cancel && row.status !== "cancelled") return "This event isn't cancelled.";
    const to = cancel ? "cancelled" : "open";
    const { error } = await admin.from("society_outings").update({ status: to }).eq("id", id);
    await recordAdminAction({
      actor,
      action: cancel ? "outing.cancelled" : "outing.reopened",
      targetType: "outing",
      targetId: id,
      reason,
      outcome: error ? "failure" : "success",
      metadata: error ? { error: error.message } : { previousStatus: row.status, newStatus: to },
    });
    return error ? "Couldn't update that event — please try again." : null;
  };
}

// ============ Delete permanently ============

async function count(admin: SupabaseClient, table: string, column: string, value: string | string[], extra?: (q: any) => any): Promise<number> { // eslint-disable-line @typescript-eslint/no-explicit-any
  let q = admin.from(table).select("*", { count: "exact", head: true });
  q = Array.isArray(value) ? q.in(column, value) : q.eq(column, value);
  if (extra) q = extra(q);
  const { count: n, error } = await q;
  // A count that can't be taken must never read as "nothing in the way".
  if (error) throw new Error(`Couldn't check ${table}: ${error.message}`);
  return n ?? 0;
}

async function outingIds(admin: SupabaseClient, groupId: string): Promise<string[]> {
  const { data } = await admin.from("society_outings").select("id").eq("group_id", groupId);
  return (data ?? []).map((r: { id: number }) => String(r.id));
}

async function deleteFacts(entity: ControlEntity, id: string, ctx: Ctx): Promise<DeleteFacts> {
  const { admin, actor } = ctx;
  switch (entity) {
    case "user": {
      const [{ data: staffRow }, pending, { data: blocked, error }] = await Promise.all([
        admin.from("staff_roles").select("user_id").eq("user_id", id).maybeSingle(),
        pendingDeletionFor(id),
        admin.rpc("can_delete_account_for", { p_user_id: id }),
      ]);
      if (error) throw new Error("Couldn't check this account (is migration 0140 applied?)");
      return {
        entity,
        isStaff: !!staffRow,
        isSelf: id === actor.id,
        blockedReason: typeof blocked === "string" && blocked ? blocked : null,
        pendingDeletion: !!pending,
      };
    }
    case "listing": {
      const [orders, offers, auctions, promotions] = await Promise.all([
        count(admin, "orders", "listing_id", id),
        count(admin, "offers", "listing_id", id),
        count(admin, "auctions", "listing_id", id),
        count(admin, "listing_promotions", "listing_id", id, (q) => q.in("status", ["active", "expired", "refunded"])),
      ]);
      return { entity, orders, offers, auctions, promotions };
    }
    case "club": {
      const refs: [string, string, string][] = [
        ["profiles", "home_club_id", "home-club members"],
        ["tee_time_invites", "club_id", "tee times"],
        ["course_reviews", "club_id", "course reviews"],
        ["member_courses", "club_id", "played-it records"],
        ["club_favourites", "club_id", "favourites"],
        ["scorecards", "club_id", "scorecards"],
        ["live_rounds", "club_id", "live rounds"],
        ["live_match_days", "club_id", "match days"],
        ["groups", "club_id", "groups"],
        ["posts", "club_id", "posts"],
        ["stores", "club_id", "pro shops"],
        ["society_outings", "club_id", "events"],
        ["society_outing_items", "club_id", "itinerary stops"],
      ];
      const counts = await Promise.all(refs.map(([t, c]) => count(admin, t, c, id)));
      return { entity, references: refs.map(([, , label], i) => ({ label, count: counts[i] })) };
    }
    case "group": {
      const outings = await outingIds(admin, id);
      const [payments, claims, results] = await Promise.all([
        outings.length ? count(admin, "society_outing_payments", "outing_id", outings) : 0,
        outings.length ? count(admin, "society_outing_payment_claims", "outing_id", outings) : 0,
        count(admin, "competition_results", "group_id", id),
      ]);
      return { entity, payments: payments + claims, results };
    }
    case "outing": {
      const [payments, claims] = await Promise.all([
        count(admin, "society_outing_payments", "outing_id", id),
        count(admin, "society_outing_payment_claims", "outing_id", id),
      ]);
      return { entity, payments: payments + claims };
    }
    case "store": {
      const [orders, listings] = await Promise.all([count(admin, "orders", "store_id", id), count(admin, "listings", "store_id", id)]);
      return { entity, orders, listings };
    }
    case "article": {
      const { data } = await admin.from("articles").select("status").eq("id", id).maybeSingle<{ status: string }>();
      return { entity, status: data?.status ?? "" };
    }
    case "tee_time":
    case "post":
    case "post_comment":
    case "course_review":
    case "review":
      return { entity };
  }
}

/** Storage that would be orphaned once the rows naming it cascade away. */
async function removePostMedia(admin: SupabaseClient, postId: string) {
  const [{ data: images }, { data: videos }] = await Promise.all([
    admin.from("post_images").select("path").eq("post_id", postId),
    admin.from("post_videos").select("path").eq("post_id", postId),
  ]);
  return async () => {
    const imagePaths = (images ?? []).map((r: { path: string }) => r.path);
    const videoPaths = (videos ?? []).map((r: { path: string }) => r.path);
    if (imagePaths.length) await admin.storage.from("post-images").remove(imagePaths);
    if (videoPaths.length) await admin.storage.from("post-videos").remove(videoPaths);
  };
}

/** A listing's photos live in the public listing-images bucket under the
 * path after ".../object/public/listing-images/" in their URL. */
async function removeListingImages(admin: SupabaseClient, listingId: string, mainUrl: unknown) {
  const { data: images } = await admin.from("listing_images").select("image_url").eq("listing_id", listingId);
  const marker = "/object/public/listing-images/";
  const urls = [...(images ?? []).map((r: { image_url: string }) => r.image_url), typeof mainUrl === "string" ? mainUrl : null];
  const paths = [
    ...new Set(
      urls
        .filter((u): u is string => !!u && u.includes(marker))
        .map((u) => decodeURIComponent(u.split(marker)[1].split("?")[0]))
    ),
  ];
  return async () => {
    if (paths.length) await admin.storage.from("listing-images").remove(paths);
  };
}

function deletePermanently(entity: ControlEntity): Handler {
  return async (ctx, id) => {
    const { admin, actor, reason } = ctx;
    const c = ENTITY_CONTROLS[entity];

    let facts: DeleteFacts;
    try {
      facts = await deleteFacts(entity, id, ctx);
    } catch (err) {
      return err instanceof Error ? err.message : "Couldn't check what this is linked to.";
    }
    const check = checkPermanentDelete(facts);
    if (!check.allowed) return check.reason;

    // ---- Members: the existing account-deletion process, never a DELETE ----
    if (check.mode === "account_deletion") {
      const immediate = ctx.formData.get("immediate") === "on";
      const result = await requestAccountDeletionByStaff(id, { immediate });
      await recordAdminAction({
        actor,
        action: "user.deletion_requested",
        targetType: "user",
        targetId: id,
        reason,
        outcome: result.ok ? "success" : "failure",
        metadata: result.ok ? { scheduledFor: result.value.scheduledFor, immediate } : { error: result.message },
      });
      return result.ok ? null : result.message;
    }

    // ---- Everything else: snapshot, delete, audit ----
    const { data: snapshot } = await admin.from(c.table).select("*").eq("id", id).maybeSingle<Record<string, unknown>>();
    if (!snapshot) return `That ${c.noun} no longer exists.`;

    // Files the rows point at, read before the cascade takes the rows away and
    // removed only once the delete has succeeded.
    const afterDelete =
      entity === "post"
        ? await removePostMedia(admin, id)
        : entity === "listing"
          ? await removeListingImages(admin, id, snapshot.image_url)
          : null;
    const { error } = await admin.from(c.table).delete().eq("id", id);

    await recordAdminAction({
      actor,
      action: `${AUDIT[entity].prefix}.deleted` as AdminAction,
      targetType: AUDIT[entity].target,
      targetId: id,
      reason,
      outcome: error ? "failure" : "success",
      metadata: error ? { error: error.message, snapshot } : { snapshot },
    });

    if (error) {
      // A foreign key this code didn't know about: say so plainly.
      return error.code === "23503"
        ? `This ${c.noun} is still referenced elsewhere, so it can't be deleted. Hide it instead.`
        : `Couldn't delete that ${c.noun} — please try again.`;
    }
    if (afterDelete) await afterDelete();
    return null;
  };
}

// ============ The handler table ============

const HANDLERS: Record<ControlEntity, Partial<Record<ControlVerb, Handler>>> = {
  user: {
    hide: viaExisting(suspendUser, "userId"),
    restore: viaExisting(reinstateUser, "userId"),
    delete: deletePermanently("user"),
  },
  listing: {
    hide: viaExisting(hideListing, "listingId"),
    remove: viaExisting(forceRemoveListing, "listingId"),
    restore: viaExisting(restoreListing, "listingId"),
    delete: deletePermanently("listing"),
  },
  tee_time: {
    hide: viaExisting(cancelInvite, "inviteId"),
    restore: viaExisting(restoreInvite, "inviteId"),
    delete: deletePermanently("tee_time"),
  },
  club: { hide: setHidden("club", true), restore: setHidden("club", false), delete: deletePermanently("club") },
  group: { hide: setHidden("group", true), restore: setHidden("group", false), delete: deletePermanently("group") },
  outing: {
    hide: setHidden("outing", true),
    restore: setHidden("outing", false),
    remove: setOutingCancelled(true),
    add_back: setOutingCancelled(false),
    delete: deletePermanently("outing"),
  },
  post: { hide: viaExisting(hidePost, "targetId"), restore: viaExisting(restorePost, "targetId"), delete: deletePermanently("post") },
  post_comment: {
    hide: viaExisting(hideComment, "targetId"),
    restore: viaExisting(restoreComment, "targetId"),
    delete: deletePermanently("post_comment"),
  },
  course_review: {
    hide: viaExisting(hideCourseReview, "reviewId"),
    restore: viaExisting(restoreCourseReview, "reviewId"),
    delete: deletePermanently("course_review"),
  },
  review: {
    hide: viaExisting(hideReview, "reviewId"),
    restore: viaExisting(restoreReview, "reviewId"),
    delete: deletePermanently("review"),
  },
  store: {
    hide: viaExisting(suspendStore, "storeId"),
    restore: viaExisting(reinstateStore, "storeId"),
    delete: deletePermanently("store"),
  },
  article: { delete: deletePermanently("article") },
};

const PAST: Record<ControlVerb, string> = {
  hide: "Done",
  restore: "Restored",
  remove: "Removed",
  add_back: "Added back",
  delete: "Deleted",
};

/**
 * Hide / Restore / Remove / Add back / Delete permanently, for one row or a
 * bulk selection. Form fields: entity, verb, id (repeated or comma-separated),
 * reason, and for a delete `confirm` (the item's name, or "delete N").
 */
export async function runControl(_prev: ControlState, formData: FormData): Promise<ControlState> {
  const entity = formData.get("entity");
  const verb = formData.get("verb");
  if (!isControlEntity(entity) || !isControlVerb(verb)) return { error: "Unknown action." };

  const rule = ENTITY_CONTROLS[entity].verbs[verb];
  const handler = HANDLERS[entity][verb];
  if (!rule || !handler) return { error: "That action isn't available here." };

  const { user, staff } = await requireStaff({ roles: rule.roles });

  const reason = readReason(formData.get("reason"));
  if (!reason.ok) return { error: reason.error };

  const parsed = parseIds(formData.getAll("id"), ENTITY_CONTROLS[entity].idKind);
  if (!parsed.ok) return { error: parsed.error };
  const ids = parsed.ids;

  const admin = createAdminClient();

  if (verb === "delete") {
    const typed = String(formData.get("confirm") ?? "");
    let expected: string;
    if (ids.length === 1 && formData.get("bulk") !== "1") {
      const select = TITLE_SELECT[entity];
      const { data: row } = select
        ? await admin.from(ENTITY_CONTROLS[entity].table).select(select).eq("id", ids[0]).maybeSingle<Record<string, unknown>>()
        : { data: null };
      expected = confirmationName(entity, ids[0], titleOf(entity, row));
    } else {
      expected = bulkConfirmationPhrase(ids.length);
    }
    if (!confirmationMatches(expected, typed)) {
      return { error: `To confirm, type "${expected}" exactly.` };
    }
  }

  const ctx: Ctx = { actor: { id: user.id, role: staff.role }, reason: reason.reason, admin, formData };
  const failures: string[] = [];
  // One at a time: each may notify a member and writes its own audit row, and
  // a failure part-way should leave a clear record of what did and didn't go.
  for (const id of ids) {
    try {
      const error = await handler(ctx, id);
      if (error) failures.push(ids.length > 1 ? `#${id}: ${error}` : error);
    } catch (err) {
      failures.push(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  revalidateFor(entity, ids);

  const done = ids.length - failures.length;
  if (failures.length > 0) {
    const head = ids.length > 1 ? `${done} of ${ids.length} done. ` : "";
    return { error: `${head}${failures.slice(0, 3).join(" ")}${failures.length > 3 ? ` (+${failures.length - 3} more)` : ""}` };
  }
  const c = ENTITY_CONTROLS[entity];
  const message =
    entity === "user" && verb === "delete"
      ? "Account deletion started."
      : `${PAST[verb]} — ${ids.length} ${ids.length === 1 ? c.noun : c.plural}.`;
  return { success: true, message };
}

/** Undo a staff- or member-started account deletion that hasn't run yet. */
export async function cancelMemberDeletion(_prev: ControlState, formData: FormData): Promise<ControlState> {
  const { user, staff } = await requireStaff({ roles: ENTITY_CONTROLS.user.verbs.delete!.roles });
  const id = parseIds([formData.get("id")], "uuid");
  if (!id.ok) return { error: id.error };
  const reason = readReason(formData.get("reason"));
  if (!reason.ok) return { error: reason.error };

  const result = await cancelAccountDeletionByStaff(id.ids[0]);
  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "user.deletion_cancelled",
    targetType: "user",
    targetId: id.ids[0],
    reason: reason.reason,
    outcome: result.ok ? "success" : "failure",
    metadata: result.ok ? {} : { error: result.message },
  });
  if (!result.ok) return { error: result.message };
  revalidateFor("user", id.ids);
  return { success: true, message: "Deletion cancelled. The account is unlocked." };
}

// ============ Edit ============

/** Side effects an edit needs beyond its own row. */
async function afterEdit(admin: SupabaseClient, entity: ControlEntity, id: string, changed: Record<string, unknown>) {
  // A group's chat carries its name (update_group in 0120 does the same).
  if (entity === "group" && "name" in changed) {
    const { data } = await admin.from("groups").select("name, conversation_id").eq("id", id).maybeSingle<{ name: string; conversation_id: number | null }>();
    if (data?.conversation_id) await admin.from("conversations").update({ title: data.name }).eq("id", data.conversation_id);
  }
}

/**
 * Save an admin edit of a record's meaningful fields (the field list for each
 * kind is in ENTITY_CONTROLS). Validated against the same limits as the
 * database; the audit row carries a before/after for each changed field.
 */
export async function saveRecordEdit(_prev: ControlState, formData: FormData): Promise<ControlState> {
  const entity = formData.get("entity");
  if (!isControlEntity(entity)) return { error: "Unknown record." };
  const c = ENTITY_CONTROLS[entity];
  const fields = c.edit?.fields;
  if (!c.edit || !fields) return { error: "This record is edited on its own page." };

  const { user, staff } = await requireStaff({ roles: c.edit.roles });

  const parsedId = parseIds([formData.get("id")], c.idKind);
  if (!parsedId.ok || parsedId.ids.length !== 1) return { error: "Missing record id." };
  const id = parsedId.ids[0];

  const reason = readReason(formData.get("reason"));
  if (!reason.ok) return { error: reason.error };

  const raw: Record<string, unknown> = {};
  for (const f of fields) raw[f.name] = formData.get(f.name);
  const parsed = parseEdit(fields, raw);
  if (!parsed.ok) return { error: parsed.error };

  const admin = createAdminClient();
  const { data: before } = await admin
    .from(c.table)
    .select(fields.map((f) => f.name).join(", "))
    .eq("id", id)
    .maybeSingle<Record<string, unknown>>();
  if (!before) return { error: `That ${c.noun} no longer exists.` };

  const changed = diffValues(before, parsed.values);
  if (Object.keys(changed).length === 0) return { error: "Nothing changed — edit a field before saving." };

  const update: Record<string, unknown> = {};
  for (const key of Object.keys(changed)) update[key] = parsed.values[key];
  if (entity === "post_comment") update.edited_at = new Date().toISOString();

  const { error } = await admin.from(c.table).update(update).eq("id", id);

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: `${AUDIT[entity].prefix}.edited` as AdminAction,
    targetType: AUDIT[entity].target,
    targetId: id,
    reason: reason.reason,
    outcome: error ? "failure" : "success",
    metadata: error ? { error: error.message, changed } : { changed },
  });

  if (error) return { error: `Couldn't save — ${error.message}` };
  await afterEdit(admin, entity, id, changed);
  revalidateFor(entity, [id]);
  return { success: true, message: "Saved." };
}
