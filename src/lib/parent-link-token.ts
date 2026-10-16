import "server-only";

import { hashFollowToken, newFollowSecret } from "@/lib/follow-data";

/**
 * A parent link's secret (0159). The same shape as a Follow my round link's
 * (0158) — 32 random bytes, base64url, only the SHA-256 hex stored — so the
 * helpers are shared rather than written twice. It travels after the # in
 * /parent#<secret>, so the browser never sends it to a server; the page
 * reads it and sends it to /api/parent/* as `Authorization: Parent <secret>`,
 * where it is hashed and looked up.
 */
export function newParentToken(): { token: string; hash: string } {
  return newFollowSecret();
}

/** null for anything that isn't a well-formed secret — never hashed, never looked up. */
export function hashParentToken(token: unknown): string | null {
  return hashFollowToken(token);
}

/** The secret from `Authorization: Parent <secret>`. */
export function parentTokenFromRequest(request: Request): string | null {
  return (request.headers.get("authorization") ?? "").match(/^Parent (.+)$/i)?.[1]?.trim() ?? null;
}
