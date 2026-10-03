import { deleteFromSite, getFromSite, postToSite } from "./api";

/**
 * Blocking, for the app — through the website's /api/app/blocks routes so
 * the same rate limit applies as on the site. What a block does is decided
 * in the database (see src/lib/blocking.ts on the site): both members stop
 * seeing each other's posts and comments, and neither can message the
 * other. Nobody is told.
 */

export type BlockedMember = {
  id: string;
  name: string;
  avatarUrl: string | null;
  avatarColor: string | null;
  blockedAt: string;
};

export const blockMember = (memberId: string): Promise<{ ok: true }> =>
  postToSite("/api/app/blocks", { member_id: memberId });

export const unblockMember = (memberId: string): Promise<{ ok: true }> =>
  deleteFromSite(`/api/app/blocks/${encodeURIComponent(memberId)}`);

export async function listBlocked(): Promise<BlockedMember[]> {
  const { blocked } = await getFromSite<{ blocked: BlockedMember[] }>("/api/app/blocks");
  return blocked;
}

/** The wording for the confirm, in one place so every screen says the
 *  same thing about what a block does. */
export function blockConfirmText(name: string): { title: string; message: string } {
  const first = name.split(" ")[0] || "this member";
  return {
    title: `Block ${name}?`,
    message: `You won't see ${first}'s posts or comments, and ${first} won't see yours. Neither of you can message the other. ${first} isn't told, and you can unblock from ${first}'s page or from Blocked members in the menu.`,
  };
}
