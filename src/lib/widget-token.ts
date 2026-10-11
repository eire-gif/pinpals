import { createHmac, timingSafeEqual } from "node:crypto";

import { shareSecret } from "@/lib/share-links";

/**
 * The key a member's Home Screen widget uses to fetch their scoreboard
 * (Oct 2026). A widget runs outside the app and can't keep a Supabase
 * session alive, so the app asks for one of these once (signed in) and
 * hands it to the widget through the shared App Group.
 *
 * Signed, not stored, like the calendar and share links. It opens one
 * thing only: GET /api/widget/live, the scoreboard of games the member is
 * playing in. 180 days; the app swaps it for a fresh one well before then.
 */

const TTL_MS = 180 * 24 * 3600 * 1000;

type Payload = { v: 1; m: string; exp: number };

const signature = (payload: string, secret: string) => createHmac("sha256", secret).update(`widget.${payload}`).digest().subarray(0, 16);

export function signWidgetToken(memberId: string, now = Date.now(), secret: string = shareSecret()): { token: string; expiresAt: number } {
  const exp = now + TTL_MS;
  const payload = Buffer.from(JSON.stringify({ v: 1, m: memberId, exp } satisfies Payload)).toString("base64url");
  return { token: `${payload}.${signature(payload, secret).toString("base64url")}`, expiresAt: exp };
}

/** The member id inside a valid, unexpired token; null otherwise. */
export function verifyWidgetToken(token: unknown, now = Date.now(), secret: string = shareSecret()): string | null {
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
    return data.m;
  } catch {
    return null;
  }
}
