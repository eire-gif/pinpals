import "server-only";

import { isPostKind } from "@/lib/post-details";
import { buildShareCard, type ShareCard, type ShareCardPost } from "@/lib/share-card";
import { shareSecret, verifyShareToken, type SharePayload } from "@/lib/share-links";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Reads what a public share link points at. The page and the card image
 * are public (link previews have no session), so this reads with the
 * service role — and then shows only what buildShareCard() allows: details
 * when the sharer is the author and the post is up, otherwise a plain card.
 * A bad token is the plain card too; it isn't an error worth a 404 page.
 */
export async function loadShareCard(token: string): Promise<{ payload: SharePayload | null; card: ShareCard }> {
  const payload = verifyShareToken(token, shareSecret());
  if (!payload) return { payload: null, card: buildShareCard(null, "") };

  const { data } = await createAdminClient()
    .from("posts")
    .select("id, author_id, kind, details, club_id, hidden_at, club:clubs ( name ), author:profiles!posts_author_id_fkey ( first_name )")
    .eq("id", payload.p)
    .maybeSingle<{
      id: number;
      author_id: string;
      kind: string | null;
      details: unknown;
      club_id: number | null;
      hidden_at: string | null;
      club: { name: string } | null;
      author: { first_name: string | null } | null;
    }>();

  const post: ShareCardPost | null = data
    ? {
        id: data.id,
        authorId: data.author_id,
        authorFirstName: data.author?.first_name ?? null,
        kind: isPostKind(data.kind) ? data.kind : "general",
        details: data.details ?? null,
        clubId: data.club_id,
        clubName: data.club?.name ?? null,
        hidden: data.hidden_at !== null,
      }
    : null;

  return { payload, card: buildShareCard(post, payload.s) };
}
