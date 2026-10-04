"use server";

import { headers } from "next/headers";
import { checkRateLimit, rateLimitMessage, resolveClientIp } from "@/lib/rate-limit";
import { signUpMember } from "@/lib/signup";

export type SignUpState = { error?: string; success?: boolean };

// By IP: signup itself is the abuse surface here (mass account creation),
// not any single email address. The app's /api/app/signup shares the bucket.
const SIGNUP_MAX_ATTEMPTS = 5;
const SIGNUP_WINDOW_SECONDS = 60 * 60;

/**
 * The website's sign-up form. Everything that matters — validation, the
 * consent payload, the metadata clean-up — lives in src/lib/signup.ts so the
 * app's sign-up leaves an identical record.
 */
export async function signUp(_prev: SignUpState, formData: FormData): Promise<SignUpState> {
  const rateLimit = await checkRateLimit({
    action: "signup",
    maxHits: SIGNUP_MAX_ATTEMPTS,
    windowSeconds: SIGNUP_WINDOW_SECONDS,
  });
  if (!rateLimit.allowed) {
    return { error: rateLimitMessage(rateLimit.retryAfterSeconds) };
  }

  const headerList = await headers();
  const result = await signUpMember(
    {
      firstName: String(formData.get("first") || ""),
      lastName: String(formData.get("last") || ""),
      email: String(formData.get("email") || ""),
      password: String(formData.get("password") || ""),
      agreedToDocuments: formData.get("agreeDocuments") === "1",
      readPrivacy: formData.get("readPrivacy") === "1",
      confirmedAge: formData.get("confirmAge") === "1",
      marketingEmail: formData.get("marketingEmail") === "on",
      phone: String(formData.get("phone") || ""),
      phoneRegion: String(formData.get("phoneRegion") || "IE"),
      referral: String(formData.get("referral") || ""),
    },
    { ip: await resolveClientIp(), userAgent: headerList.get("user-agent") || "" }
  );

  return result.ok ? { success: true } : { error: result.error };
}
