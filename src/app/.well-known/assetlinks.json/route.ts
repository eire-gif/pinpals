/**
 * Digital Asset Links — Android's counterpart to apple-app-site-association.
 *
 * Android reads https://www.pinpals.ie/.well-known/assetlinks.json when the
 * app is installed and, if the app's signing-certificate fingerprint is
 * listed here, lets the app open pinpals.ie links directly ("verified App
 * Links"). Which paths are claimed lives in the app, not here: the
 * intentFilters in mobile/app.json, which mirror the iOS claim list in
 * ../apple-app-site-association/route.ts.
 *
 * Android cannot exclude by query string the way Apple can, so two iOS
 * exclusions are handled by leaving paths out of the Android list instead:
 * `/dashboard/orders/*` (Stripe's payment return carries `payment_intent` on
 * the same path) and `/dashboard/payouts/return` (only the exact
 * `/dashboard/payouts` is claimed). `/auth/app-session` is never claimed.
 *
 * FINGERPRINTS — empty until the first Android build (Oct 2026). Add:
 *   1. the EAS upload key's SHA-256 (`eas credentials -p android`), so
 *      internal test builds verify; and later
 *   2. Google Play's app-signing key SHA-256 (Play Console → Test and release
 *      → App integrity), once the Play account exists. Builds installed from
 *      the Play Store are signed with that key, not the upload key.
 * With the list empty the file is still valid; Android simply opens links in
 * the browser, which is what happens today.
 */

const SHA256_CERT_FINGERPRINTS: string[] = [];

const ASSET_LINKS = SHA256_CERT_FINGERPRINTS.length
  ? [
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "ie.pinpals.app",
          sha256_cert_fingerprints: SHA256_CERT_FINGERPRINTS,
        },
      },
    ]
  : [];

export function GET() {
  return new Response(JSON.stringify(ASSET_LINKS), {
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=3600",
    },
  });
}
