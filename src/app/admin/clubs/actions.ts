"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/admin/authorization";
import { recordAdminAction } from "@/lib/admin/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { SUPABASE_URL } from "@/lib/supabase/config";
import { isCountryCode, isRegionInCountry, countryName } from "@/lib/regions";
import { EDIT_ROLES } from "@/lib/admin/controls";
import { slugify } from "@/lib/news/validate";

export type ClubEditState = { error?: string; saved?: boolean };
export type ImportState = { error?: string; started?: string };

/**
 * Staff edit of one course.
 *
 * ============ Why this screen exists ============
 *
 * The directory is imported from OpenStreetMap, and OSM's coverage of golf
 * clubs is uneven: a name and a position for effectively all of them, a
 * website for well under half, a county for almost none. This is the tool
 * that closes that gap one course at a time — and, by setting `verified_at`,
 * tells the importer to stop overwriting what a human has established.
 *
 * The write goes through the service-role client rather than the staff
 * member's own session. `clubs` does have a staff UPDATE policy (0061), so
 * the ordinary client would work — but every admin mutation in this app is
 * routed this way so that the audit-log write and the data write are made by
 * the same caller, and so that a policy change can never silently turn an
 * admin tool into a no-op.
 */
type ClubFields = {
  name: string;
  country: string;
  region: string;
  town: string;
  website: string | null;
  holes: number | null;
  latitude: number | null;
  longitude: number | null;
  verified: boolean;
};

/** The course form's fields, validated. Shared by edit and create. */
function readClubFields(formData: FormData): { ok: true; fields: ClubFields } | { ok: false; error: string } {
  const country = String(formData.get("country") ?? "").trim();
  if (!isCountryCode(country)) return { ok: false, error: "Pick a country." };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "A course needs a name." };

  const region = String(formData.get("region") ?? "").trim();
  if (region && !isRegionInCountry(country, region)) {
    return { ok: false, error: `That county isn't in ${countryName(country)}.` };
  }

  const town = String(formData.get("town") ?? "").trim();
  const websiteRaw = String(formData.get("website") ?? "").trim();
  const holesRaw = String(formData.get("holes") ?? "").trim();
  const latitudeRaw = String(formData.get("latitude") ?? "").trim();
  const longitudeRaw = String(formData.get("longitude") ?? "").trim();
  const verified = formData.get("verified") === "on";

  // Normalised the same way the importer normalises it, so a staff member
  // typing "lahinchgolf.com" produces the same stored value an import would.
  let website: string | null = null;
  if (websiteRaw) {
    try {
      const url = new URL(/^https?:\/\//i.test(websiteRaw) ? websiteRaw : `https://${websiteRaw}`);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("scheme");
      if (!url.hostname.includes(".")) throw new Error("host");
      website = url.toString();
    } catch {
      return { ok: false, error: "That website address doesn't look right." };
    }
  }

  const holes = holesRaw ? Number.parseInt(holesRaw, 10) : null;
  if (holes !== null && (!Number.isFinite(holes) || holes < 1 || holes > 200)) {
    return { ok: false, error: "Holes should be a number between 1 and 200." };
  }

  // Both or neither. Half a coordinate pair is not a location, and the map
  // link would silently fall back to a name search while the row looked as
  // though it had a position.
  const latitude = latitudeRaw ? Number(latitudeRaw) : null;
  const longitude = longitudeRaw ? Number(longitudeRaw) : null;
  if ((latitude === null) !== (longitude === null)) {
    return { ok: false, error: "Enter both latitude and longitude, or neither." };
  }
  if (latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) {
    return { ok: false, error: "Latitude should be between -90 and 90." };
  }
  if (longitude !== null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)) {
    return { ok: false, error: "Longitude should be between -180 and 180." };
  }

  return { ok: true, fields: { name, country, region, town, website, holes, latitude, longitude, verified } };
}

export async function updateClub(_prev: ClubEditState, formData: FormData): Promise<ClubEditState> {
  // Admin and super admin (EDIT_ROLES): courses are reference data, and the
  // role model (admin-architecture-review.md §6) gives managing them to admin.
  const { user, staff } = await requireStaff({ roles: EDIT_ROLES });

  const id = Number.parseInt(String(formData.get("id") ?? ""), 10);
  if (!Number.isFinite(id)) return { error: "Missing club id." };

  const read = readClubFields(formData);
  if (!read.ok) return { error: read.error };
  const { name, country, region, town, website, holes, latitude, longitude, verified } = read.fields;

  const admin = createAdminClient();

  const { data: before } = await admin
    .from("clubs")
    .select("slug, country, region, website, verified_at")
    .eq("id", id)
    .maybeSingle<{ slug: string; country: string; region: string | null; website: string | null; verified_at: string | null }>();

  if (!before) return { error: "That course no longer exists." };

  const { error } = await admin
    .from("clubs")
    .update({
      name,
      country,
      region: region || null,
      town: town || null,
      website,
      holes,
      latitude,
      longitude,
      // Once a human has touched a row it stops being an import's to
      // rewrite. Ticking "verified" is what says so; leaving it unticked
      // saves the edit but lets the next import overwrite it again, which is
      // occasionally what you want (fixing a typo you'd rather OSM fixed
      // properly upstream).
      verified_at: verified ? new Date().toISOString() : null,
    })
    .eq("id", id);

  if (error) return { error: error.message };

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: verified && !before.verified_at ? "club.verified" : "club.updated",
    targetType: "club",
    targetId: id,
    metadata: {
      countryFrom: before.country,
      countryTo: country,
      regionFrom: before.region,
      regionTo: region || null,
      websiteChanged: before.website !== website,
      verified,
    },
  });

  revalidatePath("/admin/clubs");
  revalidatePath(`/admin/clubs/${id}`);
  revalidatePath(`/courses/${country}/${before.slug}`);
  revalidatePath(`/courses/${country}`);

  return { saved: true };
}

export type ClubCreateState = { error?: string; createdId?: number };

/**
 * Add a course by hand — one OpenStreetMap doesn't have, or a new club.
 * `source = 'manual'` keeps it out of the importer's way (the importer
 * matches on osm_id, which a manual row doesn't have). The slug is made from
 * the name and made unique with the town, then a number.
 */
export async function createClub(_prev: ClubCreateState, formData: FormData): Promise<ClubCreateState> {
  const { user, staff } = await requireStaff({ roles: EDIT_ROLES });

  const read = readClubFields(formData);
  if (!read.ok) return { error: read.error };
  const f = read.fields;

  const admin = createAdminClient();
  const base = slugify(f.name) || "course";
  const candidates = [base, f.town ? slugify(`${f.name} ${f.town}`) : null, ...[2, 3, 4, 5].map((n) => `${base}-${n}`)].filter(
    (s): s is string => !!s
  );
  const { data: taken } = await admin.from("clubs").select("slug").in("slug", candidates);
  const used = new Set((taken ?? []).map((r: { slug: string }) => r.slug));
  const slug = candidates.find((s) => !used.has(s));
  if (!slug) return { error: "A course with that name already exists — open it from the list instead." };

  const { data: created, error } = await admin
    .from("clubs")
    .insert({
      name: f.name,
      slug,
      country: f.country,
      region: f.region || null,
      town: f.town || null,
      website: f.website,
      holes: f.holes,
      latitude: f.latitude,
      longitude: f.longitude,
      source: "manual",
      verified_at: f.verified ? new Date().toISOString() : null,
    })
    .select("id")
    .single<{ id: number }>();

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "club.created",
    targetType: "club",
    targetId: created?.id ?? null,
    outcome: error ? "failure" : "success",
    metadata: error ? { error: error.message, name: f.name } : { name: f.name, country: f.country, slug },
  });

  if (error || !created) return { error: error?.message ?? "Couldn't add the course." };

  revalidatePath("/admin/clubs");
  revalidatePath(`/courses/${f.country}`);
  return { createdId: created.id };
}

/**
 * Start an OpenStreetMap import for one country.
 *
 * ============ Why this doesn't wait for the result ============
 *
 * The import is a large Overpass query followed by up to ~1,900 row writes,
 * and it routinely runs for two to three minutes. That is far longer than a
 * Vercel function is allowed to stay open on this project's plan, so waiting
 * for the answer would guarantee a timeout on a job that was actually
 * succeeding — the worst possible failure mode, because it teaches staff that
 * the button is broken while it quietly works.
 *
 * So the request is fired with a short abort, and an abort is reported as
 * success: the Edge Function has already received the request and carries on
 * independently of whether anyone is still listening. Only a real error — a
 * rejected auth, a function that isn't deployed — comes back as one. The
 * page then shows per-country counts and a last-updated time, which is how a
 * staff member actually confirms the run landed.
 */
export async function runCourseImport(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const { user, staff } = await requireStaff({ roles: ["admin", "super_admin"] });

  const country = String(formData.get("country") ?? "").trim();
  if (!isCountryCode(country)) return { error: "Pick a country to refresh." };

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    return { error: "SUPABASE_SERVICE_ROLE_KEY isn't set on this deployment." };
  }

  const endpoint = `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/import-courses`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceRoleKey}`,
        ...(process.env.COURSE_IMPORT_SECRET
          ? { "x-import-secret": process.env.COURSE_IMPORT_SECRET }
          : {}),
      },
      body: JSON.stringify({ country }),
      signal: AbortSignal.timeout(8000),
    });

    // A response this fast is either a refusal or an empty country; either
    // way it's worth showing rather than swallowing.
    if (!response.ok) {
      const detail = await response.text();
      return { error: `The importer refused that: ${detail.slice(0, 300)}` };
    }
  } catch (cause) {
    const aborted = cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError");
    if (!aborted) {
      return { error: cause instanceof Error ? cause.message : "Couldn't reach the importer." };
    }
  }

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "club.import_run",
    targetType: "club",
    metadata: { country },
  });

  revalidatePath("/admin/clubs");

  return { started: countryName(country) };
}
