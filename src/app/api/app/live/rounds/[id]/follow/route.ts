import { asId, authenticateAppRequest, badRequest, readJson, unauthenticated } from "@/lib/app-api";
import { isActive, newFollowSecret, type FollowRow } from "@/lib/follow-data";
import { notifyFollowStarted } from "@/lib/follow-notifications";
import { checkRateLimit } from "@/lib/rate-limit";
import { getSiteUrl } from "@/lib/site-url";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Follow my round (0158) — the "Share live" sheet on the scoring screen.
 *
 * POST { playerId, followers?: uuid[], link?: boolean } → { url, shared }
 *   Shares a card. live_follow_share() runs with the member's own client and
 *   decides whose card they may share and with whom; this route only makes
 *   the link's secret (storing its hash) and tells the PinPals. The full
 *   link is returned once, here, and never again — it isn't stored.
 *
 * GET → { shares: [...] }
 *   The shares this member made in this round, and any of their own card,
 *   for "Who's watching" and its Stop buttons (stopping is
 *   live_follow_stop(), from the app).
 */

type Body = { playerId?: unknown; followers?: unknown; link?: unknown };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const reasonFor = (message: string): { status: number; reason: string } => {
  if (/finished/i.test(message)) return { status: 409, reason: "finished" };
  if (/own card|PinPals|Sign in/i.test(message)) return { status: 403, reason: "not_allowed" };
  if (/5 links|20 PinPals|10 PinPals/i.test(message)) return { status: 429, reason: "too_many" };
  return { status: 400, reason: "bad_request" };
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();
  const roundId = asId((await params).id);
  if (roundId === null) return badRequest("id must be a positive integer");

  const body = await readJson<Body>(request);
  const playerId = asId(body?.playerId);
  if (playerId === null) return badRequest("Expected { playerId }.");
  const followers = Array.isArray(body?.followers) ? body.followers : [];
  if (followers.length > 10 || followers.some((f) => typeof f !== "string" || !UUID.test(f))) return badRequest("followers must be up to 10 member ids.");
  const wantLink = body?.link === true;
  if (!wantLink && followers.length === 0) return badRequest("Choose a PinPal or a link.");

  // The player must be in this round (and visible to the caller).
  const { data: player } = await auth.supabase
    .from("live_round_players")
    .select("id, round_id")
    .eq("id", playerId)
    .eq("round_id", roundId)
    .maybeSingle<{ id: number; round_id: number }>();
  if (!player) return Response.json({ error: "That card isn't in this round.", reason: "not_found" }, { status: 404 });

  if (wantLink) {
    const limit = await checkRateLimit({ action: "live_follow_link", identifier: auth.user.id, maxHits: 30, windowSeconds: 3600 });
    if (!limit.allowed) return Response.json({ error: "Too many links. Try again later.", reason: "rate_limited" }, { status: 429 });
  }

  const secret = wantLink ? newFollowSecret() : null;
  const { data, error } = await auth.supabase.rpc("live_follow_share", {
    p_player_id: playerId,
    p_followers: followers.length ? followers : null,
    p_token_hash: secret?.hash ?? null,
  });
  if (error) {
    const { status, reason } = reasonFor(error.message);
    return Response.json({ error: status === 400 ? "Couldn't share that card." : error.message, reason }, { status });
  }

  const shared = (data ?? []) as { id: number; follower_id: string | null }[];
  const pinpalShares = shared.filter((s) => s.follower_id).map((s) => s.id);
  if (pinpalShares.length) {
    await notifyFollowStarted(createAdminClient(), pinpalShares, auth.user.id).catch((e) => console.error("follow: start alerts failed", e));
  }

  return Response.json(
    { // After the #: browsers never send it to a server (see src/app/follow/page.tsx).
      url: secret ? `${getSiteUrl()}/follow#${secret.token}` : null, shared: shared.length },
    { headers: { "cache-control": "private, no-store" } }
  );
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();
  const roundId = asId((await params).id);
  if (roundId === null) return badRequest("id must be a positive integer");

  // Shares this member made, and any of their own card (whoever made it) —
  // a golfer can always see who is following them. RLS allows both.
  const { data: mine } = await auth.supabase.from("live_round_players").select("id").eq("round_id", roundId).eq("member_id", auth.user.id);
  const myPlayers = ((mine ?? []) as { id: number }[]).map((p) => p.id);
  const { data, error } = await auth.supabase
    .from("live_round_follows")
    .select("id, round_id, player_id, shared_by, follower_id, created_at, expires_at, revoked_at")
    .eq("round_id", roundId)
    .or([`shared_by.eq.${auth.user.id}`, ...(myPlayers.length ? [`player_id.in.(${myPlayers.join(",")})`] : [])].join(","))
    .order("created_at", { ascending: false });
  if (error) return Response.json({ error: "Couldn't load your shares." }, { status: 500 });

  const now = new Date();
  const rows = ((data ?? []) as FollowRow[]).filter((f) => isActive(f, now));
  const ids = [...new Set(rows.map((r) => r.follower_id).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (ids.length) {
    // Names of PinPals this member chose; ids come from their own rows above.
    const { data: profs } = await createAdminClient().from("profiles").select("id, first_name, last_name").in("id", ids);
    for (const p of (profs ?? []) as { id: string; first_name: string | null; last_name: string | null }[]) {
      names.set(p.id, [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || "A PinPal");
    }
  }
  return Response.json(
    {
      shares: rows.map((r) => ({
        id: r.id,
        playerId: r.player_id,
        kind: r.follower_id ? "pinpal" : "link",
        followerId: r.follower_id,
        name: r.follower_id ? (names.get(r.follower_id) ?? "A PinPal") : "Link",
        createdAt: r.created_at,
        expiresAt: r.expires_at,
      })),
    },
    { headers: { "cache-control": "private, no-store" } }
  );
}
