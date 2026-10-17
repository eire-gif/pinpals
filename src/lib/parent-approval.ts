import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { hashParentToken, parentTokenFromRequest } from "@/lib/parent-link-token";

/**
 * The parent's side of a junior's request (0159), shared by the
 * /api/parent/* route handlers. The secret arrives as
 * `Authorization: Parent <secret>` (it lives after the # in the page
 * address, so it is never in a URL a server logs); only its hash is used
 * from here on.
 */

export type PreviewStatus = "pending" | "approved" | "declined" | "revoked" | "expired";
export type LinkPreview = {
  status: PreviewStatus;
  childFirstName: string;
  invitedAt: string;
  awaitingCardCheck: boolean;
  cardCheckRequired: boolean;
};

/** The hash from the request, or null for a missing / malformed secret. */
export function hashFromRequest(request: Request): string | null {
  return hashParentToken(parentTokenFromRequest(request));
}

/** The link row behind a hash — service role, for the card check only. */
export async function linkByHash(hash: string): Promise<{ id: number; guardian_id: string | null; status: string; consented_at: string | null } | null> {
  const { data } = await createAdminClient()
    .from("guardian_links")
    .select("id, guardian_id, status, consented_at")
    .eq("token_hash", hash)
    .maybeSingle<{ id: number; guardian_id: string | null; status: string; consented_at: string | null }>();
  return data ?? null;
}

export const NO_STORE = { "cache-control": "private, no-store", "x-robots-tag": "noindex" } as const;
