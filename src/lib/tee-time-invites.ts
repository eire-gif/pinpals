import "server-only";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { notifyConnectionsOfInvite } from "@/lib/tee-times-server";
import { getClubById } from "@/lib/courses";
import { isCountryCode, isRegionInCountry, countryName } from "@/lib/regions";
import {
  DEFAULT_VISIBILITY,
  SPACES_OPTIONS,
  computeExpiry,
  isInviteVisibility,
} from "@/lib/tee-times";

/**
 * Posting a tee time, in one place, called by the website form and by the app.
 *
 * Extracted from src/app/dashboard/availability/new/actions.ts when the app
 * gained the ability to post. Same reasoning as tee-times-operations.ts: a
 * second copy of this validation would drift, and the half that drifts is the
 * half nobody is looking at. More to the point, posting fans out an email to
 * every one of the host's connections — a second implementation that forgot
 * that would post invites nobody hears about, which looks exactly like the
 * feature working.
 */

export type CreateInviteFailure = "invalid" | "rate_limited" | "failed";

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; reason: CreateInviteFailure; message: string };

/**
 * Values as they arrive from either caller. Deliberately loose: the website
 * sends FormData strings, the app sends JSON numbers and booleans, and having
 * one place coerce them is what stops the two ends disagreeing about what
 * "3" means.
 */
export type InviteInput = {
  clubId: unknown;
  country: unknown;
  county: unknown;
  playDate: unknown;
  timeFrom?: unknown;
  timeTo?: unknown;
  exactTeeTime?: unknown;
  spaces: unknown;
  hasTeeTime?: unknown;
  handicapLimit?: unknown;
  notes?: unknown;
  visibility?: unknown;
  ladiesOnly?: unknown;
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Posting availability was never rate-limited: it writes one row a member can
// delete, and the form is tedious enough to be its own limit. It is now,
// because each post also emails every one of the host's connections. Ten an
// hour is far more rounds than anyone plays and still caps what a scripted
// loop could push into other people's inboxes.
const MAX_ATTEMPTS = 10;
const WINDOW_SECONDS = 60 * 60;

const invalid = (message: string): Result<never> => ({
  ok: false,
  reason: "invalid",
  message,
});

const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

/** Absent, empty and null all mean "not given"; anything else must parse. */
function optionalNumber(value: unknown): number | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isNaN(n) ? undefined : n;
}

export async function createInvite(
  supabase: SupabaseClient,
  userId: string,
  input: InviteInput
): Promise<Result<{ inviteId: number }>> {
  const rateLimit = await checkRateLimit({
    action: "post-availability",
    identifier: userId,
    maxHits: MAX_ATTEMPTS,
    windowSeconds: WINDOW_SECONDS,
  });
  if (!rateLimit.allowed) {
    return {
      ok: false,
      reason: "rate_limited",
      message: rateLimitMessage(rateLimit.retryAfterSeconds),
    };
  }

  const country = text(input.country);
  if (!isCountryCode(country)) {
    return invalid("Please choose the country the course is in.");
  }

  // The id is what's submitted and the name and country are re-read from the
  // club row rather than trusted. An absent id means the member typed
  // something the picker never matched, which is the case to refuse — an
  // invite at a club that isn't in the directory can't be found by anyone
  // browsing that club's page.
  const clubId = optionalNumber(input.clubId);
  if (clubId === undefined || clubId === null || !Number.isFinite(clubId)) {
    return invalid("Please choose a golf club from the suggested list.");
  }

  const club = await getClubById(clubId);
  if (!club) {
    return invalid("Please choose a golf club from the suggested list.");
  }
  if (club.country !== country) {
    return invalid(
      `${club.name} isn't in ${countryName(country)} — check the country above.`
    );
  }

  const county = text(input.county);
  if (!county || !isRegionInCountry(country, county)) {
    return invalid("Please select the county the course is in.");
  }

  const playDate = text(input.playDate);
  if (!playDate || Number.isNaN(Date.parse(playDate))) {
    return invalid("Please pick a valid date.");
  }
  const todayStr = new Date().toISOString().slice(0, 10);
  if (playDate < todayStr) {
    return invalid("That date has already passed — pick a date in the future.");
  }

  const spaces = optionalNumber(input.spaces);
  if (
    spaces === undefined ||
    spaces === null ||
    !SPACES_OPTIONS.includes(spaces as (typeof SPACES_OPTIONS)[number])
  ) {
    return invalid("Please choose how many spaces are available.");
  }

  const timeFrom = text(input.timeFrom);
  const timeTo = text(input.timeTo);
  const exactTeeTime = text(input.exactTeeTime);

  if (timeFrom && !TIME_RE.test(timeFrom)) {
    return invalid("That start time doesn't look right.");
  }
  if (timeTo && !TIME_RE.test(timeTo)) {
    return invalid("That end time doesn't look right.");
  }
  if (timeFrom && timeTo && timeFrom >= timeTo) {
    return invalid("The end of your time range needs to be after the start.");
  }
  if (exactTeeTime && !TIME_RE.test(exactTeeTime)) {
    return invalid("That tee time doesn't look right.");
  }

  const handicapLimit = optionalNumber(input.handicapLimit);
  if (
    handicapLimit === undefined ||
    (handicapLimit !== null && (handicapLimit < 0 || handicapLimit > 54))
  ) {
    return invalid("That handicap limit doesn't look right.");
  }

  // Falls back to the default rather than erroring on an empty value: the
  // radio group always posts one of the two, so an absent value means an older
  // cached copy of the form, and silently posting to everyone — the behaviour
  // before this field existed — is the honest reading of that. A *present but
  // unrecognised* value is different, and is rejected: it can only come from a
  // hand-built request, and guessing an audience for someone is the one thing
  // this field must never do.
  const visibilityRaw = text(input.visibility);
  const visibility = visibilityRaw ? visibilityRaw : DEFAULT_VISIBILITY;
  if (!isInviteVisibility(visibility)) {
    return invalid("Please choose who can see this tee time.");
  }

  // An unticked checkbox posts nothing at all, so absent means false — the
  // safe reading: the failure mode is an invite open to everyone, never one
  // wrongly marked.
  const hasTeeTime = input.hasTeeTime === true || input.hasTeeTime === "on";
  const ladiesOnly = input.ladiesOnly === true || input.ladiesOnly === "on";
  const notes = text(input.notes);

  const { data: invite, error } = await supabase
    .from("tee_time_invites")
    .insert({
      member_id: userId,
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
    // The id is needed for the notification dedupe key. Reading it back is the
    // RLS pattern that broke listing creation once (see migration 0052) — safe
    // here because the invite read policy tests this row's own column values
    // rather than re-querying the table.
    .select("id")
    .single<{ id: number }>();

  if (error || !invite) {
    return { ok: false, reason: "failed", message: error?.message ?? "Couldn't post that." };
  }

  // Tell the host's connections. Deliberately after the response: this can be
  // dozens of auth lookups and provider calls, and the member who just filled
  // in a form should not sit watching a spinner while other people's email is
  // dispatched. Their tee time is already saved by this point, so nothing here
  // can cost them the post.
  after(async () => {
    try {
      await notifyConnectionsOfInvite(createAdminClient(), {
        inviteId: invite.id,
        hostId: userId,
        clubName: club.name,
        playDate,
        timeFrom: timeFrom || null,
        timeTo: timeTo || null,
        spaces,
        ladiesOnly,
      });
    } catch (err) {
      console.error(
        "[tee-times] Fan-out failed:",
        err instanceof Error ? err.message : err
      );
    }
  });

  return { ok: true, value: { inviteId: invite.id } };
}
