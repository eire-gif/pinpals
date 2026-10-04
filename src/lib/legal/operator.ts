/**
 * Who, legally, is operating Pinpals.
 *
 * ============ THIS FILE NEEDS REAL VALUES BEFORE LAUNCH ============
 *
 * Two separate obligations both require a trading website to identify its
 * operator by name and address, and neither is satisfied by an email
 * address alone:
 *
 *  - S.I. No. 68/2003 (the E-Commerce Regulations) requires an online
 *    service provider to make its name, geographic address and contact
 *    details easily, directly and permanently accessible.
 *  - Article 13 GDPR requires the identity and contact details of the
 *    data controller to be given to the data subject.
 *
 * Until `OPERATOR_DETAILS_COMPLETE` is true, every legal page and the
 * sign-up modal render a visible warning banner. That is intentional and
 * hard to miss: it is far better for an unfinished detail to be obvious in
 * staging than for a live Privacy Policy to name nobody.
 *
 * Fill in whichever applies:
 *  - a registered company → its registered name, CRO number and registered
 *    office address;
 *  - a sole trader → the individual's name (and registered business name,
 *    if one is registered with the CRO) plus a real geographic address.
 *
 * A data protection officer is very unlikely to be required here (Art. 37
 * triggers are public authorities, large-scale systematic monitoring, or
 * large-scale special-category processing — none of which describes
 * Pinpals today), so `dataProtectionContact` is simply the address
 * data-protection requests should go to, not a DPO appointment.
 */

export const OPERATOR = {
  /** e.g. "Pinpals Limited" or "Jane Murphy trading as Pinpals" */
  legalName: "TODO — registered business or sole trader name",
  /** Companies Registration Office number, or null for a sole trader. */
  croNumber: null as string | null,
  /** Full geographic address. A PO box is not sufficient. */
  address: "TODO — registered office / principal place of business",
  country: "Ireland",
  generalEmail: "info@pinpals.ie",
  /** Where access, erasure and other data-protection requests go. */
  dataProtectionContact: "privacy@pinpals.ie",
  /** Where marketplace and tee-time complaints go. */
  complaintsContact: "info@pinpals.ie",
} as const;

/**
 * False while any TODO remains. Checked by the legal pages and the sign-up
 * modal, which render a warning banner rather than silently publishing a
 * document that identifies nobody.
 */
export const OPERATOR_DETAILS_COMPLETE =
  !OPERATOR.legalName.startsWith("TODO") && !OPERATOR.address.startsWith("TODO");

/**
 * True only for the real production deployment.
 *
 * `VERCEL_ENV` rather than `NODE_ENV` on purpose: NODE_ENV is "production"
 * for preview branch deploys too, and blocking those would make it
 * impossible to look at this work on a preview URL before the company
 * details exist — which is exactly when someone needs to look at it.
 * Locally and in CI the variable is unset, so neither is affected.
 */
export function isProductionDeployment(): boolean {
  return process.env.VERCEL_ENV === "production";
}

/**
 * Refuses to build or serve production with the operator details missing.
 *
 * The first version of this shipped a banner reading "This document is not
 * finished — set them in src/lib/legal/operator.ts", rendered on the public
 * legal pages AND inside the sign-up modal. That is the right message for a
 * developer and completely the wrong thing to show a member: it names a
 * source file, and it tells a prospective member that the terms they are
 * being asked to accept are unfinished.
 *
 * Hiding the banner in production would be worse still — it would mean
 * quietly publishing a Privacy Policy that names no data controller, which
 * is the actual legal defect the banner exists to catch.
 *
 * So production fails loudly and early instead. `next build` evaluates the
 * legal registry while prerendering /legal, so this throws during the build
 * and nothing gets deployed. The fix is one edit to the object above, takes
 * a minute, and has to happen before real sign-ups exist anyway — filling
 * the details in changes every document hash (see hash.ts).
 */
export function assertOperatorDetailsComplete(): void {
  if (OPERATOR_DETAILS_COMPLETE || !isProductionDeployment()) return;

  throw new Error(
    [
      "Pinpals cannot be deployed to production without its operator details.",
      "",
      "src/lib/legal/operator.ts still contains TODO values, so the Terms of",
      "Service and Privacy Policy identify no legal operator and no data",
      "controller. S.I. No. 68/2003 (E-Commerce Regulations) and Article 13",
      "GDPR both require them.",
      "",
      "Set OPERATOR.legalName and OPERATOR.address to the registered business",
      "or sole trader name and a real geographic address, then redeploy.",
      "Preview deployments and local builds are unaffected.",
    ].join("\n")
  );
}

/** "Pinpals Limited (CRO 123456), 1 Fairway Road, Dublin, Ireland" */
export function operatorFullDescription(): string {
  const cro = OPERATOR.croNumber ? ` (CRO ${OPERATOR.croNumber})` : "";
  return `${OPERATOR.legalName}${cro}, ${OPERATOR.address}, ${OPERATOR.country}`;
}

/** The supervisory authority a member has the right to complain to. */
export const SUPERVISORY_AUTHORITY = {
  name: "Data Protection Commission",
  address: "6 Pembroke Row, Dublin 2, D02 X963, Ireland",
  website: "https://www.dataprotection.ie",
} as const;
