"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { enabledSocialProviders, isSocialProvider } from "@/lib/auth/social-providers";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { getSiteUrl } from "@/lib/site-url";
import { discardNewAccount } from "@/lib/auth/discard-new-account";

/**
 * "Continue with Google / Apple" on the website's log in and sign up pages
 * (Oct 2026, claude/social-sign-in.md). Sends the browser to the provider;
 * it comes back to /auth/callback, which signs the member in.
 *
 * The callback is built from the page's own origin rather than the site
 * URL: the PKCE half Supabase keeps is a cookie on THIS host, so a member on
 * pinpals.ie must come back to pinpals.ie, not www.
 */
export async function continueWith(formData: FormData): Promise<void> {
  const provider = formData.get("provider");
  if (!isSocialProvider(provider) || !(await enabledSocialProviders()).includes(provider)) {
    redirect("/login?oauth_error=1");
  }

  const origin = (await headers()).get("origin") || getSiteUrl();
  const next = safeRedirectPath(formData.get("next"));
  const callback = new URL("/auth/callback", origin);
  if (next) callback.searchParams.set("next", next);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: callback.toString(),
      queryParams: provider === "google" ? { prompt: "select_account" } : undefined,
    },
  });
  if (error || !data.url) redirect("/login?oauth_error=1");
  redirect(data.url);
}

/**
 * "Connect Google" on Privacy & security (Oct 2026): adds Google as a way in
 * to the signed-in member's own account. Back through /auth/callback to
 * /profile/privacy. Needs "Allow manual linking" on in Supabase.
 */
export async function connectProvider(formData: FormData): Promise<void> {
  const provider = formData.get("provider");
  if (!isSocialProvider(provider) || !(await enabledSocialProviders()).includes(provider)) {
    redirect("/profile/privacy?link_error=1");
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/profile/privacy");

  const origin = (await headers()).get("origin") || getSiteUrl();
  const callback = new URL("/auth/callback", origin);
  callback.searchParams.set("next", `/profile/privacy?linked=${provider}`);

  const { data, error } = await supabase.auth.linkIdentity({
    provider,
    options: {
      redirectTo: callback.toString(),
      queryParams: provider === "google" ? { prompt: "select_account" } : undefined,
    },
  });
  if (error || !data?.url) redirect("/profile/privacy?link_error=1");
  redirect(data.url);
}

/**
 * "Already have a PinPals account? Use that instead" on the website's
 * Finish joining card: removes this brand-new, unused Apple/Google account
 * and signs out, so the member can log in to the one they already have.
 */
export async function useExistingAccount(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const result = await discardNewAccount(user);
  if (!result.ok) redirect("/profile/edit?welcome=1&discard_error=1");
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login?use_existing=1");
}
