/**
 * Where an alert should actually take you.
 *
 * Every notification carries an href, and every href is a path on the
 * WEBSITE — `/tee-times/interested`, `/marketplace/412`, `/dashboard/orders/88`
 * — because notifications predate the app by a long way and the website was
 * the only place they could point. The inbox honoured that literally: tapping
 * "You've been offered a place" opened a web view. Being handed the site's own
 * chrome, from inside the app, at the exact moment you wanted to say yes, is
 * the worst version of every screen involved.
 *
 * Most of those destinations are now native screens. This is the table that
 * says which, and it is the only place that knowledge lives — the inbox, and
 * anything else that later needs to open an href, asks here.
 *
 * DELIBERATELY A PURE MODULE. No expo-router, no React, no `supabase` — a
 * string in and a string out. That is what lets it be unit-tested in the
 * website's own vitest run (mobile/src/lib/alert-routes.test.ts), and this
 * mapping is worth testing: getting it wrong means an alert that silently
 * opens the wrong thing, which nobody reports as a bug because it looks like
 * the app merely being unhelpful.
 */

export type AlertRoute =
  /** A screen the app has. `path` is an expo-router pathname. */
  | { kind: "native"; path: string }
  /** No native equivalent — open it in the app's own web view, signed in,
   *  rather than throwing the member out to Safari. */
  | { kind: "web"; path: string };

const native = (path: string): AlertRoute => ({ kind: "native", path });

/**
 * Exact paths. Checked before the patterns below, because several of them
 * would otherwise be swallowed by a looser rule — `/tee-times/interested` is
 * a page, not a tee time with the id "interested".
 */
const EXACT: Record<string, string> = {
  "/": "/",
  "/dashboard": "/",

  "/inbox": "/inbox",
  "/conversations": "/inbox",

  "/tee-times": "/tee-times",
  // The host's side: golfers who want a place in a round you posted.
  "/tee-times/interested": "/tee-time-requests",
  // The applicant's side: rounds you asked to join.
  "/tee-times/requests": "/my-requests",
  "/tee-times/confirmed": "/confirmed-rounds",

  "/marketplace": "/marketplace",
  // Linked from emails and the website; the app has its own forms for both.
  "/marketplace/new": "/new-listing",
  "/dashboard/availability/new": "/post-tee-time",

  "/dashboard/listings": "/my-listings",
  "/dashboard/selling": "/selling",
  "/dashboard/buying": "/buying",
  "/dashboard/orders": "/buying",
  "/dashboard/payouts": "/payouts",
  "/dashboard/connections": "/connections",
  "/dashboard/profile": "/profile",
  "/dashboard/notifications": "/notification-settings",
  "/dashboard/availability": "/my-rounds",
  "/profile/edit": "/edit-profile",

  "/feed": "/feed",

  "/community": "/members",
  "/members": "/members",
  "/courses": "/courses",
};

/**
 * Paths with an id in them.
 *
 * `\d+` rather than `[^/]+` throughout: an id that isn't a number is not one
 * of ours, and passing it through to a screen that will call Number() on it
 * only produces a "not found" further along. Anything unmatched falls through
 * to the web view, which is the honest answer for a path this app has never
 * heard of.
 */
const PATTERNS: { match: RegExp; to: (id: string) => string }[] = [
  { match: /^\/conversations\/(\d+)$/, to: (id) => `/conversation/${id}` },
  { match: /^\/marketplace\/(\d+)$/, to: (id) => `/listing/${id}` },
  { match: /^\/tee-times\/(\d+)$/, to: (id) => `/invite/${id}` },
  // The feed (0088). A like or comment alert points at the post.
  { match: /^\/feed\/(\d+)$/, to: (id) => `/post/${id}` },
  // A member's page is keyed by their uuid, not a number — the one pattern
  // here that is not `\d+`, and still exact: anything that is not a uuid
  // falls through to the web view rather than to a screen that would only
  // say "not found".
  {
    match: /^\/members\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
    to: (id) => `/member/${id}`,
  },

  // Both the order page and its checkout land on the app's order screen. The
  // checkout itself cannot be native — card details are entered in Stripe's
  // own iframe — but the order screen carries a "Pay now" button that opens
  // it, so a member who tapped "this order needs paying" arrives somewhere
  // that says so and can still pay, one tap further on.
  { match: /^\/dashboard\/orders\/(\d+)(?:\/checkout)?$/, to: (id) => `/order/${id}` },
];

/**
 * Strips the query and hash before matching, and keeps them for the web
 * fallback.
 *
 * `/dashboard/buying?tab=delivery` is a real href this app produces (see
 * notifyDeliveryUpdate in src/lib/stripe/payments.ts). The app's Buying
 * screen has no tabs, so the query has nowhere to go — but the path still
 * maps, and dropping someone on Buying is right even if it can't preselect
 * the tab. A web fallback keeps the query, because there it means something.
 */
export function appRouteFor(href: string): AlertRoute {
  // Anything that isn't one of our own relative paths is not something this
  // app should open at all. notificationHref() on the server already refuses
  // to store an absolute URL, so this is a second floor under the same rule
  // rather than the only one.
  if (typeof href !== "string" || !href.startsWith("/") || href.startsWith("//")) {
    return native("/");
  }

  const path = href.split(/[?#]/)[0].replace(/\/+$/, "") || "/";

  const exact = EXACT[path];
  if (exact) return native(exact);

  for (const { match, to } of PATTERNS) {
    const found = path.match(match);
    if (found) return native(to(found[1]));
  }

  // No native screen for this one: golf news, notification settings, a
  // course's own page, anything added to the site since. The web view opens
  // it signed in, with the query intact.
  return { kind: "web", path: href };
}
