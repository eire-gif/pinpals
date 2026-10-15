import { createHmac, timingSafeEqual } from "node:crypto";

import { shareSecret } from "@/lib/share-links";

/**
 * The key in a clubhouse TV's address (Oct 2026): /tv/s/<token>.
 *
 * A TV in a bar has no PinPals session, so the organiser's app asks for one
 * of these (POST /api/app/live/tv) and either pairs it to the TV's code or
 * shares the link. It opens one thing only: GET /api/tv/board, the
 * leaderboard of that one match day or round. Signed, not stored, like the
 * widget key and share links; three days, so it lasts the outing and the
 * evening after but doesn't linger on the TV for weeks.
 */

const TTL_MS = 3 * 24 * 3600 * 1000;

export type TvTarget = { kind: "day" | "round"; id: number };

type Payload = { v: 1; k: "d" | "r"; i: number; exp: number };

const signature = (payload: string, secret: string) => createHmac("sha256", secret).update(`tv.${payload}`).digest().subarray(0, 16);

export function signTvToken(target: TvTarget, now = Date.now(), secret: string = shareSecret()): { token: string; expiresAt: number } {
  const exp = now + TTL_MS;
  const body: Payload = { v: 1, k: target.kind === "day" ? "d" : "r", i: target.id, exp };
  const payload = Buffer.from(JSON.stringify(body)).toString("base64url");
  return { token: `${payload}.${signature(payload, secret).toString("base64url")}`, expiresAt: exp };
}

/** The game a valid, unexpired token opens; null otherwise. */
export function verifyTvToken(token: unknown, now = Date.now(), secret: string = shareSecret()): TvTarget | null {
  if (typeof token !== "string" || token.length > 300) return null;
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined) return null;
  const given = Buffer.from(sig, "base64url");
  const expected = signature(payload, secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<Payload>;
    if (data.v !== 1 || typeof data.exp !== "number" || data.exp < now) return null;
    if ((data.k !== "d" && data.k !== "r") || !Number.isSafeInteger(data.i) || (data.i as number) <= 0) return null;
    return { kind: data.k === "d" ? "day" : "round", id: data.i as number };
  } catch {
    return null;
  }
}

/** Pairing codes: six characters a person can read across a bar and type on
 *  a phone — no 0/O, 1/I/L, so nothing is mistaken. */
export const TV_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const TV_CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;

export function normaliseTvCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const code = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return TV_CODE_RE.test(code) ? code : null;
}
