import { createHmac, timingSafeEqual } from "node:crypto";

import { shareSecret } from "@/lib/share-links";

/**
 * The key the iPhone lock screen uses to save a score (Oct 2026).
 *
 * The Live Activity's buttons (−, +, Save, Picked up) run while the app is
 * asleep, so there's no Supabase session to write with. When the app starts
 * the Live Activity for a round it asks for one of these
 * (POST /api/app/live/rounds/[id]/lock-screen-key) and hands it to the card
 * through the App Group.
 *
 * It opens one thing only: POST /api/widget/live/score, for one member's own
 * ball in one round. Signed, not stored, like the widget key — but much
 * shorter-lived (a round, not half a year) because it writes. The app swaps
 * it for a fresh one whenever the round screen opens.
 */

export const LIVE_SCORE_TTL_MS = 18 * 3600 * 1000;

type Payload = { v: 1; m: string; r: number; exp: number };

// A different prefix from the widget key's, so neither key verifies as the other.
const signature = (payload: string, secret: string) => createHmac("sha256", secret).update(`livescore.${payload}`).digest().subarray(0, 16);

export function signLiveScoreToken(
  memberId: string,
  roundId: number,
  now = Date.now(),
  secret: string = shareSecret()
): { token: string; expiresAt: number } {
  const exp = now + LIVE_SCORE_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ v: 1, m: memberId, r: roundId, exp } satisfies Payload)).toString("base64url");
  return { token: `${payload}.${signature(payload, secret).toString("base64url")}`, expiresAt: exp };
}

/** The member and round inside a valid, unexpired key; null otherwise. */
export function verifyLiveScoreToken(
  token: unknown,
  now = Date.now(),
  secret: string = shareSecret()
): { memberId: string; roundId: number } | null {
  if (typeof token !== "string" || token.length > 600) return null;
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined) return null;
  const given = Buffer.from(sig, "base64url");
  const expected = signature(payload, secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<Payload>;
    if (data.v !== 1 || typeof data.exp !== "number" || data.exp < now) return null;
    if (typeof data.m !== "string" || !/^[0-9a-f-]{36}$/i.test(data.m)) return null;
    if (typeof data.r !== "number" || !Number.isSafeInteger(data.r) || data.r <= 0) return null;
    return { memberId: data.m, roundId: data.r };
  } catch {
    return null;
  }
}
