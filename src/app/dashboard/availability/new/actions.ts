"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { notifyConnectionsOfInvite } from "@/lib/tee-times-server";
import { getClubById } from "@/lib/courses";
import { isCountryCode, isRegionInCountry, countryName } from "@/lib/regions";
import { DEFAULT_VISIBILITY, SPACES_OPTIONS, computeExpiry, isInviteVisibility } from "@/lib/tee-times";

export type PostAvailabilityState = { error?: string };

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Posting availability was never rate-limited: it writes one row a member
// can delete, and the form is tedious enough to be its own limit. It is now,
// because each post also emails every one of the host's connections. Ten an
// hour is far more rounds than anyone plays and still caps what a scripted
// loop could push into other people's inboxes.
const POST_AVAILABILITY_MAX_ATTEMPTS = 10;
const POST_AVAILABILITY_WINDOW_SECONDS = 60 * 60;

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

  const rateLimit = await checkRateLimit({
    action: "post-availability",
    identifier: user.id,
    maxHits: POST_AVAILABILITY_MAX_ATTEMPTS,
    windowSeconds: POST_AVAILABILITY_WINDOW_SECONDS,
  });
  if (!rateLimit.allowed) {
    return { error: rateLimitMessage(rateLimit.retryAfterSeconds) };
  }

  const clubIdRaw = String(formData.get("club") || "").trim();
  const country = String(formData.get("country") || "").trim();
  const county = String(formData.get("county") || "").trim();
  const playDate = String(formData.get("playDate") || "").trim();
  const timeFrom = String(formData.get("timeFrom") || "").trim();
  const timeTo = String(formData.get("timeTo") || "").trim();
  const spacesRaw = String(formData.get("spaces") || "").trim();
  const hasTeeTime = formData.get("hasTeeTime") === "on";
  const exactTeeTime = String(formData.get("exactTeeTime") || "").trim();
  const handicapRaw = String(formData.get("handicapLimit") || "").trim();
  const notes = String(formData.get("notes") || "").trim();
  const visibilityRaw = String(formData.get("visibility") || "").trim();
  // An unticked checkbox posts nothing at all, so absent means false — the
  // same reading hasTeeTime above already relies on, and the safe one: the
  // failure mode is an invite open to everyone, never one wrongly marked.
  const ladiesOnly = formData.get("ladiesOnly") === "on";

  if (!isCountryCode(country)) {
    return { error: "Please choose the country the course is in." };
  }

  // Same shape as the profile form: the id is what's submitted and the name
  // and country are re-read from the club row rather than trusted. An empty
  // id means the member typed something the picker never matched, which is
  // the case to refuse — an invite at a club that isn't in the directory
  // can't be found by anyone browsing that club's page.
  const clubId = clubIdRaw ? Number.parseInt(clubIdRaw, 10) : NaN;
  if (!Number.isFinite(clubId)) {
    return { error: "Please choose a golf club from the suggested list." };
  }

  const club = await getClubById(clubId);
  if (!club) {
    return { error: "Please choose a golf club from the suggested list." };
  }
  if (club.country !== country) {
    return { error: `${club.name} isn't in ${countryName(country)} — check the country above.` };
  }

  if (!county || !isRegionInCountry(country, county)) {
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

  // Falls back to the default rather than erroring on an empty value: the
  // radio group always posts one of the two, so an absent value means an
  // older cached copy of the form, and silently posting to everyone — the
  // behaviour before this field existed — is the honest reading of that.
  // A *present but unrecognised* value is different, and is rejected: it can
  // only come from a hand-built request, and guessing an audience for
  // someone is the one thing this field must never do.
  const visibility = visibilityRaw ? visibilityRaw : DEFAULT_VISIBILITY;
  if (!isInviteVisibility(visibility)) {
    return { error: "Please choose who can see this tee time." };
  }

  const { data: invite, error } = await supabase
    .from("tee_time_invites")
    .insert({
    member_id: user.id,
    club_id: club.id,
    club_name: club.name,
    country,
    county,
    play_date: playDate,
    time_from: timeFrom || null,
    time_to: timeTo || null,
    exact_tee_time: exactTeeTime || null,
    spaces_available: spaces,
    has_tee_time_booked: hasTeeTime,
    handicap_limit: handicapLimit,
    notes: notes || null,
    visibility,
    ladies_only: ladiesOnly,
    expires_at: computeExpiry(playDate),
    })
    // The id is needed for the notification dedupe key. Reading it back is
    // the RLS pattern that broke listing creation once (see migration 0052)
    // — safe here because the invite read policy tests this row's own column
    // values rather than re-querying the table.
    .select("id")
    .single<{ id: number }>();

  if (error) {
    return { error: error.message };
  }

  // Tell the host's connections. Deliberately after the response rather than
  // before the redirect: this can be dozens of auth lookups and provider
  // calls, and the member who just filled in a form should not sit watching
  // a spinner while other people's email is dispatched. Their tee time is
  // already saved by this point, so nothing here can cost them the post.
  if (invite) {
    after(async () => {
      try {
        await notifyConnectionsOfInvite(createAdminClient(), {
          inviteId: invite.id,
          hostId: user.id,
          clubName: club.name,
          playDate,
          timeFrom: timeFrom || null,
          timeTo: timeTo || null,
          spaces,
          ladiesOnly,
        });
      } catch (err) {
        console.error("[tee-times] Fan-out failed:", err instanceof Error ? err.message : err);
      }
    });
  }

  redirect("/dashboard?posted=1");
}
