import { LEGAL_DOCUMENTS } from "@/lib/legal";

/**
 * Consent types, row shapes and labels for the sign-up agreement record.
 *
 * Types live here rather than in src/lib/types.ts because they are only
 * meaningful alongside the document registry they refer to, and because
 * `consent_type` has to stay in step with three things at once: the CHECK
 * constraint in supabase/migrations/0074_signup_consent_and_private_contact.sql,
 * the `consentType` field on each document in src/lib/legal/, and the
 * labels below. Keeping them in one file makes that obvious; spreading
 * them across the codebase is how they drift.
 */

/** Must match the CHECK constraint on member_consent_events.consent_type. */
export const CONSENT_TYPES = [
  "terms",
  "privacy",
  "marketplace_rules",
  "community_guidelines",
  "age_18_declaration",
  "marketing_email",
] as const;

export type ConsentType = (typeof CONSENT_TYPES)[number];

/** Consent types that carry a document version and hash. */
export type DocumentConsentType = "terms" | "privacy" | "marketplace_rules" | "community_guidelines";

export const CONSENT_SOURCES = ["signup", "dashboard", "re_acceptance", "admin"] as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[number];

export type MemberConsentEvent = {
  id: string;
  user_id: string;
  consent_type: ConsentType;
  granted: boolean;
  document_version: string | null;
  content_sha256: string | null;
  source: ConsentSource;
  ip_address: string | null;
  user_agent: string | null;
  occurred_at: string;
};

/** A row of public.member_current_consents — the latest event per type. */
export type MemberCurrentConsent = Pick<
  MemberConsentEvent,
  "user_id" | "consent_type" | "granted" | "document_version" | "content_sha256" | "occurred_at"
>;

export type MemberPrivateDetails = {
  user_id: string;
  phone_e164: string | null;
  signup_referral_source: string | null;
  created_at: string;
  updated_at: string;
};

export const CONSENT_LABELS: Record<ConsentType, string> = {
  terms: "Terms of Service",
  privacy: "Privacy Policy",
  marketplace_rules: "Marketplace Rules",
  community_guidelines: "Community & Tee-Time Guidelines",
  age_18_declaration: "Confirmation that you are 18 or over",
  marketing_email: "Weekly Pinpals golf digest",
};

/**
 * The document consent types, derived from the registry rather than
 * re-listed, so that adding a document cannot leave this behind.
 */
export const DOCUMENT_CONSENT_TYPES: readonly DocumentConsentType[] = LEGAL_DOCUMENTS.map(
  (doc) => doc.consentType
);

export function isDocumentConsentType(value: string): value is DocumentConsentType {
  return (DOCUMENT_CONSENT_TYPES as readonly string[]).includes(value);
}

/**
 * "How did you hear about us?" — optional, and kept short on purpose.
 *
 * It exists because Pinpals is launching with no members and no budget, so
 * knowing which of the organic channels actually works is worth more than
 * usual. It is a fixed list rather than a free-text box so that it can be
 * counted, and so that a member cannot accidentally type personal data
 * into a field that has no business holding any.
 */
export const REFERRAL_SOURCES = [
  { value: "friend", label: "A friend or playing partner" },
  { value: "club", label: "At my golf club" },
  { value: "search", label: "Google or another search engine" },
  { value: "social", label: "Social media" },
  { value: "press", label: "An article, podcast or newsletter" },
  { value: "other", label: "Somewhere else" },
] as const;

export type ReferralSource = (typeof REFERRAL_SOURCES)[number]["value"];

export function isReferralSource(value: string): value is ReferralSource {
  return REFERRAL_SOURCES.some((source) => source.value === value);
}
