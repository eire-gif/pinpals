"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitMessage, resolveClientIp } from "@/lib/rate-limit";
import { SIGNUP_DOCUMENTS } from "@/lib/legal";
import { documentSha256 } from "@/lib/legal/hash";
import { isReferralSource } from "@/lib/consent";
import { normalisePhone, isPhoneRegion } from "@/lib/phone";
import { passwordProblem } from "@/lib/passwords";

export type SignUpState = { error?: string; success?: boolean };

// By IP: signup itself is the abuse surface here (mass account creation),
// not any single email address.
const SIGNUP_MAX_ATTEMPTS = 5;
const SIGNUP_WINDOW_SECONDS = 60 * 60;



/** A long user-agent string is not worth carrying; the first 300 chars identify a browser fine. */
const MAX_USER_AGENT_LENGTH = 300;

/**
 * The consent payload handed to handle_new_user() through user metadata.
 *
 * Versions and hashes are computed HERE, server-side, from the document
 * registry — never taken from the form. The browser only ever tells us
 * which boxes were ticked; what those boxes referred to is decided by the
 * code that rendered them. A client that could name its own version string
 * could claim a member accepted anything.
 */
function recordedConsentsFor(input: {
  agreedToDocuments: boolean;
  readPrivacy: boolean;
  confirmedAge: boolean;
  marketingEmail: boolean;
}) {
  const consents: {
    type: string;
    granted: boolean;
    version?: string;
    sha256?: string;
  }[] = [];

  for (const doc of SIGNUP_DOCUMENTS) {
    // The Privacy Policy is acknowledged by its own tick — it is an
    // Article 13 notice, not a term of the contract, and the two are
    // deliberately not the same box. See consent-modal.tsx.
    const granted = doc.consentType === "privacy" ? input.readPrivacy : input.agreedToDocuments;
    consents.push({
      type: doc.consentType,
      granted,
      version: doc.version,
      sha256: documentSha256(doc),
    });
  }

  consents.push({ type: "age_18_declaration", granted: input.confirmedAge });

  // Recorded either way. An explicit "no" is worth as much as a "yes" here:
  // it is the difference between a member who declined and a member who
  // was never asked, and only one of those can be emailed later after a
  // change of mind without new consent.
  consents.push({ type: "marketing_email", granted: input.marketingEmail });

  return consents;
}

export async function signUp(_prev: SignUpState, formData: FormData): Promise<SignUpState> {
  const rateLimit = await checkRateLimit({
    action: "signup",
    maxHits: SIGNUP_MAX_ATTEMPTS,
    windowSeconds: SIGNUP_WINDOW_SECONDS,
  });
  if (!rateLimit.allowed) {
    return { error: rateLimitMessage(rateLimit.retryAfterSeconds) };
  }

  const firstName = String(formData.get("first") || "").trim();
  const lastName = String(formData.get("last") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");

  if (!firstName || !lastName || !email) {
    return { error: "Please fill in your name and email address." };
  }
  const passwordIssue = passwordProblem(password);
  if (passwordIssue) {
    return { error: passwordIssue };
  }

  // ============ Consent ============
  // Checked server-side even though the submit button is disabled without
  // it. A disabled button is a courtesy to the member, not a control: the
  // form posts perfectly well without one, and an account whose consent
  // record says "not granted" is worse than no account at all.
  const agreedToDocuments = formData.get("agreeDocuments") === "1";
  const readPrivacy = formData.get("readPrivacy") === "1";
  const confirmedAge = formData.get("confirmAge") === "1";
  const marketingEmail = formData.get("marketingEmail") === "on";

  if (!agreedToDocuments || !readPrivacy) {
    return { error: "Please read and agree to the Pinpals terms and privacy policy to continue." };
  }
  if (!confirmedAge) {
    return { error: "You need to be 18 or over to join Pinpals." };
  }

  // ============ Optional fields ============
  const phoneRegionRaw = String(formData.get("phoneRegion") || "IE");
  const phoneRegion = isPhoneRegion(phoneRegionRaw) ? phoneRegionRaw : "IE";
  const phoneResult = normalisePhone(String(formData.get("phone") || ""), phoneRegion);
  if (!phoneResult.ok) {
    return { error: phoneResult.error };
  }

  const referralRaw = String(formData.get("referral") || "").trim();
  const referral = referralRaw && isReferralSource(referralRaw) ? referralRaw : null;

  // ============ Evidence ============
  // Both captured here rather than sent by the browser, for the obvious
  // reason: a self-reported IP address proves nothing.
  const signupIp = await resolveClientIp();
  const headerList = await headers();
  const userAgent = (headerList.get("user-agent") || "").slice(0, MAX_USER_AGENT_LENGTH);

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

  // ============ Why the consent travels in user metadata ============
  // Email confirmation is on, so signUp() returns no session: nothing this
  // Server Action could do afterwards would satisfy `auth.uid() = user_id`
  // on member_consent_events. Metadata is the one channel that reaches the
  // database inside the same transaction that creates the user, where
  // handle_new_user() (migration 0074) unpacks it. Consent and account are
  // therefore created together or not at all — which is the whole point of
  // keeping a consent record.
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        first_name: firstName,
        last_name: lastName,
        phone_e164: phoneResult.e164 ?? "",
        signup_referral_source: referral ?? "",
        signup_ip: signupIp === "unknown" ? "" : signupIp,
        signup_user_agent: userAgent,
        consents: recordedConsentsFor({
          agreedToDocuments,
          readPrivacy,
          confirmedAge,
          marketingEmail,
        }),
      },
      emailRedirectTo: `${siteUrl}/auth/confirm`,
    },
  });

  if (error) {
    return { error: error.message };
  }

  // ============ Clearing the transient metadata ============
  // The trigger has consumed it by now, and user_metadata is echoed into
  // every access token this member is ever issued — there is no reason for
  // their IP address and a consent payload to ride along in a JWT header
  // for the life of the account. Reset it to the two fields the app
  // actually reads back.
  //
  // Best-effort on purpose: if it fails the member still has an account, a
  // profile and a consent record, which are the things that matter. It is
  // also expected to fail for the deliberately obfuscated user object
  // Supabase returns when the address is already registered — which is
  // exactly the enumeration defence we want, so it must not change what we
  // tell the member either way.
  if (data.user?.id) {
    try {
      const admin = createAdminClient();
      await admin.auth.admin.updateUserById(data.user.id, {
        user_metadata: { first_name: firstName, last_name: lastName },
      });
    } catch (cleanupError) {
      console.error("signUp: could not clear transient signup metadata:", cleanupError);
    }
  }

  return { success: true };
}
