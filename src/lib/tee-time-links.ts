import { createHmac, timingSafeEqual } from "node:crypto";

import { shareSecret } from "@/lib/share-links";

/**
 * Shared tee time links (0132) — what a host or player sends by WhatsApp or
 * text to fill an open place.
 *
 *   https://www.pinpals.ie/t/<token>
 *
 * The same scheme as post and scorecard links: a signed
 * `{"t": inviteId, "s": sharerId, "v": 1}`, domain-separated ("teetime."
 * before the payload) so no other kind of token passes as this one.
 *
 * Opening it signed in adds you to the round's invitations, so you can see
 * it and ask for the place even when it's for the host's connections only —
 * but only while the round is open and the sharer is still the host or
 * playing (tee_time_link_claim). Revoking is the round filling or ending.
 */

export type TeeTimePayload = { t: number; s: string; v: 1 };

function signature(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(`teetime.${payload}`).digest().subarray(0, 16);
}

export function signTeeTimeToken(inviteId: number, sharerId: string, secret: string = shareSecret()): string {
  const payload = Buffer.from(JSON.stringify({ t: inviteId, s: sharerId, v: 1 } satisfies TeeTimePayload)).toString("base64url");
  return `${payload}.${signature(payload, secret).toString("base64url")}`;
}

export function verifyTeeTimeToken(token: string, secret: string = shareSecret()): TeeTimePayload | null {
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
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<TeeTimePayload>;
    if (data.v !== 1 || !Number.isInteger(data.t) || (data.t as number) <= 0 || typeof data.s !== "string") return null;
    return { t: data.t as number, s: data.s, v: 1 };
  } catch {
    return null;
  }
}

export const teeTimeLinkPath = (token: string) => `/t/${token}`;
