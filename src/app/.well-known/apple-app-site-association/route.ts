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
 * ONLY `/invite/*` IS CLAIMED, deliberately.
 *
 * A universal link takes the path away from Safari for everyone who has the
 * app installed. So claiming a path the app renders worse than the website is
 * a downgrade, not a feature. `/invite/[id]` is the one route with an exact
 * native equivalent. The marketplace is a web view whose deep paths the app
 * cannot currently route to, and `/courses` has no native screen at all —
 * both are better left in Safari until that changes.
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
          {
            "/": "/invite/*",
            comment: "A tee time. The app has a native screen for this.",
          },
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
