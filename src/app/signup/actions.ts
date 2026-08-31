"use server";

import { createClient } from "@/lib/supabase/server";

export type SignUpState = { error?: string; success?: boolean };

export async function signUp(_prev: SignUpState, formData: FormData): Promise<SignUpState> {
  const firstName = String(formData.get("first") || "").trim();
  const lastName = String(formData.get("last") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");

  if (!firstName || !lastName || !email || password.length < 6) {
    return { error: "Please fill in every field — passwords need at least 6 characters." };
  }

  const supabase = await createClient();

  // Prefer an explicit override, then Vercel's own production-domain env var
  // (always set on Vercel, no manual config needed), then the real domain,
  // then localhost for local dev.
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000");

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { first_name: firstName, last_name: lastName },
      emailRedirectTo: `${siteUrl}/auth/confirm`,
    },
  });

  if (error) {
    return { error: error.message };
  }

  return { success: true };
}
