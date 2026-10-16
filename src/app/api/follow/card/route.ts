import { cardForLink } from "@/lib/follow-data";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/follow/card   (header  Authorization: Follow <secret>)
 *
 * Follow my round (0158): the card a shared link opens, polled by
 * /follow#<secret> every few seconds. No account: the secret in the link is
 * the key. It lives after the # in the page address (never sent to a server)
 * and comes here as a header, so it never lands in access logs. Its hash is
 * looked up; a stopped or lapsed link gets 410 and the page says so.
 */
export const dynamic = "force-dynamic";

const MESSAGES: Record<string, string> = {
  not_found: "This link isn't working. Ask for a new one.",
  stopped: "This round is no longer being shared.",
  expired: "Sharing for this round has ended.",
  gone: "This round has been deleted.",
};

export async function GET(request: Request) {
  const token = (request.headers.get("authorization") ?? "").match(/^Follow (.+)$/i)?.[1]?.trim();
  try {
    const got = await cardForLink(createAdminClient(), token);
    if (!got.ok) {
      return Response.json({ error: MESSAGES[got.reason], reason: got.reason }, { status: got.reason === "not_found" ? 404 : 410 });
    }
    return Response.json({ card: got.card }, { headers: { "cache-control": "private, no-store", "x-robots-tag": "noindex" } });
  } catch (e) {
    console.error("follow: link card failed", e);
    return Response.json({ error: "Couldn't load the card." }, { status: 500 });
  }
}
