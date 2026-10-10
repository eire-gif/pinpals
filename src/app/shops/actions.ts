"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export type ShopFormState = { error?: string; success?: boolean };

const text = (formData: FormData, key: string, max: number): string | null => {
  const v = String(formData.get(key) ?? "").trim();
  return v ? v.slice(0, max) : null;
};

/**
 * Apply for a pro shop (0115). store_apply() does the checks (one shop per
 * member, a unique name) and leaves it pending; PinPals approves it from
 * /admin/marketplace?tab=shops.
 */
export async function applyForShop(_prev: ShopFormState, formData: FormData): Promise<ShopFormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/shops/apply");

  const limit = await checkRateLimit({ action: "shop_apply", identifier: user.id, maxHits: 5, windowSeconds: 60 * 60 });
  if (!limit.allowed) return { error: rateLimitMessage(limit.retryAfterSeconds) };

  const name = text(formData, "name", 80);
  if (!name || name.length < 2) return { error: "Give the shop a name." };
  const clubId = Number(formData.get("club"));
  if (!Number.isInteger(clubId) || clubId <= 0) return { error: "Choose the club the shop is at." };
  if (formData.get("agree") !== "on") return { error: "Please agree to the pro shop terms." };

  const { error } = await supabase.rpc("store_apply", {
    p_name: name,
    p_club_id: clubId,
    p_description: text(formData, "description", 1000),
    p_phone: text(formData, "phone", 40),
    p_email: text(formData, "email", 200),
    p_fittings: formData.get("fittings") === "on",
  });
  // store_apply() raises plain-English messages ("You already have a shop
  // on PinPals", "A shop with that name exists") meant for the member.
  if (error) return { error: error.code === "P0001" || error.code === "22023" ? error.message : "Couldn't send that — please try again." };

  revalidatePath("/dashboard/shop");
  redirect("/dashboard/shop?applied=1");
}

/** The owner keeps their shop's details up to date (store_update(), owner only). */
export async function updateShop(_prev: ShopFormState, formData: FormData): Promise<ShopFormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const storeId = Number(formData.get("storeId"));
  if (!Number.isInteger(storeId)) return { error: "Missing shop." };
  const url = (key: string) => {
    const v = text(formData, key, 500);
    return v && v.startsWith("https://") ? v : null;
  };

  const { error } = await supabase.rpc("store_update", {
    p_store_id: storeId,
    p_description: text(formData, "description", 1000),
    p_phone: text(formData, "phone", 40),
    p_email: text(formData, "email", 200),
    p_fittings: formData.get("fittings") === "on",
    p_logo_url: url("logoUrl"),
    p_cover_url: url("coverUrl"),
  });
  if (error) return { error: "Couldn't save that — please try again." };
  revalidatePath("/dashboard/shop");
  return { success: true };
}
