import { asId, authenticateAppRequest, badRequest, unauthenticated } from "@/lib/app-api";
import { getSiteUrl } from "@/lib/site-url";
import { shareCardPath, shareLinkPath, shareSecret, signShareToken } from "@/lib/share-links";

/**
 * POST /api/app/posts/[id]/share   → { url, imageUrl, rich }
 *
 * A public share link for a post the caller can see (phase 6): `url` is the
 * page to send, `imageUrl` its share card, `rich` whether the card carries
 * the golf details (only when the caller wrote the post — see
 * src/lib/share-card.ts). Signed, not stored: making a link costs nothing
 * and writes nothing, so the app can ask every time Share is tapped.
 *
 * The post is read with the caller's own client, so a post they can't see
 * is a 404 here exactly as it is everywhere else.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const postId = asId((await params).id);
  if (postId === null) return badRequest("Post id must be a positive integer.");

  const { data: post } = await auth.supabase
    .from("posts")
    .select("id, author_id")
    .eq("id", postId)
    .maybeSingle<{ id: number; author_id: string }>();
  if (!post) {
    return Response.json({ error: "That post is no longer available.", reason: "not_found" }, { status: 404 });
  }

  const token = signShareToken(post.id, auth.user.id, shareSecret());
  const site = getSiteUrl();
  return Response.json({
    url: `${site}${shareLinkPath(token)}`,
    imageUrl: `${site}${shareCardPath(token)}`,
    rich: post.author_id === auth.user.id,
  });
}
