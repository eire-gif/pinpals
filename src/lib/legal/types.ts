/**
 * The shape every Pinpals legal document is written in.
 *
 * Deliberately a small structured format rather than markdown or MDX:
 *
 *  - it renders identically in the sign-up modal, on the public page and
 *    in the dashboard, from one source;
 *  - it serialises deterministically, which is what makes the SHA-256 in
 *    src/lib/legal/hash.ts a meaningful record of "the text this member
 *    was actually shown";
 *  - it has no parser, so no markdown dependency ends up in a client
 *    bundle, and no document can render half-formed because someone typoed
 *    a bracket.
 *
 * The cost is that a document cannot contain arbitrary rich text. That is
 * mostly a feature here: legal copy that needs a table or an embedded image
 * is legal copy that has drifted from being readable.
 */

/** One paragraph, list or callout inside a section. */
export type LegalBlock =
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] }
  /** A visually emphasised paragraph — used sparingly, for the points a member most needs to notice. */
  | { kind: "note"; text: string };

export type LegalSection = {
  /** Stable anchor, e.g. "liability". Referenced from other documents, so don't rename casually. */
  id: string;
  heading: string;
  blocks: LegalBlock[];
};

/** URL segment at /legal/<slug>. */
export type LegalDocumentSlug =
  | "terms"
  | "privacy"
  | "marketplace-rules"
  | "community-guidelines";

export type LegalDocument = {
  slug: LegalDocumentSlug;
  /**
   * The consent_type recorded in member_consent_events for this document
   * (see supabase/migrations/0074_signup_consent_and_private_contact.sql).
   * Underscored rather than hyphenated because it is a database value.
   */
  consentType: "terms" | "privacy" | "marketplace_rules" | "community_guidelines";
  title: string;
  /** Used in tight spaces — modal tabs, dashboard rows. */
  shortTitle: string;
  /**
   * Bump this whenever the text changes in a way a member should re-read.
   * A member whose recorded version is not the current one is prompted to
   * review again at /dashboard/legal. Typo fixes that change no meaning
   * can keep the version; anything touching rights or obligations cannot.
   */
  version: string;
  /** ISO date (YYYY-MM-DD) this version takes effect. */
  effectiveFrom: string;
  /** One line, shown under the title in listings. */
  summary: string;
  /**
   * Plain-English "what you're agreeing to" bullets for the sign-up modal.
   * These are a courtesy summary and say so — the sections below are the
   * agreement. Every bullet must have a section it fairly summarises; a
   * key point with no corresponding clause is how a summary becomes a
   * misrepresentation.
   */
  keyPoints: string[];
  sections: LegalSection[];
};
