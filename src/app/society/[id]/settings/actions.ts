"use server";

import { redirect } from "next/navigation";

import { MAX_AVATAR_BYTES } from "@/lib/avatar";
import { ImageProcessingError, processAvatarImage, processMessageImage } from "@/lib/images/upload";
import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";
import type { ActionState } from "@/lib/society-console/action-state";
import { ALERT_PREFS, GROUP_ABOUT_MAX, GROUP_NAME_MAX } from "@/lib/society-console/people-rules";
import { check, consoleAction } from "@/lib/society-console/server-action";
import { checked, positiveInt, text } from "@/lib/society-console/rules";

/**
 * Settings: update_group (0122's signature — a society's members never
 * invite, so members_can_invite goes false and the database forces it
 * anyway), the cover photo and logo (the same steps as
 * /api/app/groups/[id]/image: re-encoded by sharp with no EXIF, uploaded to
 * the member's own folder with their own client, then set_group_image
 * decides), your own mute and alert switches, and delete_group.
 */

export async function saveSettings(_prev: ActionState, form: FormData): Promise<ActionState> {
  return consoleAction(form.get("g"), { run: true, alerts: false }, async (ctx) => {
    const name = (text(form, "name", 200) ?? "").replace(/\s+/g, " ");
    if (!name) throw new Error("Give the society a name.");
    if (name.length > GROUP_NAME_MAX) throw new Error(`That name is too long — ${GROUP_NAME_MAX} characters at most.`);
    if (/^pinpals\b/i.test(name)) throw new Error("Group names can't start with PinPals.");
    const about = text(form, "about", GROUP_ABOUT_MAX + 100);
    if (about && about.length > GROUP_ABOUT_MAX) throw new Error(`The description is too long — ${GROUP_ABOUT_MAX} characters at most.`);

    // The picker sends an id only for a club actually chosen; blank clears it.
    const rawClub = form.get("club");
    let clubId: number | null = null;
    if (typeof rawClub === "string" && rawClub.trim() !== "") {
      clubId = positiveInt(rawClub);
      if (!clubId) throw new Error("Choose the home club from the list.");
      const { data: club } = await ctx.supabase.from("clubs").select("id").eq("id", clubId).maybeSingle();
      if (!club) throw new Error("That club wasn't found.");
    }

    const { error } = await ctx.supabase.rpc("update_group", {
      p_group_id: ctx.society.id,
      p_name: name,
      p_about: about,
      p_members_can_invite: false,
      p_club_id: clubId,
      p_starts_on: null,
      p_ends_on: null,
    });
    check(error, "Couldn't save the changes.");
    return "Saved.";
  });
}

const SAVE_MAX = 20;
const SAVE_WINDOW_SECONDS = 3600;

export async function saveImage(_prev: ActionState, form: FormData): Promise<ActionState> {
  return consoleAction(form.get("g"), { run: true, alerts: false }, async (ctx) => {
    const which = form.get("which");
    if (which !== "cover" && which !== "logo") throw new Error("Choose the cover or the logo.");
    // 0144's group_can_style, asked first so a refusal leaves no file behind.
    if (!(ctx.role === "owner" || ctx.office === "captain" || ctx.office === "secretary")) {
      throw new Error("Only the society's captain or secretary can change its photo and logo.");
    }

    let url: string | null = null;
    if (form.get("remove") !== "1") {
      const image = form.get("image");
      if (!(image instanceof File) || image.size === 0) throw new Error("Choose a photo, or remove the current one.");

      // One budget with the app's route: the same action key, per member.
      const limit = await checkRateLimit({ action: "app-group-image", identifier: ctx.user.id, maxHits: SAVE_MAX, windowSeconds: SAVE_WINDOW_SECONDS });
      if (!limit.allowed) throw new Error(rateLimitMessage(limit.retryAfterSeconds));

      try {
        const { buffer, contentType, extension } = which === "logo" ? await processAvatarImage(image) : await processMessageImage(image);
        if (buffer.length > MAX_AVATAR_BYTES) throw new ImageProcessingError("That photo is too large even after resizing — try another.");
        const path = `${ctx.user.id}/group-${ctx.society.id}-${which}-${Date.now()}.${extension}`;
        const { error } = await ctx.supabase.storage.from("member-avatars").upload(path, buffer, { contentType, upsert: false });
        if (error) throw new ImageProcessingError(`Couldn't upload that photo: ${error.message}`);
        url = ctx.supabase.storage.from("member-avatars").getPublicUrl(path).data.publicUrl;
      } catch (err) {
        throw new Error(err instanceof ImageProcessingError ? err.message : "Couldn't upload that photo — please try a different one.");
      }
    }

    const { error } = await ctx.supabase.rpc("set_group_image", { p_group_id: ctx.society.id, p_which: which, p_url: url });
    check(error, "Couldn't save that. Please try again.");
    const noun = which === "cover" ? "Cover photo" : "Logo";
    return url ? `${noun} updated.` : `${noun} removed.`;
  });
}

export async function saveMyAlerts(_prev: ActionState, form: FormData): Promise<ActionState> {
  return consoleAction(form.get("g"), { alerts: false }, async (ctx) => {
    const g = ctx.society.id;
    const muted = await ctx.supabase.rpc("set_group_muted", { p_group_id: g, p_muted: checked(form, "muted") });
    check(muted.error, "Couldn't change that setting.");
    for (const p of ALERT_PREFS) {
      const { error } = await ctx.supabase.rpc("set_society_alert_pref", { p_group_id: g, p_kind: p.kind, p_enabled: checked(form, `pref_${p.kind}`) });
      check(error, "Couldn't change that.");
    }
    return "Your alerts are saved.";
  });
}

export async function deleteSociety(_prev: ActionState, form: FormData): Promise<ActionState> {
  const result = await consoleAction(form.get("g"), { run: true, alerts: false }, async (ctx) => {
    if (ctx.role !== "owner") throw new Error("Only the society's owner can delete it.");
    const typed = (text(form, "confirm", 200) ?? "").replace(/\s+/g, " ");
    if (typed.toLowerCase() !== ctx.society.name.trim().toLowerCase()) throw new Error("Type the society's name exactly to confirm.");
    const { error } = await ctx.supabase.rpc("delete_group", { p_group_id: ctx.society.id });
    check(error, "Couldn't delete the society.");
    return "Deleted.";
  });
  if (result.ok) redirect("/society");
  return result;
}
