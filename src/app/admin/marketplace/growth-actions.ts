"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/admin/authorization";
import { FINANCE_ROLES } from "@/lib/admin/finance";
import type { StaffRole } from "@/lib/admin/roles";
import { recordAdminAction, type AdminAction, type AuditTargetType } from "@/lib/admin/audit";
import { formatCommissionRate, parseCommissionPercent, toAmount } from "@/lib/admin/marketplace-revenue";
import { changedFields, parseAffiliateProductForm, parseBannerForm } from "@/lib/admin/marketplace-catalog";
import { notifyUser } from "@/lib/notifications-server";
import { createAdminClient } from "@/lib/supabase/admin";

// Mutations for /admin/marketplace's Pro shops, Promotions and Retail & ads
// tabs (0115). Every table they touch is written by the service role only
// (0115 revokes insert/update/delete from anon and authenticated), so each
// action: re-checks the caller's role itself (FINANCE_ROLES — commission and
// paid placements are money decisions), re-reads the row by id rather than
// trusting anything the form says about its state, makes a guarded UPDATE
// whose WHERE clause carries the expected status (so a double-submit or a
// race is a friendly no-op), and writes an admin_audit_log row via
// recordAdminAction() on success and on a failed write.

export type GrowthActionState = { error?: string; success?: boolean };

const REASON_MAX_LENGTH = 4000; // same bound as every other admin reason field
const PAGE = "/admin/marketplace";

type Actor = { id: string; role: StaffRole };

async function financeActor(): Promise<Actor> {
  const { user, staff } = await requireStaff({ roles: FINANCE_ROLES });
  return { id: user.id, role: staff.role };
}

function readId(formData: FormData, field: string): number | null {
  const id = Number(formData.get(field));
  return Number.isInteger(id) && id > 0 ? id : null;
}

function readReason(formData: FormData, required: boolean): { reason: string | null } | { error: string } {
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return required ? { error: "A reason is required." } : { reason: null };
  if (reason.length > REASON_MAX_LENGTH) return { error: "Reason is too long." };
  return { reason };
}

async function audit(
  actor: Actor,
  action: AdminAction,
  targetType: AuditTargetType,
  targetId: number,
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

// ---------------------------------------------------------------------------
// Pro shops
// ---------------------------------------------------------------------------

type StoreRow = { id: number; name: string; owner_id: string; status: string; commission_rate: number; approved_at: string | null };

async function loadStore(storeId: number): Promise<StoreRow | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("stores")
    .select("id, name, owner_id, status, commission_rate, approved_at")
    .eq("id", storeId)
    .maybeSingle<StoreRow>();
  return data ?? null;
}

async function changeStoreStatus(
  formData: FormData,
  opts: {
    action: "store.approve" | "store.suspend" | "store.reinstate";
    from: readonly string[];
    to: "active" | "suspended";
    reasonRequired: boolean;
    notify: (store: StoreRow) => { title: string; body: string };
  }
): Promise<GrowthActionState> {
  const actor = await financeActor();
  const storeId = readId(formData, "storeId");
  if (!storeId) return { error: "Missing shop." };
  const reasonResult = readReason(formData, opts.reasonRequired);
  if ("error" in reasonResult) return { error: reasonResult.error };
  const { reason } = reasonResult;

  const store = await loadStore(storeId);
  if (!store) return { error: "Shop not found." };
  if (store.status === opts.to) {
    revalidatePath(PAGE);
    return { success: true }; // already done — a double submit, not an error
  }
  if (!opts.from.includes(store.status)) return { error: `This shop is ${store.status} — refresh and try again.` };

  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = { status: opts.to, updated_at: nowIso };
  // approved_at records when PinPals first approved the shop; a reinstate
  // keeps the original date unless it was somehow never set.
  if (opts.action === "store.approve" || (opts.action === "store.reinstate" && !store.approved_at)) {
    patch.approved_at = nowIso;
  }

  const admin = createAdminClient();
  const { data: updated, error } = await admin
    .from("stores")
    .update(patch)
    .eq("id", storeId)
    .eq("status", store.status)
    .select("id")
    .maybeSingle();

  if (error) {
    await audit(actor, opts.action, "store", storeId, {
      reason,
      outcome: "failure",
      metadata: { error: error.message },
    });
    return { error: "Couldn't update the shop — try again." };
  }
  if (!updated) {
    revalidatePath(PAGE);
    return { error: "The shop changed while you were looking at it — refresh and try again." };
  }

  await audit(actor, opts.action, "store", storeId, {
    reason,
    metadata: { previousStatus: store.status, newStatus: opts.to, storeName: store.name },
  });

  const message = opts.notify(store);
  await notifyUser(admin, {
    userId: store.owner_id,
    type: "seller_action_required",
    title: message.title,
    body: message.body,
    href: "/dashboard/shop",
    data: { storeId },
    dedupeKey: `store:${storeId}:${opts.to}:${nowIso}`,
  });

  revalidatePath(PAGE);
  return { success: true };
}

export async function approveStore(_prev: GrowthActionState, formData: FormData): Promise<GrowthActionState> {
  return changeStoreStatus(formData, {
    action: "store.approve",
    from: ["pending"],
    to: "active",
    reasonRequired: false,
    notify: (s) => ({
      title: "Your pro shop is live",
      body: `${s.name} has been approved on PinPals. You can now list new stock in New Gear.`,
    }),
  });
}

/**
 * Suspends a pending or active shop. Existing shop listings are deliberately
 * left as they are (no bulk status change) — the listings_check_store
 * trigger (0115) already stops the owner adding new ones to a non-active
 * shop, and a reinstate should bring the shop back exactly as it was. Any
 * listing that needs to come down is removed individually from
 * /admin/listings, with its own audit row.
 */
export async function suspendStore(_prev: GrowthActionState, formData: FormData): Promise<GrowthActionState> {
  return changeStoreStatus(formData, {
    action: "store.suspend",
    from: ["pending", "active"],
    to: "suspended",
    reasonRequired: true,
    notify: (s) => ({
      title: "Your pro shop has been suspended",
      body: `${s.name} can't add new stock on PinPals for now. Contact PinPals support to find out more.`,
    }),
  });
}

export async function reinstateStore(_prev: GrowthActionState, formData: FormData): Promise<GrowthActionState> {
  return changeStoreStatus(formData, {
    action: "store.reinstate",
    from: ["suspended"],
    to: "active",
    reasonRequired: false,
    notify: (s) => ({
      title: "Your pro shop is live again",
      body: `${s.name} has been reinstated on PinPals. You can list new stock in New Gear again.`,
    }),
  });
}

export async function setStoreCommission(_prev: GrowthActionState, formData: FormData): Promise<GrowthActionState> {
  const actor = await financeActor();
  const storeId = readId(formData, "storeId");
  if (!storeId) return { error: "Missing shop." };
  const rate = parseCommissionPercent(formData.get("commissionPercent"));
  if (rate == null) return { error: "Commission must be a percentage from 0 to 50 (e.g. 8 or 8.5)." };
  const reasonResult = readReason(formData, false);
  if ("error" in reasonResult) return { error: reasonResult.error };

  const store = await loadStore(storeId);
  if (!store) return { error: "Shop not found." };
  const previousRate = toAmount(store.commission_rate);
  if (Math.round(previousRate * 1000) === Math.round(rate * 1000)) return { success: true };

  const admin = createAdminClient();
  const { error } = await admin
    .from("stores")
    .update({ commission_rate: rate, updated_at: new Date().toISOString() })
    .eq("id", storeId);

  if (error) {
    await audit(actor, "store.commission_changed", "store", storeId, {
      reason: reasonResult.reason,
      outcome: "failure",
      metadata: { error: error.message, previousRate, newRate: rate },
    });
    return { error: "Couldn't change the commission — try again." };
  }

  await audit(actor, "store.commission_changed", "store", storeId, {
    reason: reasonResult.reason,
    metadata: {
      previousRate,
      newRate: rate,
      previous: formatCommissionRate(previousRate),
      new: formatCommissionRate(rate),
      storeName: store.name,
    },
  });

  revalidatePath(PAGE);
  return { success: true };
}

// ---------------------------------------------------------------------------
// Promotions
// ---------------------------------------------------------------------------

/**
 * Cancels an active bump/featured placement. Clears the listing's
 * featured_until for a featured promotion so the gold badge and first place
 * go immediately; a bump's bumped_at is left alone (it's only a sort key,
 * and resetting it could push the listing below where it was before the
 * bump). Refunds are made in Stripe's dashboard — this only records the
 * decision, with a required reason.
 */
export async function cancelPromotion(_prev: GrowthActionState, formData: FormData): Promise<GrowthActionState> {
  const actor = await financeActor();
  const promotionId = readId(formData, "promotionId");
  if (!promotionId) return { error: "Missing promotion." };
  const reasonResult = readReason(formData, true);
  if ("error" in reasonResult) return { error: reasonResult.error };
  const { reason } = reasonResult;

  const admin = createAdminClient();
  const { data: promo } = await admin
    .from("listing_promotions")
    .select("id, listing_id, kind, status, amount_eur, ends_at")
    .eq("id", promotionId)
    .maybeSingle<{ id: number; listing_id: number; kind: string; status: string; amount_eur: number; ends_at: string | null }>();
  if (!promo) return { error: "Promotion not found." };
  if (promo.status === "cancelled") {
    revalidatePath(PAGE);
    return { success: true };
  }
  if (promo.status !== "active") return { error: `Only an active promotion can be cancelled (this one is ${promo.status}).` };

  const { data: updated, error } = await admin
    .from("listing_promotions")
    .update({ status: "cancelled" })
    .eq("id", promotionId)
    .eq("status", "active")
    .select("id")
    .maybeSingle();

  if (error) {
    await audit(actor, "promotion.cancelled", "listing_promotion", promotionId, {
      reason,
      outcome: "failure",
      metadata: { error: error.message },
    });
    return { error: "Couldn't cancel the promotion — try again." };
  }
  if (!updated) {
    revalidatePath(PAGE);
    return { error: "The promotion changed while you were looking at it — refresh and try again." };
  }

  let featuredCleared = false;
  if (promo.kind === "featured") {
    const { error: listingError } = await admin
      .from("listings")
      .update({ featured_until: null })
      .eq("id", promo.listing_id);
    featuredCleared = !listingError;
  }

  await audit(actor, "promotion.cancelled", "listing_promotion", promotionId, {
    reason,
    metadata: {
      previousStatus: promo.status,
      newStatus: "cancelled",
      kind: promo.kind,
      listingId: promo.listing_id,
      amountEur: toAmount(promo.amount_eur),
      endsAt: promo.ends_at,
      featuredCleared,
      refund: "not issued here — refund in the Stripe dashboard if owed",
    },
  });

  revalidatePath(PAGE);
  return featuredCleared || promo.kind !== "featured"
    ? { success: true }
    : { error: "Cancelled, but the listing's Featured badge couldn't be cleared — try again or clear it by hand." };
}

// ---------------------------------------------------------------------------
// Retail & ads — affiliate products
// ---------------------------------------------------------------------------

export async function saveAffiliateProduct(_prev: GrowthActionState, formData: FormData): Promise<GrowthActionState> {
  const actor = await financeActor();
  const parsed = parseAffiliateProductForm(formData);
  if (!parsed.ok) return { error: parsed.error };
  const input = parsed.value;
  const productId = readId(formData, "productId");
  const admin = createAdminClient();

  if (!productId) {
    const { data, error } = await admin.from("affiliate_products").insert(input).select("id").single<{ id: number }>();
    if (error || !data) return { error: "Couldn't add the product — check the fields and try again." };
    await audit(actor, "affiliate.created", "affiliate_product", data.id, {
      metadata: { title: input.title, retailer: input.retailer, active: input.active },
    });
    revalidatePath(PAGE);
    return { success: true };
  }

  const { data: before } = await admin
    .from("affiliate_products")
    .select("title, brand, category, price_eur, was_price_eur, image_url, retailer, url, sort_order, active")
    .eq("id", productId)
    .maybeSingle<Record<string, unknown>>();
  if (!before) return { error: "Product not found." };

  const changed = changedFields(before, input);
  if (changed.length === 0) return { success: true };

  const { error } = await admin
    .from("affiliate_products")
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq("id", productId);
  if (error) {
    await audit(actor, "affiliate.updated", "affiliate_product", productId, {
      outcome: "failure",
      metadata: { error: error.message, changed },
    });
    return { error: "Couldn't save the product — try again." };
  }

  await audit(actor, "affiliate.updated", "affiliate_product", productId, { metadata: { changed } });
  revalidatePath(PAGE);
  return { success: true };
}

export async function toggleAffiliateProduct(_prev: GrowthActionState, formData: FormData): Promise<GrowthActionState> {
  return toggleActive(formData, "productId", "affiliate_products", "affiliate.updated", "affiliate_product");
}

// ---------------------------------------------------------------------------
// Retail & ads — sponsored banners
// ---------------------------------------------------------------------------

export async function saveBanner(_prev: GrowthActionState, formData: FormData): Promise<GrowthActionState> {
  const actor = await financeActor();
  const parsed = parseBannerForm(formData);
  if (!parsed.ok) return { error: parsed.error };
  const input = parsed.value;
  const bannerId = readId(formData, "bannerId");
  const admin = createAdminClient();

  if (!bannerId) {
    const { data, error } = await admin.from("marketplace_banners").insert(input).select("id").single<{ id: number }>();
    if (error || !data) return { error: "Couldn't add the banner — check the fields and try again." };
    await audit(actor, "banner.created", "marketplace_banner", data.id, {
      metadata: { title: input.title, sponsor: input.sponsor, placement: input.placement, feeEur: input.fee_eur },
    });
    revalidatePath(PAGE);
    return { success: true };
  }

  const { data: before } = await admin
    .from("marketplace_banners")
    .select("eyebrow, title, subtitle, image_url, link_url, sponsor, placement, starts_at, ends_at, fee_eur, active")
    .eq("id", bannerId)
    .maybeSingle<Record<string, unknown>>();
  if (!before) return { error: "Banner not found." };

  const changed = changedFields(before, input);
  if (changed.length === 0) return { success: true };

  const { error } = await admin.from("marketplace_banners").update(input).eq("id", bannerId);
  if (error) {
    await audit(actor, "banner.updated", "marketplace_banner", bannerId, {
      outcome: "failure",
      metadata: { error: error.message, changed },
    });
    return { error: "Couldn't save the banner — try again." };
  }

  await audit(actor, "banner.updated", "marketplace_banner", bannerId, {
    metadata: {
      changed,
      // The fee is revenue — keep its before/after, not just that it moved.
      ...(changed.includes("fee_eur") ? { previousFeeEur: before.fee_eur ?? null, newFeeEur: input.fee_eur } : {}),
    },
  });
  revalidatePath(PAGE);
  return { success: true };
}

export async function toggleBanner(_prev: GrowthActionState, formData: FormData): Promise<GrowthActionState> {
  return toggleActive(formData, "bannerId", "marketplace_banners", "banner.updated", "marketplace_banner");
}

async function toggleActive(
  formData: FormData,
  idField: string,
  table: "affiliate_products" | "marketplace_banners",
  action: "affiliate.updated" | "banner.updated",
  targetType: "affiliate_product" | "marketplace_banner"
): Promise<GrowthActionState> {
  const actor = await financeActor();
  const id = readId(formData, idField);
  if (!id) return { error: "Missing id." };

  const admin = createAdminClient();
  const { data: row } = await admin.from(table).select("id, active").eq("id", id).maybeSingle<{ id: number; active: boolean }>();
  if (!row) return { error: "Not found." };

  const next = !row.active;
  const patch: Record<string, unknown> = { active: next };
  if (table === "affiliate_products") patch.updated_at = new Date().toISOString();

  const { error } = await admin.from(table).update(patch).eq("id", id).eq("active", row.active);
  if (error) {
    await audit(actor, action, targetType, id, { outcome: "failure", metadata: { error: error.message, changed: ["active"] } });
    return { error: "Couldn't update — try again." };
  }

  await audit(actor, action, targetType, id, { metadata: { changed: ["active"], previousActive: row.active, active: next } });
  revalidatePath(PAGE);
  return { success: true };
}
