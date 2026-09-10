import type { LegalDocument, LegalDocumentSlug } from "./types";
import { TERMS } from "./terms";
import { PRIVACY } from "./privacy";
import { MARKETPLACE_RULES } from "./marketplace-rules";
import { COMMUNITY_GUIDELINES } from "./community-guidelines";

import { assertOperatorDetailsComplete } from "./operator";

export type { LegalDocument, LegalDocumentSlug, LegalSection, LegalBlock } from "./types";
export {
  OPERATOR,
  OPERATOR_DETAILS_COMPLETE,
  SUPERVISORY_AUTHORITY,
  operatorFullDescription,
  isProductionDeployment,
  assertOperatorDetailsComplete,
} from "./operator";

// Runs when anything touches the legal registry — which, because the site
// footer imports it, is every page. In a production build that happens
// while prerendering, so an incomplete operator.ts fails `next build`
// rather than shipping documents that name nobody. A no-op everywhere
// else: locally, in CI, on preview deploys, and once the details are set.
assertOperatorDetailsComplete();

/**
 * The registry. Everything that renders, hashes, records or checks a legal
 * document goes through here, so adding a document is one edit: write the
 * file, add it below, and it appears on /legal, in the sign-up modal, in
 * the consent record and in the dashboard automatically.
 *
 * Order matters — it is the order documents are listed and tabbed.
 */
export const LEGAL_DOCUMENTS: readonly LegalDocument[] = [
  TERMS,
  PRIVACY,
  MARKETPLACE_RULES,
  COMMUNITY_GUIDELINES,
] as const;

export { TERMS, PRIVACY, MARKETPLACE_RULES, COMMUNITY_GUIDELINES };

/**
 * The documents a member must accept to create an account.
 *
 * Currently all of them, and deliberately so: the Marketplace Rules and the
 * Community Guidelines are where the substantive obligations actually live,
 * and burying them behind a "see also" link while only the Terms carry a
 * tick is exactly the arrangement that gets a term held to be unfair for
 * not having been brought to the member's attention.
 */
export const SIGNUP_DOCUMENTS: readonly LegalDocument[] = LEGAL_DOCUMENTS;

export function getLegalDocument(slug: string): LegalDocument | undefined {
  return LEGAL_DOCUMENTS.find((doc) => doc.slug === slug);
}

export function isLegalDocumentSlug(value: string): value is LegalDocumentSlug {
  return LEGAL_DOCUMENTS.some((doc) => doc.slug === value);
}

/** Formats a document's effective date for display, e.g. "10 September 2026". */
export function formatEffectiveDate(isoDate: string): string {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return parsed.toLocaleDateString("en-IE", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
