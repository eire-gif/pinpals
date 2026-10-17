"use server";

import { revalidatePath } from "next/cache";

import { requireStaff } from "@/lib/admin/authorization";
import { recordAdminAction, type AdminAction } from "@/lib/admin/audit";
import { EDIT_ROLES } from "@/lib/admin/controls";
import { CATEGORIES } from "@/lib/marketplace";
import { createAdminClient } from "@/lib/supabase/admin";
import { forgetLearnedBrands } from "@/lib/learned-brands";
import { normKey } from "@/lib/sell-flow";

/**
 * Admin → Brands & models (0163). The brand logos shown on every brand tile,
 * and the model catalogue the finder and the sell form use. Writes go
 * through the service-role client (marketplace_brands and marketplace_models
 * take no member writes), every one audited.
 */

export type BrandActionState = { error?: string; saved?: string };

const LOGO_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/webp": "webp",
  "image/jpeg": "jpg",
};
/** Matches the brand-logos bucket's file_size_limit (0163). */
const MAX_LOGO_BYTES = 1024 * 1024;

async function editor() {
  const { user, staff } = await requireStaff({ roles: EDIT_ROLES });
  return { id: user.id, role: staff.role };
}

async function audit(actor: { id: string; role: Parameters<typeof recordAdminAction>[0]["actor"]["role"] }, action: AdminAction, targetType: "brand" | "brand_model", targetId: string, metadata: Record<string, unknown>, outcome: "success" | "failure" = "success") {
  await recordAdminAction({ actor, action, targetType, targetId, metadata, outcome });
}

function brandIdFrom(formData: FormData): string | null {
  const id = String(formData.get("brandId") ?? "").trim();
  return /^[a-z0-9][a-z0-9-]{0,60}$/.test(id) ? id : null;
}

function done(path = "/admin/brands") {
  revalidatePath(path);
  revalidatePath("/admin/brands", "layout");
  revalidatePath("/marketplace");
  revalidatePath("/marketplace/brands");
}

export async function uploadBrandLogo(_prev: BrandActionState, formData: FormData): Promise<BrandActionState> {
  const actor = await editor();
  const brandId = brandIdFrom(formData);
  if (!brandId) return { error: "Missing brand." };
  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a logo file." };
  const ext = LOGO_TYPES[file.type];
  if (!ext) return { error: "Use a PNG, SVG, WebP or JPEG." };
  if (file.size > MAX_LOGO_BYTES) return { error: "Logos must be 1 MB or smaller." };

  const admin = createAdminClient();
  const path = `${brandId}/${Date.now()}.${ext}`;
  const { error: uploadError } = await admin.storage
    .from("brand-logos")
    .upload(path, file, { contentType: file.type, upsert: false, cacheControl: "31536000" });
  if (uploadError) {
    await audit(actor, "brand.logo_updated", "brand", brandId, { path, error: uploadError.message }, "failure");
    return { error: "Couldn't upload that file — try again." };
  }
  const url = admin.storage.from("brand-logos").getPublicUrl(path).data.publicUrl;

  const { data: before } = await admin.from("marketplace_brands").select("logo_url").eq("id", brandId).maybeSingle<{ logo_url: string | null }>();
  const { error } = await admin.from("marketplace_brands").update({ logo_url: url }).eq("id", brandId);
  if (error) {
    await audit(actor, "brand.logo_updated", "brand", brandId, { path, error: error.message }, "failure");
    return { error: "Uploaded, but couldn't save it on the brand — try again." };
  }
  await audit(actor, "brand.logo_updated", "brand", brandId, { path, previous: before?.logo_url ?? null });
  done();
  return { saved: "Logo saved." };
}

export async function removeBrandLogo(_prev: BrandActionState, formData: FormData): Promise<BrandActionState> {
  const actor = await editor();
  const brandId = brandIdFrom(formData);
  if (!brandId) return { error: "Missing brand." };
  const admin = createAdminClient();
  const { data: before } = await admin.from("marketplace_brands").select("logo_url").eq("id", brandId).maybeSingle<{ logo_url: string | null }>();
  const { error } = await admin.from("marketplace_brands").update({ logo_url: null }).eq("id", brandId);
  if (error) return { error: "Couldn't remove it — try again." };
  await audit(actor, "brand.logo_removed", "brand", brandId, { previous: before?.logo_url ?? null });
  done();
  return { saved: "Logo removed — the brand's name shows instead." };
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function addBrandModel(_prev: BrandActionState, formData: FormData): Promise<BrandActionState> {
  const actor = await editor();
  const brandId = brandIdFrom(formData);
  if (!brandId) return { error: "Missing brand." };
  const category = String(formData.get("category") ?? "");
  if (!(CATEGORIES as readonly string[]).includes(category)) return { error: "Pick a category." };
  const family = String(formData.get("family") ?? "").trim().replace(/\s+/g, " ");
  if (!family || family.length > 60) return { error: "Give the model a name (60 characters at most)." };
  const yearRaw = String(formData.get("year") ?? "").trim();
  const year = yearRaw ? Number.parseInt(yearRaw, 10) : null;
  if (year !== null && (!Number.isFinite(year) || year < 1950 || year > 2100)) return { error: "That year doesn't look right." };
  const versions = String(formData.get("versions") ?? "")
    .split(/[,\n]/)
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 30)
    .map((v) => v.slice(0, 60));

  const admin = createAdminClient();
  const { count } = await admin.from("marketplace_models").select("id", { count: "exact", head: true }).eq("brand_id", brandId).eq("category", category);
  let id = `${brandId}-${slug(family)}`;
  const { data: clash } = await admin.from("marketplace_models").select("id").eq("id", id).maybeSingle();
  if (clash) id = `${id}-${slug(category)}`;

  const { error } = await admin.from("marketplace_models").insert({ id, brand_id: brandId, category, family, year, versions });
  if (error) {
    return { error: error.code === "23505" ? `${family} is already in ${category}.` : "Couldn't add it — try again." };
  }
  await audit(actor, "brand_model.created", "brand_model", id, { brandId, category, family, year, versions, modelsBefore: count ?? null });
  done();
  return { saved: `${family} added to ${category}.` };
}

export async function setBrandModelActive(_prev: BrandActionState, formData: FormData): Promise<BrandActionState> {
  const actor = await editor();
  const id = String(formData.get("modelId") ?? "").trim();
  if (!/^[a-z0-9][a-z0-9-]{1,120}$/.test(id)) return { error: "Missing model." };
  const active = formData.get("active") === "true";
  const admin = createAdminClient();
  const { error } = await admin.from("marketplace_models").update({ active }).eq("id", id);
  if (error) return { error: "Couldn't change it — try again." };
  await audit(actor, "brand_model.updated", "brand_model", id, { changed: { active: { to: active } } });
  done();
  return { saved: active ? "Shown again." : "Hidden from the finder and the sell form." };
}

/**
 * Learned from members (0164): hide a model or brand the catalogue learned
 * by itself. A hidden model is switched off; a hidden brand stops being
 * offered in any category. Either way it's recorded as dismissed, so it's
 * never learned again. Ads that already use it keep it.
 */
export async function hideLearned(_prev: BrandActionState, formData: FormData): Promise<BrandActionState> {
  const actor = await editor();
  const kind = String(formData.get("kind") ?? "");
  const id = String(formData.get("id") ?? "").trim();
  if ((kind !== "model" && kind !== "brand") || !/^[a-z0-9][a-z0-9-]{0,120}$/.test(id)) return { error: "Missing item." };
  const admin = createAdminClient();

  if (kind === "model") {
    const { data: m } = await admin.from("marketplace_models").select("id, brand_id, category, family").eq("id", id).maybeSingle<{ id: string; brand_id: string; category: string; family: string }>();
    if (!m) return { error: "Not found." };
    const { error } = await admin.from("marketplace_models").update({ active: false }).eq("id", id);
    if (error) return { error: "Couldn't hide it — try again." };
    await admin
      .from("marketplace_catalogue_decisions")
      .upsert({ kind: "model", brand_id: m.brand_id, category: m.category, norm_key: normKey(m.family), decision: "dismissed", target_id: id, decided_by: actor.id });
    await audit(actor, "brand_model.updated", "brand_model", id, { changed: { active: { to: false } }, learned: true });
  } else {
    const { data: b } = await admin.from("marketplace_brands").select("id, label, categories").eq("id", id).eq("learned", true).maybeSingle<{ id: string; label: string; categories: string[] | null }>();
    if (!b) return { error: "Not found." };
    const { error } = await admin.from("marketplace_brands").update({ categories: [] }).eq("id", id);
    if (error) return { error: "Couldn't hide it — try again." };
    for (const category of b.categories ?? []) {
      await admin
        .from("marketplace_catalogue_decisions")
        .upsert({ kind: "brand", brand_id: "", category, norm_key: normKey(b.label), decision: "dismissed", target_id: id, decided_by: actor.id });
    }
    forgetLearnedBrands();
    await audit(actor, "brand.updated", "brand", id, { changed: { categories: { from: b.categories, to: [] } }, learned: true });
  }
  done();
  return { saved: "Hidden — it won't be learned again." };
}
