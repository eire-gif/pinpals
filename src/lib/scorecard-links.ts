import { createHmac, timingSafeEqual } from "node:crypto";

import { shareSecret } from "@/lib/share-links";

/**
 * Scorecard share links (0110) — the public page a member sends by WhatsApp
 * or text from their scorecard.
 *
 *   https://www.pinpals.ie/c/<token>
 *
 * The same scheme as post share links (share-links.ts): the token is a
 * signed `{"c": scorecardId, "s": sharerId, "v": 1}`, so the public page can
 * trust it without a table. The signature is domain-separated ("scorecard."
 * before the payload), so a post token can never pass as a scorecard token
 * or the other way round, even under the same secret.
 *
 * The page shows the card only while it exists and the sharer still owns it
 * (scorecard-share-server.ts). Revoking is deleting the card.
 */

export type ScorecardPayload = { c: number; s: string; v: 1 };

function signature(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(`scorecard.${payload}`).digest().subarray(0, 16);
}

export function signScorecardToken(scorecardId: number, sharerId: string, secret: string = shareSecret()): string {
  const payload = Buffer.from(JSON.stringify({ c: scorecardId, s: sharerId, v: 1 } satisfies ScorecardPayload)).toString("base64url");
  return `${payload}.${signature(payload, secret).toString("base64url")}`;
}

export function verifyScorecardToken(token: string, secret: string = shareSecret()): ScorecardPayload | null {
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
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<ScorecardPayload>;
    if (data.v !== 1 || !Number.isInteger(data.c) || (data.c as number) <= 0 || typeof data.s !== "string") return null;
    return { c: data.c as number, s: data.s, v: 1 };
  } catch {
    return null;
  }
}

export const scorecardLinkPath = (token: string) => `/c/${token}`;
export const scorecardImagePath = (token: string) => `/c/${token}/opengraph-image`;
