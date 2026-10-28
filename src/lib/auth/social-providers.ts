import "server-only";

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/config";

/**
 * Which "Continue with…" buttons the website shows (Oct 2026,
 * claude/social-sign-in.md).
 *
 * GOOGLE shows once it's switched on in Supabase (Authentication →
 * Providers). Supabase's public /auth/v1/settings says what's on, so there is
 * nothing to redeploy. Read at most every five minutes.
 *
 * APPLE on the website needs more than the app does — a Services ID, a
 * verified domain and a signing key in Supabase — and turning Apple on for
 * the app alone switches the provider on there too. So the website's Apple
 * button also waits for WEB_APPLE_SIGN_IN=1 in Vercel, set once that web
 * setup is done.
 */
export type SocialProvider = "google" | "apple";

export async function enabledSocialProviders(): Promise<SocialProvider[]> {
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: SUPABASE_ANON_KEY },
      next: { revalidate: 300 },
    });
    if (!response.ok) return [];
    const body = (await response.json()) as { external?: Record<string, unknown> };
    const on = body.external ?? {};
    const out: SocialProvider[] = [];
    if (on.apple === true && process.env.WEB_APPLE_SIGN_IN === "1") out.push("apple");
    if (on.google === true) out.push("google");
    return out;
  } catch {
    return [];
  }
}

export const isSocialProvider = (value: unknown): value is SocialProvider => value === "google" || value === "apple";

/**
 * Whether this account has a password — false for a member who only ever
 * joined with Apple or Google. Steps that re-check a password (deleting the
 * account) ask such a member to have signed in recently instead.
 */
export function hasPassword(user: { identities?: { provider: string }[] | null }): boolean {
  return (user.identities ?? []).some((i) => i.provider === "email");
}

/** "Signed in recently enough" for a member with no password to re-enter. */
export const RECENT_SIGN_IN_MS = 15 * 60 * 1000;
export function signedInRecently(user: { last_sign_in_at?: string | null }, now = Date.now()): boolean {
  const at = user.last_sign_in_at ? new Date(user.last_sign_in_at).getTime() : NaN;
  return Number.isFinite(at) && now - at < RECENT_SIGN_IN_MS;
}
