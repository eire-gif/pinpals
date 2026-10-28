import { useEffect, useState } from "react";
import { Platform } from "react-native";

import { postToSite } from "./api";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config";
import { HAS_APPLE_AUTH, HAS_CRYPTO, HAS_WEB_BROWSER } from "./native-capabilities";
import { sha256, toHex, utf8 } from "./hmac-sha256";
import { isPlaceholderName, linkErrorMessage, readRedirectParams } from "./social-sign-in-rules";
import { supabase } from "./supabase";

export { isPlaceholderName, joinedWithProvider } from "./social-sign-in-rules";

/**
 * Sign in with Apple and Google (Oct 2026, claude/social-sign-in.md).
 *
 * APPLE (iPhone/iPad): Apple's own sheet — Face ID, no password — through
 * expo-apple-authentication. Apple hands back an identity token, which
 * Supabase checks and turns into a session (signInWithIdToken). A random
 * nonce, hashed for Apple and sent plain to Supabase, ties that token to
 * this one request. Apple gives the member's name ONCE, on their very first
 * sign-in, and never puts it in the token — so it's saved to the profile
 * here, straight away. Its one-time authorisation code goes to the website,
 * which swaps it for the refresh token it needs to revoke the grant if the
 * account is deleted (App Store Guideline 5.1.1(v); src/lib/apple-sign-in.ts).
 *
 * GOOGLE (iPhone and Android): Google's sign-in page in the system's secure
 * browser sheet (expo-web-browser), coming back to pinpals://auth-callback
 * with a PKCE code (lib/supabase.ts) that only this phone can redeem. No
 * Google client IDs are built into the app, so it is switched on and off
 * entirely in Supabase.
 *
 * Which buttons show: a provider switched on in Supabase (its public
 * /auth/v1/settings says so), on a binary with the native pieces
 * (native-capabilities.ts). Nothing to redeploy to switch either on.
 *
 * A brand-new account made this way has no date of birth. The database holds
 * it as junior_pending until one is saved (0193), and the root layout's age
 * gate sends the member to /age/date-of-birth, which also asks for a name
 * when Apple didn't share one.
 */

export type SocialProvider = "apple" | "google";

export type SocialResult =
  | { ok: true; userId: string }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled: false; error: string };

const REDIRECT = "pinpals://auth-callback";
const FAILED = "Couldn't sign you in just then. Please try again.";

// ---------------------------------------------------------------------------
// Which buttons to show
// ---------------------------------------------------------------------------

type Enabled = Record<SocialProvider, boolean>;
const NONE: Enabled = { apple: false, google: false };

let enabledCache: Enabled | null = null;
let enabledLoad: Promise<Enabled> | null = null;

/** What's switched on in Supabase. Cached for the session; NONE when offline. */
function loadEnabled(): Promise<Enabled> {
  if (enabledCache) return Promise.resolve(enabledCache);
  enabledLoad ??= fetch(`${SUPABASE_URL}/auth/v1/settings`, {
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY },
  })
    .then((r) => (r.ok ? r.json() : null))
    .then((body: { external?: Record<string, unknown> } | null) => {
      const ext = body?.external ?? {};
      enabledCache = { apple: ext.apple === true, google: ext.google === true };
      return enabledCache;
    })
    .catch(() => {
      enabledLoad = null; // try again next time the screen opens
      return NONE;
    });
  return enabledLoad;
}

async function appleUsable(): Promise<boolean> {
  if (Platform.OS !== "ios" || !HAS_APPLE_AUTH || !HAS_CRYPTO) return false;
  try {
    const Apple = require("expo-apple-authentication") as typeof import("expo-apple-authentication");
    return await Apple.isAvailableAsync();
  } catch {
    return false;
  }
}

/** The buttons the login and sign-up screens should show. */
export function useSocialProviders(): Enabled {
  const [shown, setShown] = useState<Enabled>(NONE);
  useEffect(() => {
    let active = true;
    void Promise.all([loadEnabled(), appleUsable()]).then(([enabled, apple]) => {
      if (!active) return;
      setShown({
        apple: enabled.apple && apple,
        google: enabled.google && HAS_WEB_BROWSER && HAS_CRYPTO,
      });
    });
    return () => {
      active = false;
    };
  }, []);
  return shown;
}

// ---------------------------------------------------------------------------
// Random numbers
// ---------------------------------------------------------------------------

function randomHex(bytes: number): string {
  const Crypto = require("expo-crypto") as typeof import("expo-crypto");
  return toHex(Crypto.getRandomBytes(bytes));
}

/** supabase-js makes its PKCE secret with crypto.getRandomValues, which
 *  Hermes doesn't always provide. Without it the secret would come from
 *  Math.random(). */
function ensureGetRandomValues(): void {
  const g = globalThis as { crypto?: { getRandomValues?: unknown } };
  if (typeof g.crypto?.getRandomValues === "function") return;
  const Crypto = require("expo-crypto") as typeof import("expo-crypto");
  g.crypto = { ...(g.crypto ?? {}), getRandomValues: Crypto.getRandomValues };
}

// ---------------------------------------------------------------------------
// Apple
// ---------------------------------------------------------------------------

type AppleCredential = import("expo-apple-authentication").AppleAuthenticationCredential;
type AppleSheet =
  | { ok: true; credential: AppleCredential & { identityToken: string }; rawNonce: string }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled: false; error: string };

/** Apple's Face ID sheet. Shared by signing in and connecting Apple to an account. */
async function appleSheet(): Promise<AppleSheet> {
  const Apple = require("expo-apple-authentication") as typeof import("expo-apple-authentication");
  const rawNonce = randomHex(32);
  let credential: AppleCredential;
  try {
    credential = await Apple.signInAsync({
      requestedScopes: [Apple.AppleAuthenticationScope.FULL_NAME, Apple.AppleAuthenticationScope.EMAIL],
      nonce: toHex(sha256(utf8(rawNonce))),
    });
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    if (code === "ERR_REQUEST_CANCELED") return { ok: false, cancelled: true };
    return { ok: false, cancelled: false, error: FAILED };
  }
  if (!credential.identityToken) return { ok: false, cancelled: false, error: FAILED };
  return { ok: true, credential: credential as AppleCredential & { identityToken: string }, rawNonce };
}

/** Lets the website keep Apple's token, so deleting the account can revoke it. */
function keepAppleToken(credential: AppleCredential): void {
  if (credential.authorizationCode) {
    void postToSite("/api/app/apple/token", { authorizationCode: credential.authorizationCode }).catch(() => undefined);
  }
}

export async function signInWithApple(): Promise<SocialResult> {
  const sheet = await appleSheet();
  if (!sheet.ok) return sheet;
  const { credential, rawNonce } = sheet;

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: "apple",
    token: credential.identityToken,
    nonce: rawNonce,
  });
  const userId = data.user?.id;
  if (error || !userId) return { ok: false, cancelled: false, error: FAILED };

  // Neither of these may stop the member getting in.
  const first = credential.fullName?.givenName?.trim();
  const last = credential.fullName?.familyName?.trim();
  if (first) await saveNameIfPlaceholder(userId, first, last ?? "").catch(() => undefined);
  keepAppleToken(credential);
  return { ok: true, userId };
}

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------

export async function signInWithGoogle(): Promise<SocialResult> {
  ensureGetRandomValues();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: REDIRECT,
      skipBrowserRedirect: true,
      // Always offer the account picker, so a phone signed in to a work
      // Google account doesn't silently use it.
      queryParams: { prompt: "select_account" },
    },
  });
  if (error || !data.url) return { ok: false, cancelled: false, error: FAILED };
  return googleSheet(data.url);
}

/** Google's page in the secure browser sheet, then back with a code. */
async function googleSheet(url: string): Promise<SocialResult> {
  const WebBrowser = require("expo-web-browser") as typeof import("expo-web-browser");
  const result = await WebBrowser.openAuthSessionAsync(url, REDIRECT);
  if (result.type !== "success") {
    return result.type === "cancel" || result.type === "dismiss"
      ? { ok: false, cancelled: true }
      : { ok: false, cancelled: false, error: FAILED };
  }
  return completeFromRedirect(result.url);
}

/**
 * Finishes a Google sign-in from the URL it came back on. Also used by
 * app/auth-callback.tsx for the rare Android case where the link reopens
 * the app instead of returning to the browser sheet.
 */
export async function completeFromRedirect(url: string): Promise<SocialResult> {
  const params = readRedirectParams(url);
  if (params.get("error")) {
    // "access_denied" is the member pressing Cancel on Google's page.
    return params.get("error") === "access_denied"
      ? { ok: false, cancelled: true }
      : { ok: false, cancelled: false, error: FAILED };
  }
  const code = params.get("code");
  if (!code) return { ok: false, cancelled: false, error: FAILED };

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  const userId = data.user?.id ?? data.session?.user.id;
  if (error || !userId) {
    // A second redeem (the sheet and the reopened app both tried): if a
    // session exists, the first one worked.
    const { data: current } = await supabase.auth.getSession();
    const existing = current.session?.user.id;
    return existing ? { ok: true, userId: existing } : { ok: false, cancelled: false, error: FAILED };
  }
  return { ok: true, userId };
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

async function saveNameIfPlaceholder(userId: string, first: string, last: string): Promise<void> {
  const { data } = await supabase
    .from("profiles")
    .select("first_name, last_name")
    .eq("id", userId)
    .maybeSingle<{ first_name: string; last_name: string }>();
  if (!data || !isPlaceholderName(data.first_name, data.last_name)) return;
  await saveName(userId, first, last || data.last_name);
}

/** Just the name. (saveMyProfile sends the whole profile form, which a
 *  minute-old account can't fill in yet — no country, no club.) */
export async function saveName(userId: string, first: string, last: string): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ first_name: first.trim().slice(0, 50), last_name: last.trim().slice(0, 50) })
    .eq("id", userId);
  if (error) throw new Error("Couldn't save your name. Please try again.");
}

// ---------------------------------------------------------------------------
// Connecting Apple / Google to an existing account (Profile → Privacy & security)
// ---------------------------------------------------------------------------
//
// Supabase joins an Apple or Google sign-in to an account with the same
// email by itself. When Apple's "Hide My Email" gives a relay address it
// can't, so a member links them here instead, while signed in. Needs
// "Allow manual linking" switched on in Supabase (claude/social-sign-in.md).

export type LinkResult = { ok: true } | { ok: false; cancelled: true } | { ok: false; cancelled: false; error: string };

/** Which ways in this account has: "email", "apple", "google". */
export async function loadLinkedProviders(): Promise<Set<string>> {
  const { data } = await supabase.auth.getUserIdentities();
  return new Set((data?.identities ?? []).map((i) => i.provider));
}

/** Providers switched on in Supabase and usable on this phone. */
export async function linkableProviders(): Promise<Record<SocialProvider, boolean>> {
  const [enabled, apple] = await Promise.all([loadEnabled(), appleUsable()]);
  return { apple: enabled.apple && apple, google: enabled.google && HAS_WEB_BROWSER && HAS_CRYPTO };
}

export async function linkApple(): Promise<LinkResult> {
  const sheet = await appleSheet();
  if (!sheet.ok) return sheet;
  const { error } = await supabase.auth.linkIdentity({
    provider: "apple",
    token: sheet.credential.identityToken,
    nonce: sheet.rawNonce,
  });
  if (error) return { ok: false, cancelled: false, error: linkErrorMessage("apple", error) };
  keepAppleToken(sheet.credential);
  return { ok: true };
}

export async function linkGoogle(): Promise<LinkResult> {
  ensureGetRandomValues();
  const { data, error } = await supabase.auth.linkIdentity({
    provider: "google",
    options: { redirectTo: REDIRECT, skipBrowserRedirect: true, queryParams: { prompt: "select_account" } },
  });
  if (error || !data?.url) return { ok: false, cancelled: false, error: linkErrorMessage("google", error) };
  const result = await googleSheet(data.url);
  if (result.ok) return { ok: true };
  if (result.cancelled) return result;
  // Google's errors come back on the link (e.g. already used by another account).
  return { ok: false, cancelled: false, error: "Couldn't connect Google. If that Google account already has its own PinPals account, it can't be added to this one." };
}

// ---------------------------------------------------------------------------
// "I already have an account" (Finish joining)
// ---------------------------------------------------------------------------

/**
 * Removes the brand-new Apple/Google account this phone is signed in to —
 * only while it's still empty and waiting for a date of birth (the website
 * checks: POST /api/app/account/discard-new) — and signs out, so the member
 * can log in to the account they already have and connect Apple there.
 */
export async function discardNewAccount(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await postToSite("/api/app/account/discard-new", {});
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't do that just now. Please try again." };
  }
  await supabase.auth.signOut({ scope: "local" });
  return { ok: true };
}
