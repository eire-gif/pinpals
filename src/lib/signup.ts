import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SIGNUP_DOCUMENTS } from "@/lib/legal";
import { documentSha256 } from "@/lib/legal/hash";
import { isReferralSource } from "@/lib/consent";
import { normalisePhone, isPhoneRegion } from "@/lib/phone";
import { passwordProblem } from "@/lib/passwords";
import { getSiteUrl } from "@/lib/site-url";

/**
 * Creating a member account — the one implementation behind both doors.
 *
 * The website's Server Action (src/app/signup/actions.ts) and the app's
 * /api/app/signup route both call this. Two copies of sign-up would drift
 * the first time anyone touched consent, and consent is the part where
 * drifting is not a cosmetic bug: a member who joined through the app must
 * leave exactly the same record, against exactly the same document hashes,
 * as one who joined on the website.
 *
 * Rate limiting stays with the callers. Both use the same "signup" bucket,
 * so a script cannot double its allowance by alternating doors.
 */

/** A long user-agent string is not worth carrying; the first 300 chars identify a client fine. */
const MAX_USER_AGENT_LENGTH = 300;

export type SignUpInput = {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  agreedToDocuments: boolean;
  readPrivacy: boolean;
  confirmedAge: boolean;
  marketingEmail: boolean;
  phone?: string;
  phoneRegion?: string;
  referral?: string;
};

export type SignUpEvidence = {
  /** "unknown" when it could not be resolved. */
  ip: string;
  userAgent: string;
};

export type SignUpResult = { ok: true } | { ok: false; error: string };

/**
 * The consent payload handed to handle_new_user() through user metadata.
 *
 * Versions and hashes are computed HERE, server-side, from the document
 * registry — never taken from the client. The form (or the app) only tells
 * us which boxes were ticked; what those boxes referred to is decided by the
 * code that rendered them. A client that could name its own version string
 * could claim a member accepted anything.
 */
export function recordedConsentsFor(input: {
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
    // The Privacy Policy is acknowledged by its own tick on the website — it
    // is an Article 13 notice, not a term of the contract. The app shows a
    // single tick whose wording names both, and sends both flags from it.
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
  // was never asked.
  consents.push({ type: "marketing_email", granted: input.marketingEmail });

  return consents;
}

/** The checks that need no network. Exported so both callers and the tests share them. */
export function validateSignUp(input: SignUpInput): string | null {
  if (!input.firstName.trim() || !input.lastName.trim() || !input.email.trim()) {
    return "Please fill in your name and email address.";
  }
  const passwordIssue = passwordProblem(input.password);
  if (passwordIssue) return passwordIssue;

  // Checked server-side even though the button is disabled without it. A
  // disabled button is a courtesy to the member, not a control.
  if (!input.agreedToDocuments || !input.readPrivacy) {
    return "Please read and agree to the Pinpals terms and privacy policy to continue.";
  }
  if (!input.confirmedAge) {
    return "You need to be 18 or over to join Pinpals.";
  }
  return null;
}

export async function signUpMember(
  input: SignUpInput,
  evidence: SignUpEvidence
): Promise<SignUpResult> {
  const problem = validateSignUp(input);
  if (problem) return { ok: false, error: problem };

  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const email = input.email.trim();

  const phoneRegionRaw = input.phoneRegion || "IE";
  const phoneRegion = isPhoneRegion(phoneRegionRaw) ? phoneRegionRaw : "IE";
  const phoneResult = normalisePhone(input.phone || "", phoneRegion);
  if (!phoneResult.ok) return { ok: false, error: phoneResult.error };

  const referralRaw = (input.referral || "").trim();
  const referral = referralRaw && isReferralSource(referralRaw) ? referralRaw : null;

  const supabase = await createClient();

  // ============ Why the consent travels in user metadata ============
  // Email confirmation is on, so signUp() returns no session: nothing done
  // afterwards could satisfy `auth.uid() = user_id` on member_consent_events.
  // Metadata is the one channel that reaches the database inside the same
  // transaction that creates the user, where handle_new_user() (migration
  // 0089) unpacks it. Consent and account are created together or not at all.
  //
  // The confirmation email carries BOTH the link (website sign-ups click it)
  // and a 6-digit code (the app asks for it, so a new member never has to
  // leave the app to finish joining). One template serves both: see
  // supabase/templates/confirmation.html.
  const { data, error } = await supabase.auth.signUp({
    email,
    password: input.password,
    options: {
      data: {
        first_name: firstName,
        last_name: lastName,
        phone_e164: phoneResult.e164 ?? "",
        signup_referral_source: referral ?? "",
        signup_ip: evidence.ip === "unknown" ? "" : evidence.ip,
        signup_user_agent: evidence.userAgent.slice(0, MAX_USER_AGENT_LENGTH),
        consents: recordedConsentsFor(input),
      },
      emailRedirectTo: `${getSiteUrl()}/auth/confirm`,
    },
  });

  if (error) return { ok: false, error: error.message };

  // ============ Clearing the transient metadata ============
  // The trigger has consumed it by now, and user_metadata is echoed into
  // every access token this member is ever issued — there is no reason for
  // their IP address and a consent payload to ride along in a JWT for the
  // life of the account. Best-effort: it is expected to fail for the
  // obfuscated user Supabase returns when the address is already registered,
  // which is the enumeration defence we want, so it must not change what we
  // tell the member either way.
  if (data.user?.id) {
    try {
      const admin = createAdminClient();
      await admin.auth.admin.updateUserById(data.user.id, {
        user_metadata: { first_name: firstName, last_name: lastName },
      });
    } catch (cleanupError) {
      console.error("signUpMember: could not clear transient signup metadata:", cleanupError);
    }
  }

  return { ok: true };
}
