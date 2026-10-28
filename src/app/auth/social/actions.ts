"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { enabledSocialProviders, isSocialProvider } from "@/lib/auth/social-providers";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { getSiteUrl } from "@/lib/site-url";

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
