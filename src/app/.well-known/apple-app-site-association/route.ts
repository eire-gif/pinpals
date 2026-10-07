/**
 * Apple App Site Association — what makes a pinpals.ie link open the app.
 *
 * Served from a route handler rather than as a file in `public/.well-known/`
 * because Apple requires `application/json` with **no** `.json` extension, and
 * an extensionless static file's content type is whatever the host decides to
 * guess. A route says it outright. It also fails loudly in the build if the
 * JSON is malformed, where a static file would simply serve nonsense and
 * universal links would stop working with no error anywhere.
 *
 * WHAT IS CLAIMED (Oct 2026): every path the app has a native screen for.
 *
 * A universal link takes the path away from Safari for everyone who has the
 * app installed, so only paths the app renders at least as well are claimed.
 * Until October that was `/invite/*`, `/feed/*` and `/s/*`. Every other link
 * in a notification email — a new message, a request for your tee time, an
 * offered place, an order — opened Safari, which members reported as "the
 * notification took me to the website". The app now routes all of them
 * natively, through the same table its in-app alerts use
 * (mobile/src/lib/alert-routes.ts, applied to incoming links in
 * mobile/src/app/+native-intent.tsx), so they are claimed here too.
 *
 * Still left to Safari: course pages (no native equivalent of the full page),
 * news, legal pages, admin, and the two Stripe returns — a Connect onboarding
 * return and a payment confirmation must finish where they started.
 *
 * `/auth/confirm` is claimed for `type=email` only — sign-up confirmation and
 * the magic link — so confirming on a phone signs you into the app
 * (mobile/src/app/auth-confirm.tsx). Password recovery and email change stay
 * on the website, where their forms are.
 *
 * Auth paths are excluded by omission, which matters more than it looks:
 * `/auth/app-session` is the one-time-code redemption the web views use
 * (claude/app-web-session-handoff-summary.md), and it must never be
 * intercepted.
 *
 * The app half is already in place — `ios.associatedDomains` in
 * mobile/app.json lists `applinks:www.pinpals.ie` and `applinks:pinpals.ie`.
 * Apple fetches this file over HTTPS on install and caches it, so a change
 * here is not picked up by a device that already has the app.
 */

const ASSOCIATION = {
  applinks: {
    details: [
      {
        // <Apple Team ID>.<bundle identifier>
        appIDs: ["8UEGCT8434.ie.pinpals.app"],
        components: [
          // Exclusions first: Apple takes the first component that matches.
          {
            "/": "/feed/photo/*",
            exclude: true,
            comment: "Signed photo URLs for the website's feed.",
          },
          {
            "/": "/dashboard/payouts/return*",
            exclude: true,
            comment: "Stripe Connect onboarding return. Finishes on the website.",
          },
          {
            "/": "/dashboard/orders/*",
            "?": { payment_intent: "*" },
            exclude: true,
            comment: "Stripe's return after paying. Finishes on the website.",
          },
          {
            "/": "/auth/confirm",
            "?": { type: "email" },
            comment: "Sign-up confirmation and magic link — signs in to the app.",
          },
          { "/": "/invite/*", comment: "A tee time." },
          { "/": "/feed", comment: "Social." },
          { "/": "/feed/*", comment: "A post." },
          { "/": "/s/*", comment: "A shared post (signed link)." },
          { "/": "/inbox", comment: "Inbox." },
          { "/": "/conversations", comment: "Inbox." },
          { "/": "/conversations/*", comment: "A conversation." },
          { "/": "/tee-times", comment: "Tee times." },
          { "/": "/tee-times/*", comment: "Requests, offered places, confirmed rounds, a round." },
          { "/": "/marketplace", comment: "Marketplace." },
          { "/": "/marketplace/*", comment: "A listing, or listing an item." },
          { "/": "/dashboard", comment: "Home." },
          { "/": "/dashboard/*", comment: "Listings, selling, buying, orders, payouts, connections, settings." },
          { "/": "/members", comment: "Find PinPals." },
          { "/": "/members/*", comment: "A member's page." },
          { "/": "/community", comment: "Find PinPals." },
          { "/": "/live/*", comment: "Live scoring: a scorecard or a match-day board." },
        ],
      },
    ],
  },
};

export function GET() {
  return new Response(JSON.stringify(ASSOCIATION), {
    headers: {
      "content-type": "application/json",
      // Apple re-fetches periodically; an hour is long enough to be cheap and
      // short enough that a correction is not stuck behind a day-long cache.
      "cache-control": "public, max-age=3600",
    },
  });
}
