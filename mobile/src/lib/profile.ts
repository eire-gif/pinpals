import { postFormToSite, type UploadFile } from "@/lib/api";
import { supabase } from "@/lib/supabase";

/**
 * Editing your own profile.
 *
 * Reading is a plain RLS query — a member may read their own row, and their
 * own date of birth, and nothing about either is subtle.
 *
 * SAVING GOES THROUGH THE SERVER, and both halves of that matter.
 *
 * The rules are not simple: a home club must exist in the directory and be
 * in the country claimed, a county must belong to that country, a handicap
 * must be a real index, a date of birth must resolve to an age band. All of
 * it lives in the website's applyProfileUpdate(), which /api/app/profile
 * calls — so the app and the site cannot reach different conclusions about
 * the same form.
 *
 * And the photo. `member-avatars` is a PUBLIC bucket. A picture from a
 * phone's camera roll carries EXIF, EXIF carries GPS, and uploading one
 * straight from the device would publish the coordinates of wherever it was
 * taken to anyone who opened the URL. Every photo this app stores is
 * re-encoded by sharp on the server first. That is the same rule listing
 * photos follow, and it is the reason this file never touches Storage.
 */

export type MyProfile = {
  firstName: string;
  lastName: string;
  homeClub: string | null;
  homeClubId: number | null;
  country: string;
  county: string | null;
  handicap: number | null;
  handicapVisible: boolean;
  bio: string | null;
  guiNumber: string | null;
  avatarUrl: string | null;
  dateOfBirth: string | null;
  ageRangeVisible: boolean;
};

type ProfileRow = {
  first_name: string | null;
  last_name: string | null;
  home_club: string | null;
  home_club_id: number | null;
  country: string | null;
  county: string | null;
  handicap: number | null;
  handicap_visible: boolean | null;
  bio: string | null;
  gui_membership_number: string | null;
  avatar_url: string | null;
};

type BirthdateRow = { date_of_birth: string; age_range_visible: boolean };

export async function loadMyProfile(userId: string): Promise<MyProfile | null> {
  const [{ data: profile }, { data: birthdate }] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "first_name, last_name, home_club, home_club_id, country, county, handicap, handicap_visible, bio, gui_membership_number, avatar_url"
      )
      .eq("id", userId)
      .maybeSingle<ProfileRow>(),
    // Its own table, readable only by its owner — see 0059. A member who
    // never filled it in simply has no row, which is not an error.
    supabase
      .from("member_birthdates")
      .select("date_of_birth, age_range_visible")
      .eq("user_id", userId)
      .maybeSingle<BirthdateRow>(),
  ]);

  if (!profile) return null;

  return {
    firstName: profile.first_name ?? "",
    lastName: profile.last_name ?? "",
    homeClub: profile.home_club,
    homeClubId: profile.home_club_id,
    country: profile.country ?? "ireland",
    county: profile.county,
    handicap: profile.handicap,
    handicapVisible: profile.handicap_visible ?? false,
    bio: profile.bio,
    guiNumber: profile.gui_membership_number,
    avatarUrl: profile.avatar_url,
    dateOfBirth: birthdate?.date_of_birth ?? null,
    ageRangeVisible: birthdate?.age_range_visible ?? false,
  };
}

export type ProfileEdits = {
  firstName: string;
  lastName: string;
  homeClubId: number | null;
  country: string;
  county: string;
  handicap: string;
  handicapVisible: boolean;
  bio: string;
  guiNumber: string;
  dateOfBirth: string;
  ageRangeVisible: boolean;
  /** A newly chosen photo, or null to leave the current one alone. */
  photo: UploadFile | null;
  removePhoto: boolean;
};

/**
 * Field names are the website form's, verbatim, because the server hands the
 * body to the same validator either way. Checkboxes are "on" or absent —
 * that is what a browser sends and therefore what the shared parser reads,
 * so sending "false" here would quietly mean true.
 */
export async function saveMyProfile(edits: ProfileEdits): Promise<void> {
  const fields: Record<string, string> = {
    first: edits.firstName.trim(),
    last: edits.lastName.trim(),
    club: edits.homeClubId === null ? "" : String(edits.homeClubId),
    country: edits.country,
    county: edits.county,
    handicap: edits.handicap.trim(),
    bio: edits.bio.trim(),
    guiNumber: edits.guiNumber.trim(),
    dob: edits.dateOfBirth,
  };

  if (edits.handicapVisible) fields.handicapVisible = "on";
  if (edits.ageRangeVisible) fields.ageRangeVisible = "on";
  if (edits.removePhoto && !edits.photo) fields.removeAvatar = "on";

  await postFormToSite<{ ok: true }>(
    "/api/app/profile",
    fields,
    edits.photo ? { field: "avatar", file: edits.photo } : undefined
  );
}

/** Whole years, for the "you must be 18" style checks a member does in their
 *  own head — the app never stores or shows a date, only what they typed. */
export function looksLikeADate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.getTime() < Date.now();
}

/**
 * The photograph across the top of the member's profile (0112). Through the
 * website, which re-encodes it (no EXIF — no GPS) into the public bucket;
 * returns the new URL, or null once removed.
 */
export async function uploadCover(file: UploadFile): Promise<string | null> {
  const res = await postFormToSite<{ ok: true; coverUrl: string | null }>("/api/app/profile/cover", {}, { field: "cover", file });
  return res.coverUrl;
}

export async function removeCover(): Promise<void> {
  await postFormToSite<{ ok: true }>("/api/app/profile/cover", { remove: "on" });
}
