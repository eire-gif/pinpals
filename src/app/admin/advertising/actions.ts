"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/admin/authorization";
import { recordAdminAction, type AdminAction, type AuditTargetType } from "@/lib/admin/audit";
import { ADVERTISING_EDIT_ROLES, CAMPAIGN_COLUMNS, type AdCampaignRow } from "@/lib/admin/advertising";
import type { StaffRole } from "@/lib/admin/roles";
import { PAYMENT_STATUSES } from "@/lib/advertising-revenue";
import { CONTENT_FIELDS, changedKeys, isSensitiveCategory, parseAdvertiserForm, parseCampaignForm } from "@/lib/advertising";
import { createAdminClient } from "@/lib/supabase/admin";

// Mutations for /admin/advertising (0139). Same discipline as
// src/app/admin/marketplace/growth-actions.ts: every action re-checks the
// caller's role itself (ADVERTISING_EDIT_ROLES — admin, finance, super
// admin), re-reads the row rather than trusting the form about its state,
// makes a guarded UPDATE whose WHERE carries the expected status (a double
// submit or a race is a friendly no-op), and writes admin_audit_log on
// success and on a failed write. The tables take no writes from anyone but
// the service role, so this file is the only way in.

export type AdActionState = { error?: string; success?: boolean };

const ROOT = "/admin/advertising";
const REASON_MAX = 1000;

type Actor = { id: string; role: StaffRole };

async function editor(): Promise<Actor> {
  const { user, staff } = await requireStaff({ roles: ADVERTISING_EDIT_ROLES });
  return { id: user.id, role: staff.role };
}

function readId(formData: FormData, field: string): number | null {
  const id = Number(formData.get(field));
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function audit(
  actor: Actor,
  action: AdminAction,
  targetType: AuditTargetType,
  targetId: number | null,
  opts: { reason?: string | null; metadata?: Record<string, unknown>; outcome?: "success" | "failure" } = {}
) {
  await recordAdminAction({
    actor,
    action,
    targetType,
    targetId,
    reason: opts.reason ?? null,
    metadata: opts.metadata,
    outcome: opts.outcome ?? "success",
  });
}

function refresh(id?: number) {
  revalidatePath(ROOT);
  if (id) {
    revalidatePath(`${ROOT}/${id}`);
    revalidatePath(`${ROOT}/${id}/report`);
  }
}

/** A database check failing is the last line of defence; say which, kindly. */
function friendly(message: string): string {
  if (/sensitive_approved/.test(message)) return "Alcohol and betting adverts need the suitability confirmation before approval.";
  if (/course_partner_clubs/.test(message)) return "Choose the course(s) this partner sponsors.";
  if (/ad_campaigns_ready/.test(message)) return "Upload the advert's image first.";
  if (/headline_ready/.test(message)) return "The photo + headline style needs a headline.";
  if (/flat_needs_end/.test(message)) return "A flat-fee deal needs an end date.";
  if (/link_url/.test(message)) return "The link must be a full https:// address.";
  return "Couldn't save that — check the fields and try again.";
}

async function loadCampaign(id: number): Promise<AdCampaignRow | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("ad_campaigns").select(CAMPAIGN_COLUMNS).eq("id", id).maybeSingle<AdCampaignRow>();
  return data ?? null;
}

// ---------------------------------------------------------------------------
// Create / edit
// ---------------------------------------------------------------------------

/**
 * Save draft, or Submit for approval (`intent=submit`). A new campaign is
 * created as a draft (or straight to pending on submit) and the page moves
 * to its own URL. Editing an approved or paused advert's content — what
 * members see — sends it back for approval; schedule, audience and money
 * changes don't.
 */
export async function saveCampaign(_prev: AdActionState, formData: FormData): Promise<AdActionState> {
  const actor = await editor();
  const submit = formData.get("intent") === "submit";

  // Editing: read the row first. Once a campaign is over only its payment
  // status moves (the rest of its form is read-only and isn't sent).
  const editingId = readId(formData, "campaignId");
  const existing = editingId ? await loadCampaign(editingId) : null;
  if (editingId && !existing) return { error: "Campaign not found." };
  if (existing && existing.status === "ended") {
    const payment = String(formData.get("payment_status") ?? "");
    if (!(PAYMENT_STATUSES as readonly string[]).includes(payment)) return { error: "Choose a payment status." };
    const changed = changedKeys(existing, { payment_status: payment });
    if (changed.length === 0) return { success: true };
    const { error } = await createAdminClient()
      .from("ad_campaigns")
      .update({ payment_status: payment, updated_at: new Date().toISOString() })
      .eq("id", existing.id)
      .eq("status", "ended");
    if (error) {
      await audit(actor, "ad_campaign.updated", "ad_campaign", existing.id, { outcome: "failure", metadata: { error: error.message, changed } });
      return { error: friendly(error.message) };
    }
    await audit(actor, "ad_campaign.updated", "ad_campaign", existing.id, {
      metadata: { changed, money: { payment_status: { from: existing.payment_status, to: payment } } },
    });
    refresh(existing.id);
    return { success: true };
  }

  // "Add new" in the advertiser picker: create the advertiser first (its own
  // audit row), then carry on as if it had been chosen.
  if (formData.get("advertiser_id") === "new") {
    const name = String(formData.get("new_advertiser_name") ?? "").trim();
    if (name.length < 2 || name.length > 120) return { error: "Give the new advertiser a name (2–120 characters)." };
    // Check the rest of the form first, so a mistake elsewhere doesn't leave
    // an advertiser behind that the next attempt would create again.
    const probe = new FormData();
    for (const [k, v] of formData.entries()) probe.append(k, v);
    probe.set("advertiser_id", "1");
    const check = parseCampaignForm(probe, { forSubmit: submit });
    if ("error" in check) return { error: check.error };
    const { data, error } = await createAdminClient()
      .from("advertisers")
      .insert({ name, created_by: actor.id })
      .select("id")
      .single<{ id: number }>();
    if (error || !data) {
      await audit(actor, "advertiser.created", "advertiser", null, { outcome: "failure", metadata: { error: error?.message, name } });
      return { error: "Couldn't add the advertiser — try again." };
    }
    await audit(actor, "advertiser.created", "advertiser", data.id, { metadata: { name, from: "campaign form" } });
    formData.set("advertiser_id", String(data.id));
  }

  const parsed = parseCampaignForm(formData, { forSubmit: submit });
  if ("error" in parsed) return { error: parsed.error };
  const input = parsed.value;
  const id = existing?.id ?? null;
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  if (!id) {
    const { data, error } = await admin
      .from("ad_campaigns")
      .insert({ ...input, status: submit ? "pending_approval" : "draft", created_by: actor.id })
      .select("id")
      .single<{ id: number }>();
    if (error || !data) {
      await audit(actor, "ad_campaign.created", "ad_campaign", null, { outcome: "failure", metadata: { error: error?.message, name: input.name } });
      return { error: friendly(error?.message ?? "") };
    }
    await audit(actor, "ad_campaign.created", "ad_campaign", data.id, {
      metadata: { name: input.name, format: input.format, category: input.category, pricing: input.pricing_model, rateEur: input.rate_eur, submitted: submit },
    });
    refresh(data.id);
    redirect(`${ROOT}/${data.id}?saved=1`);
  }

  const before = existing!;
  const changed = changedKeys(before, input);
  const contentChanged = changed.some((k) => (CONTENT_FIELDS as readonly string[]).includes(k));
  let status = before.status;
  if (submit && (before.status === "draft" || before.status === "rejected")) status = "pending_approval";
  else if (contentChanged && (before.status === "approved" || before.status === "paused")) status = "pending_approval";
  if (changed.length === 0 && status === before.status) return { success: true };

  const patch: Record<string, unknown> = { ...input, status, updated_at: nowIso };
  // A category change re-opens the suitability confirmation.
  if (changed.includes("category")) {
    patch.sensitive_ack_by = null;
    patch.sensitive_ack_at = null;
  }
  if (status === "pending_approval" && before.status === "rejected") patch.reject_reason = null;

  const { data: updated, error } = await admin
    .from("ad_campaigns")
    .update(patch)
    .eq("id", id)
    .eq("status", before.status)
    .select("id")
    .maybeSingle();
  if (error) {
    await audit(actor, "ad_campaign.updated", "ad_campaign", id, { outcome: "failure", metadata: { error: error.message, changed } });
    return { error: friendly(error.message) };
  }
  if (!updated) return { error: "This campaign changed while you were editing — refresh and try again." };

  const money = (["rate_eur", "budget_cap_eur", "payment_status", "pricing_model"] as const).filter((k) => changed.includes(k));
  await audit(actor, "ad_campaign.updated", "ad_campaign", id, {
    metadata: {
      changed,
      ...(money.length ? { money: Object.fromEntries(money.map((k) => [k, { from: before[k] ?? null, to: input[k] ?? null }])) } : {}),
      ...(status !== before.status ? { previousStatus: before.status, newStatus: status } : {}),
    },
  });
  if (submit && status === "pending_approval" && before.status !== "pending_approval") {
    await audit(actor, "ad_campaign.submitted", "ad_campaign", id, { metadata: { name: input.name } });
  }
  refresh(id);
  return { success: true };
}

// ---------------------------------------------------------------------------
// Status changes
// ---------------------------------------------------------------------------

type Transition = {
  action: AdminAction;
  from: readonly string[];
  to: "approved" | "rejected" | "paused" | "ended";
  reasonRequired?: boolean;
};

async function transition(formData: FormData, t: Transition, extra: (c: AdCampaignRow, actor: Actor) => Record<string, unknown> | { error: string } = () => ({})): Promise<AdActionState> {
  const actor = await editor();
  const id = readId(formData, "campaignId");
  if (!id) return { error: "Missing campaign." };
  const reason = String(formData.get("reason") ?? "").trim() || null;
  if (t.reasonRequired && !reason) return { error: "A reason is required." };
  if (reason && reason.length > REASON_MAX) return { error: "Reason is too long." };

  const c = await loadCampaign(id);
  if (!c) return { error: "Campaign not found." };
  if (c.status === t.to) {
    refresh(id);
    return { success: true };
  }
  if (!t.from.includes(c.status)) return { error: `This campaign is ${c.status.replace("_", " ")} — refresh and try again.` };

  const more = extra(c, actor);
  if ("error" in more) return { error: String(more.error) };

  const admin = createAdminClient();
  const { data: updated, error } = await admin
    .from("ad_campaigns")
    .update({ status: t.to, updated_at: new Date().toISOString(), ...more })
    .eq("id", id)
    .eq("status", c.status)
    .select("id")
    .maybeSingle();
  if (error) {
    await audit(actor, t.action, "ad_campaign", id, { reason, outcome: "failure", metadata: { error: error.message } });
    return { error: friendly(error.message) };
  }
  if (!updated) return { error: "This campaign changed while you were looking at it — refresh and try again." };

  await audit(actor, t.action, "ad_campaign", id, {
    reason,
    metadata: { previousStatus: c.status, newStatus: t.to, name: c.name, category: c.category, ...("sensitive_ack_at" in more ? { sensitiveConfirmed: true } : {}) },
  });
  refresh(id);
  return { success: true };
}

export async function approveCampaign(_prev: AdActionState, formData: FormData): Promise<AdActionState> {
  return transition(formData, { action: "ad_campaign.approved", from: ["pending_approval"], to: "approved" }, (c, actor) => {
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { approved_by: actor.id, approved_at: now };
    if (isSensitiveCategory(c.category)) {
      if (formData.get("confirm_sensitive") !== "on") {
        return { error: "Tick the box to confirm this alcohol/betting advert is suitable for PinPals members (all 18+)." };
      }
      patch.sensitive_ack_by = actor.id;
      patch.sensitive_ack_at = now;
    }
    return patch;
  });
}

export async function rejectCampaign(_prev: AdActionState, formData: FormData): Promise<AdActionState> {
  const reason = String(formData.get("reason") ?? "").trim();
  return transition(formData, { action: "ad_campaign.rejected", from: ["pending_approval"], to: "rejected", reasonRequired: true }, () => ({
    reject_reason: reason.slice(0, REASON_MAX),
  }));
}

export async function pauseCampaign(_prev: AdActionState, formData: FormData): Promise<AdActionState> {
  return transition(formData, { action: "ad_campaign.paused", from: ["approved"], to: "paused" });
}

export async function resumeCampaign(_prev: AdActionState, formData: FormData): Promise<AdActionState> {
  return transition(formData, { action: "ad_campaign.resumed", from: ["paused"], to: "approved" });
}

export async function endCampaign(_prev: AdActionState, formData: FormData): Promise<AdActionState> {
  return transition(formData, { action: "ad_campaign.ended", from: ["approved", "paused", "pending_approval"], to: "ended" }, () => ({
    end_reason: "manual",
    ended_at: new Date().toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// House rules and the master switch
// ---------------------------------------------------------------------------

function readWhole(formData: FormData, field: string, min: number, max: number): number | null {
  const raw = String(formData.get(field) ?? "").trim();
  if (!/^\d{1,3}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= min && n <= max ? n : null;
}

export async function saveAdSettings(_prev: AdActionState, formData: FormData): Promise<AdActionState> {
  const actor = await editor();
  const gap = readWhole(formData, "takeover_min_hours_between", 0, 168);
  const quiet = readWhole(formData, "new_member_ad_free_days", 0, 365);
  if (gap == null) return { error: "Hours between takeovers: a whole number from 0 to 168." };
  if (quiet == null) return { error: "Ad-free days for new members: a whole number from 0 to 365." };
  return writeSettings(actor, { takeover_min_hours_between: gap, new_member_ad_free_days: quiet });
}

export async function setAdsEnabled(_prev: AdActionState, formData: FormData): Promise<AdActionState> {
  const actor = await editor();
  const on = formData.get("enabled") === "on";
  return writeSettings(actor, { ads_enabled: on });
}

async function writeSettings(actor: Actor, patch: Record<string, unknown>): Promise<AdActionState> {
  const admin = createAdminClient();
  const { data: before } = await admin
    .from("ad_settings")
    .select("ads_enabled, takeover_min_hours_between, new_member_ad_free_days")
    .eq("id", true)
    .maybeSingle<Record<string, unknown>>();
  const changed = changedKeys(before ?? {}, patch);
  if (before && changed.length === 0) return { success: true };
  // Upsert: the row is created by 0139, but a restore without it shouldn't strand the switch.
  const { error } = await admin
    .from("ad_settings")
    .upsert({ id: true, ...patch, updated_by: actor.id, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) {
    await audit(actor, "ad_settings.updated", "ad_settings", null, { outcome: "failure", metadata: { error: error.message, changed } });
    return { error: "Couldn't save the settings — try again." };
  }
  await audit(actor, "ad_settings.updated", "ad_settings", null, {
    metadata: { changed, before: before ?? null, after: patch },
  });
  refresh();
  return { success: true };
}

// ---------------------------------------------------------------------------
// Advertisers
// ---------------------------------------------------------------------------

export async function saveAdvertiser(_prev: AdActionState, formData: FormData): Promise<AdActionState> {
  const actor = await editor();
  const parsed = parseAdvertiserForm(formData);
  if ("error" in parsed) return { error: parsed.error };
  const input = parsed.value;
  const id = readId(formData, "advertiserId");
  const admin = createAdminClient();

  if (!id) {
    const { data, error } = await admin
      .from("advertisers")
      .insert({ ...input, created_by: actor.id })
      .select("id")
      .single<{ id: number }>();
    if (error || !data) {
      await audit(actor, "advertiser.created", "advertiser", null, { outcome: "failure", metadata: { error: error?.message, name: input.name } });
      return { error: "Couldn't add the advertiser — check the fields and try again." };
    }
    await audit(actor, "advertiser.created", "advertiser", data.id, { metadata: { name: input.name } });
    refresh();
    revalidatePath(`${ROOT}/advertisers`);
    return { success: true };
  }

  const { data: before } = await admin
    .from("advertisers")
    .select("name, contact_name, email, phone, website, logo_url, notes")
    .eq("id", id)
    .maybeSingle<Record<string, unknown>>();
  if (!before) return { error: "Advertiser not found." };
  const changed = changedKeys(before, input);
  if (changed.length === 0) return { success: true };
  const { error } = await admin.from("advertisers").update({ ...input, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) {
    await audit(actor, "advertiser.updated", "advertiser", id, { outcome: "failure", metadata: { error: error.message, changed } });
    return { error: "Couldn't save the advertiser — try again." };
  }
  // Field names only: contact details are personal data and stay out of the log.
  await audit(actor, "advertiser.updated", "advertiser", id, { metadata: { changed } });
  refresh();
  revalidatePath(`${ROOT}/advertisers`);
  return { success: true };
}
