import "server-only";
import { createPrivateKey, sign } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Sign in with Apple: keeping, and revoking, the member's Apple grant
 * (Oct 2026, claude/social-sign-in.md).
 *
 * App Store Guideline 5.1.1(v): an app that offers Sign in with Apple must
 * revoke the member's Apple tokens when they delete their account. Supabase
 * signs the member in from Apple's identity token and keeps no Apple token of
 * its own, so:
 *
 *   1. On sign-in the app sends Apple's one-time authorisation code to
 *      POST /api/app/apple/token. Here it's swapped with Apple for a refresh
 *      token, kept in apple_sign_in_tokens (0193; service role only).
 *   2. When the member asks to delete their account
 *      (lib/account-deletion.ts), that refresh token is revoked with Apple
 *      and the row removed. The member then sees PinPals gone from
 *      Settings → Apple ID → Sign in with Apple.
 *
 * Talking to Apple needs a client secret: a short-lived JWT (ES256) signed
 * with a "Sign in with Apple" key from the Apple Developer account. Vercel:
 *
 *   APPLE_SIGN_IN_KEY_ID       the key's ID (10 characters)
 *   APPLE_SIGN_IN_PRIVATE_KEY  the .p8 file's contents (newlines as \n are fine)
 *   APPLE_TEAM_ID              optional, defaults to PinPals' team
 *
 * Without them both steps quietly do nothing — signing in still works.
 */

const APPLE = "https://appleid.apple.com";
/** The app's bundle ID: the "client" Apple issued the code to. */
const CLIENT_ID = "ie.pinpals.app";
const DEFAULT_TEAM_ID = "8UEGCT8434";

type Keys = { keyId: string; privateKey: string; teamId: string };

function keys(): Keys | null {
  const keyId = process.env.APPLE_SIGN_IN_KEY_ID?.trim();
  const privateKey = process.env.APPLE_SIGN_IN_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (!keyId || !privateKey) return null;
  return { keyId, privateKey, teamId: process.env.APPLE_TEAM_ID?.trim() || DEFAULT_TEAM_ID };
}

const base64url = (input: Buffer | string): string =>
  Buffer.from(input).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

/** Apple's client secret: ES256, five minutes, for this one request. Exported for its test. */
export function appleClientSecret(k: Keys, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const header = base64url(JSON.stringify({ alg: "ES256", kid: k.keyId, typ: "JWT" }));
  const payload = base64url(JSON.stringify({ iss: k.teamId, iat, exp: iat + 300, aud: APPLE, sub: CLIENT_ID }));
  const signature = sign("sha256", Buffer.from(`${header}.${payload}`), {
    key: createPrivateKey(k.privateKey),
    dsaEncoding: "ieee-p1363", // JWS wants r‖s, not DER
  });
  return `${header}.${payload}.${base64url(signature)}`;
}

async function postToApple(path: string, fields: Record<string, string>): Promise<Response> {
  return fetch(`${APPLE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
    signal: AbortSignal.timeout(10_000),
  });
}

/** Step 1. True when a refresh token was kept. */
export async function keepAppleRefreshToken(userId: string, authorizationCode: string): Promise<boolean> {
  const k = keys();
  if (!k) return false;
  const response = await postToApple("/auth/token", {
    client_id: CLIENT_ID,
    client_secret: appleClientSecret(k),
    code: authorizationCode,
    grant_type: "authorization_code",
  });
  if (!response.ok) {
    console.warn(`[apple-sign-in] code exchange refused: ${response.status}`);
    return false;
  }
  const body = (await response.json()) as { refresh_token?: string };
  if (!body.refresh_token) return false;

  const { error } = await createAdminClient()
    .from("apple_sign_in_tokens")
    .upsert({ user_id: userId, refresh_token: body.refresh_token, updated_at: new Date().toISOString() });
  if (error) console.warn(`[apple-sign-in] couldn't keep token: ${error.message}`);
  return !error;
}

/** Step 2. Never throws: a deletion must not fail because Apple is down. */
export async function revokeAppleSignIn(userId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("apple_sign_in_tokens")
      .select("refresh_token")
      .eq("user_id", userId)
      .maybeSingle<{ refresh_token: string }>();
    if (!data) return;

    const k = keys();
    if (k) {
      const response = await postToApple("/auth/revoke", {
        client_id: CLIENT_ID,
        client_secret: appleClientSecret(k),
        token: data.refresh_token,
        token_type_hint: "refresh_token",
      });
      if (!response.ok) {
        // Kept for another go: the scrub removes the row with the account.
        console.warn(`[apple-sign-in] revoke refused for ${userId}: ${response.status}`);
        return;
      }
    }
    await admin.from("apple_sign_in_tokens").delete().eq("user_id", userId);
  } catch (err) {
    console.warn(`[apple-sign-in] revoke failed for ${userId}`, err instanceof Error ? err.message : err);
  }
}
