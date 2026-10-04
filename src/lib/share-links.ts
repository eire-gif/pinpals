import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Share links — the one place a post's public share URL is made and read
 * (Oct 2026 feed redesign, phase 6).
 *
 *   https://www.pinpals.ie/s/<token>
 *
 * The token says which post and who shared it, signed so the public page
 * can trust both without a table: `<payload>.<signature>`, base64url, where
 * payload is {"p": postId, "s": sharerId, "v": 1} and the signature is the
 * first 16 bytes of an HMAC-SHA256 over the payload.
 *
 * WHY SIGNED AND NOT JUST /feed/<id>. /feed/<id> is a members-only page,
 * so a link preview in WhatsApp or iMessage would only ever show a login
 * screen. /s/<token> is public, renders a share card, and — because the
 * sharer is in the signed token — can show the golf details only when the
 * sharer is the post's author (see share-card.ts). Anyone else sharing a
 * post shares a plain card: nobody publishes another member's score.
 *
 * Nothing private is in the token: a post id and a member id, both of which
 * already appear in member-facing URLs. Revoking is by deleting or hiding
 * the post — the card then falls back to the plain one.
 *
 * The app decodes the payload (without the secret) only to route a tapped
 * link to its native post screen; the post screen applies the same RLS as
 * always. See mobile/src/lib/share-links.ts.
 */

export type SharePayload = { p: number; s: string; v: 1 };

const b64url = (buf: Buffer) => buf.toString("base64url");

function signature(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payload).digest().subarray(0, 16);
}

export function signShareToken(postId: number, sharerId: string, secret: string): string {
  const payload = b64url(Buffer.from(JSON.stringify({ p: postId, s: sharerId, v: 1 } satisfies SharePayload)));
  return `${payload}.${b64url(signature(payload, secret))}`;
}

/** The payload if the token is well-formed and correctly signed, else null. */
export function verifyShareToken(token: string, secret: string): SharePayload | null {
  if (typeof token !== "string" || token.length > 300) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  let given: Buffer;
  try {
    given = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  const expected = signature(payload, secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<SharePayload>;
    if (data.v !== 1 || !Number.isInteger(data.p) || (data.p as number) <= 0 || typeof data.s !== "string") return null;
    return { p: data.p as number, s: data.s, v: 1 };
  } catch {
    return null;
  }
}

/**
 * The signing secret. SHARE_LINK_SECRET when set (rotate it to invalidate
 * every link at once); otherwise derived from the service-role key, which
 * every deployment already has and which never leaves the server — so share
 * links work without anyone configuring anything.
 */
export function shareSecret(): string {
  const explicit = process.env.SHARE_LINK_SECRET;
  if (explicit) return explicit;
  const base = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base) throw new Error("Share links need SHARE_LINK_SECRET or SUPABASE_SERVICE_ROLE_KEY.");
  return createHmac("sha256", base).update("pinpals-share-links-v1").digest("hex");
}

export const shareLinkPath = (token: string) => `/s/${token}`;
/** Next serves the colocated opengraph-image here (app/s/[token]/). */
export const shareCardPath = (token: string) => `/s/${token}/opengraph-image`;
