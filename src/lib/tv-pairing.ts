import "server-only";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { signTvToken, TV_CODE_ALPHABET, type TvTarget } from "@/lib/tv-token";

/**
 * Pairing a clubhouse TV with a game (0147). The TV asks for a code, shows
 * it, and polls with its own secret; the organiser's app pairs the code to
 * a match day or round; the TV's next poll gets its signed link.
 * Service client throughout — tv_screens has no client access.
 */

export const CODE_TTL_MS = 10 * 60 * 1000;
const LINKED_TTL_MS = 3 * 24 * 3600 * 1000;

const hash = (secret: string) => createHash("sha256").update(secret).digest("hex");

export function newCode(): string {
  let code = "";
  for (let i = 0; i < 6; i += 1) code += TV_CODE_ALPHABET[randomInt(TV_CODE_ALPHABET.length)];
  return code;
}

/** A fresh code for a TV, and the secret only it keeps. */
export async function createTvCode(db: SupabaseClient, now = new Date()): Promise<{ code: string; secret: string; expiresAt: string }> {
  // Tidy as we go: codes a day past their expiry are never looked at again.
  await db.from("tv_screens").delete().lt("expires_at", new Date(now.getTime() - 24 * 3600 * 1000).toISOString());

  const secret = randomBytes(24).toString("base64url");
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS).toISOString();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = newCode();
    const { error } = await db.from("tv_screens").insert({ code, secret_hash: hash(secret), expires_at: expiresAt });
    if (!error) return { code, secret, expiresAt };
    if (error.code !== "23505") throw error; // anything but "code taken"
  }
  throw new Error("Couldn't find a free TV code");
}

export type TvCodeStatus = { state: "waiting" } | { state: "expired" } | { state: "linked"; token: string } | { state: "unknown" };

/** What a polling TV is told. Only the TV holding the secret gets the link. */
export async function tvCodeStatus(db: SupabaseClient, code: string, secret: string, now = new Date()): Promise<TvCodeStatus> {
  const { data, error } = await db
    .from("tv_screens")
    .select("secret_hash, match_day_id, round_id, linked_at, expires_at")
    .eq("code", code)
    .maybeSingle<{ secret_hash: string; match_day_id: number | null; round_id: number | null; linked_at: string | null; expires_at: string }>();
  if (error) throw error;
  if (!data) return { state: "unknown" };
  const given = Buffer.from(hash(secret), "hex");
  const stored = Buffer.from(data.secret_hash, "hex");
  if (given.length !== stored.length || !timingSafeEqual(given, stored)) return { state: "unknown" };
  if (data.linked_at) {
    const target: TvTarget | null = data.match_day_id ? { kind: "day", id: data.match_day_id } : data.round_id ? { kind: "round", id: data.round_id } : null;
    if (!target) return { state: "expired" }; // the game was deleted after pairing
    return { state: "linked", token: signTvToken(target, now.getTime()).token };
  }
  if (new Date(data.expires_at).getTime() < now.getTime()) return { state: "expired" };
  return { state: "waiting" };
}

/** Pair a waiting code to a game. False when the code isn't on a TV (wrong,
 *  expired, or already paired). The caller has already checked the member
 *  can see the game. */
export async function linkTvCode(db: SupabaseClient, code: string, target: TvTarget, memberId: string, now = new Date()): Promise<boolean> {
  const { data, error } = await db
    .from("tv_screens")
    .update({
      match_day_id: target.kind === "day" ? target.id : null,
      round_id: target.kind === "round" ? target.id : null,
      linked_by: memberId,
      linked_at: now.toISOString(),
      expires_at: new Date(now.getTime() + LINKED_TTL_MS).toISOString(),
    })
    .eq("code", code)
    .is("linked_at", null)
    .gt("expires_at", now.toISOString())
    .select("code");
  if (error) throw error;
  return (data ?? []).length === 1;
}
