import { asId, authenticateAppRequest, badRequest, readJson, unauthenticated } from "@/lib/app-api";
import { checkRateLimit } from "@/lib/rate-limit";
import { getSiteUrl } from "@/lib/site-url";
import { createAdminClient } from "@/lib/supabase/admin";
import { linkTvCode } from "@/lib/tv-pairing";
import { normaliseTvCode, signTvToken, type TvTarget } from "@/lib/tv-token";

/**
 * POST /api/app/live/tv  { kind: "day" | "round", id, code? }  → { url, paired }
 *
 * "Show on TV" in the app. With a code, pairs the TV showing it to this
 * game; without, just returns the TV link (for a laptop, a TV browser or
 * AirPlay). Read with the member's own client first, so RLS decides: only
 * someone who can see the game in the app can put it on a screen.
 */

type Body = { kind?: unknown; id?: unknown; code?: unknown };

export async function POST(request: Request) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const body = await readJson<Body>(request);
  const id = asId(body?.id);
  if (id === null || (body?.kind !== "day" && body?.kind !== "round")) return badRequest("Expected { kind, id }.");
  const target: TvTarget = { kind: body.kind, id };

  const seen =
    target.kind === "day"
      ? await auth.supabase.from("live_match_days").select("id").eq("id", id).maybeSingle()
      : await auth.supabase.from("live_rounds").select("id").eq("id", id).maybeSingle();
  if (seen.error || !seen.data) return Response.json({ error: "That game isn't available.", reason: "not_found" }, { status: 404 });

  let paired = false;
  if (body.code !== undefined && body.code !== null && body.code !== "") {
    const code = normaliseTvCode(body.code);
    if (!code) return Response.json({ error: "TV codes are six letters and numbers, like K7Q4MP.", reason: "bad_code" }, { status: 400 });
    const limit = await checkRateLimit({ action: "tv_link_code", identifier: auth.user.id, maxHits: 20, windowSeconds: 600 });
    if (!limit.allowed) return Response.json({ error: "Too many tries. Wait a few minutes.", reason: "rate_limited" }, { status: 429 });
    try {
      paired = await linkTvCode(createAdminClient(), code, target, auth.user.id);
    } catch (e) {
      console.error("tv: link failed", e);
      return Response.json({ error: "Couldn't connect the TV. Try again." }, { status: 500 });
    }
    if (!paired) {
      return Response.json(
        { error: "That code isn't showing on a TV any more. Check the code on the screen and try again.", reason: "code_not_found" },
        { status: 404 }
      );
    }
  }

  const { token } = signTvToken(target);
  return Response.json({ url: `${getSiteUrl()}/tv/s/${token}`, paired }, { headers: { "cache-control": "private, no-store" } });
}
