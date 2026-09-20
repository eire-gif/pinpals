import {
  authenticateAppRequest,
  readJson,
  unauthenticated,
} from "@/lib/app-api";
import { createInvite, type InviteInput } from "@/lib/tee-time-invites";

/**
 * POST /api/app/tee-times/invites
 *
 * A member posts a tee time from the app. Identical in every respect to the
 * website's form — same club lookup, same county check, same rate limit, same
 * email to the host's connections — because both call createInvite().
 *
 * The body is passed through as-is rather than parsed here: createInvite takes
 * loose input and coerces it in one place, so the app sending a number and the
 * form sending a string cannot end up meaning different things.
 */
export async function POST(request: Request) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const body = await readJson<Record<string, unknown>>(request);
  if (!body) return Response.json({ error: "Expected a JSON body" }, { status: 400 });

  const result = await createInvite(auth.supabase, auth.user.id, {
    clubId: body.club_id,
    country: body.country,
    county: body.county,
    playDate: body.play_date,
    timeFrom: body.time_from,
    timeTo: body.time_to,
    exactTeeTime: body.exact_tee_time,
    spaces: body.spaces,
    hasTeeTime: body.has_tee_time,
    handicapLimit: body.handicap_limit,
    notes: body.notes,
    visibility: body.visibility,
    ladiesOnly: body.ladies_only,
  } satisfies InviteInput);

  if (!result.ok) {
    // 422 rather than 400 for "invalid": the body was well-formed JSON the
    // route understood, and the app should show the message rather than treat
    // it as a bug in its own request building. 429 carries its own meaning and
    // the app backs off rather than retrying.
    const status =
      result.reason === "rate_limited" ? 429 : result.reason === "invalid" ? 422 : 500;

    return Response.json(
      { error: result.message, reason: result.reason },
      { status }
    );
  }

  return Response.json({ invite_id: result.value.inviteId }, { status: 201 });
}
