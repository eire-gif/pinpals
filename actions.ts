"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CLUBS, COUNTIES } from "@/lib/clubs";
import { SPACES_OPTIONS, computeExpiry } from "@/lib/tee-times";

export type PostAvailabilityState = { error?: string };

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function postAvailability(
  _prev: PostAvailabilityState,
  formData: FormData
): Promise<PostAvailabilityState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const club = String(formData.get("club") || "").trim();
  const county = String(formData.get("county") || "").trim();
  const playDate = String(formData.get("playDate") || "").trim();
  const timeFrom = String(formData.get("timeFrom") || "").trim();
  const timeTo = String(formData.get("timeTo") || "").trim();
  const spacesRaw = String(formData.get("spaces") || "").trim();
  const hasTeeTime = formData.get("hasTeeTime") === "on";
  const exactTeeTime = String(formData.get("exactTeeTime") || "").trim();
  const handicapRaw = String(formData.get("handicapLimit") || "").trim();
  const notes = String(formData.get("notes") || "").trim();

  if (!club || !CLUBS.includes(club)) {
    return { error: "Please choose a golf club from the suggested list." };
  }

  if (!county || !COUNTIES.includes(county as (typeof COUNTIES)[number])) {
    return { error: "Please select the county the course is in." };
  }

  if (!playDate || Number.isNaN(Date.parse(playDate))) {
    return { error: "Please pick a valid date." };
  }
  const todayStr = new Date().toISOString().slice(0, 10);
  if (playDate < todayStr) {
    return { error: "That date has already passed — pick a date in the future." };
  }

  const spaces = Number(spacesRaw);
  if (!SPACES_OPTIONS.includes(spaces as (typeof SPACES_OPTIONS)[number])) {
    return { error: "Please choose how many spaces are available." };
  }

  if (timeFrom && !TIME_RE.test(timeFrom)) {
    return { error: "That start time doesn't look right." };
  }
  if (timeTo && !TIME_RE.test(timeTo)) {
    return { error: "That end time doesn't look right." };
  }
  if (timeFrom && timeTo && timeFrom >= timeTo) {
    return { error: "The end of your time range needs to be after the start." };
  }
  if (exactTeeTime && !TIME_RE.test(exactTeeTime)) {
    return { error: "That tee time doesn't look right." };
  }

  const handicapLimit = handicapRaw ? Number(handicapRaw) : null;
  if (handicapLimit !== null && (Number.isNaN(handicapLimit) || handicapLimit < 0 || handicapLimit > 54)) {
    return { error: "That handicap limit doesn't look right." };
  }

  const { error } = await supabase.from("tee_time_invites").insert({
    member_id: user.id,
    club_name: club,
    county,
    play_date: playDate,
    time_from: timeFrom || null,
    time_to: timeTo || null,
    exact_tee_time: exactTeeTime || null,
    spaces_available: spaces,
    has_tee_time_booked: hasTeeTime,
    handicap_limit: handicapLimit,
    notes: notes || null,
    expires_at: computeExpiry(playDate),
  });

  if (error) {
    return { error: error.message };
  }

  redirect("/dashboard?posted=1");
}
