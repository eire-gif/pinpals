import { createHmac, timingSafeEqual } from "node:crypto";

import { shareSecret } from "@/lib/share-links";

/**
 * PinPals Wrapped picture links (claude/wrapped.md).
 *
 *   https://www.pinpals.ie/w/<token>/photo   → a 1080×1920 PNG of a year
 *
 * The same scheme as scorecard links (scorecard-links.ts): the token is a
 * signed `{"m": memberId, "y": year, "v": 1}`, domain-separated ("wrapped."
 * before the payload) so no other kind of token passes as one. Only the
 * member can have one made (POST /api/app/wrapped/share, signed in).
 */

export type WrappedPayload = { m: string; y: number; v: 1 };

function signature(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(`wrapped.${payload}`).digest().subarray(0, 16);
}

export function signWrappedToken(memberId: string, year: number, secret: string = shareSecret()): string {
  const payload = Buffer.from(JSON.stringify({ m: memberId, y: year, v: 1 } satisfies WrappedPayload)).toString("base64url");
  return `${payload}.${signature(payload, secret).toString("base64url")}`;
}

export function verifyWrappedToken(token: string, secret: string = shareSecret()): WrappedPayload | null {
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
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<WrappedPayload>;
    if (data.v !== 1 || typeof data.m !== "string" || !Number.isInteger(data.y) || (data.y as number) < 2020 || (data.y as number) > 2100) return null;
    return { m: data.m, y: data.y as number, v: 1 };
  } catch {
    return null;
  }
}

export const wrappedPhotoPath = (token: string) => `/w/${token}/photo`;
