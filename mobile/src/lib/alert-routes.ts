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
  // Groups (0120).
  "/groups": "/groups",

  "/community": "/members",
  "/members": "/members",
  "/courses": "/courses",
  "/compete": "/compete",
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
const PATTERNS: { match: RegExp; to: (id: string, id2: string) => string }[] = [
  { match: /^\/conversations\/(\d+)$/, to: (id) => `/conversation/${id}` },
  { match: /^\/marketplace\/(\d+)$/, to: (id) => `/listing/${id}` },
  // Cash marketplace (0160): "leave feedback" alerts, and a seller's page.
  { match: /^\/marketplace\/feedback\/(\d+)$/, to: (id) => `/feedback/${id}` },
  {
    match: /^\/marketplace\/sellers\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
    to: (id) => `/seller/${id}`,
  },
  { match: /^\/tee-times\/(\d+)$/, to: (id) => `/invite/${id}` },
  // The feed (0088). A like or comment alert points at the post.
  { match: /^\/feed\/(\d+)$/, to: (id) => `/post/${id}` },
  // Live scoring (0103/0104): "you're in a match" opens the scorecard, a
  // match result opens the match-day board.
  { match: /^\/live\/rounds\/(\d+)$/, to: (id) => `/live/round/${id}` },
  { match: /^\/live\/days\/(\d+)$/, to: (id) => `/live/day/${id}` },
  // Follow my round (0158): a PinPal shared their card, a birdie on it, the finish.
  { match: /^\/live\/follow\/(\d+)$/, to: (id) => `/live/follow/${id}` },
  // Competition results (0137): "the results are in" opens them.
  { match: /^\/live\/days\/(\d+)\/results$/, to: (id) => `/live/day/results/${id}` },
  // Competitions (0148): a draw, a result to confirm, a challenge. These
  // hrefs exist only in the app; `match` before the plain id.
  { match: /^\/compete\/match\/(\d+)$/, to: (id) => `/compete/match/${id}` },
  { match: /^\/compete\/(\d+)$/, to: (id) => `/compete/${id}` },
  // Scorecard certification (0128): "certify my card" opens the request; the
  // answer opens your card. `certify` before the plain id, which is \d+ only.
  { match: /^\/scorecards\/certify\/(\d+)$/, to: (id) => `/scorecards/certify/${id}` },
  { match: /^\/scorecards\/(\d+)$/, to: (id) => `/scorecards/${id}` },
  // Groups (0120): an invitation, a join request or an approval opens the group.
  { match: /^\/groups\/(\d+)$/, to: (id) => `/group/${id}` },
  // Societies (0142–0144): an event, the noticeboard, membership.
  { match: /^\/groups\/(\d+)\/events\/(\d+)$/, to: (id, outing) => `/group/${id}/outing/${outing}` },
  { match: /^\/groups\/(\d+)\/noticeboard$/, to: (id) => `/group/${id}/noticeboard` },
  { match: /^\/groups\/(\d+)\/membership$/, to: (id) => `/group/${id}/membership` },
  // A shared tee time link (0132): "X invited you to play" opens the round,
  // through tee-link, which adds you to it first. A signed token, not an id.
  { match: /^\/t\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/, to: (token) => `/tee-link?token=${encodeURIComponent(token)}` },
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

  // ONE TEE TIME, NOT THE LIST (Oct 2026). A tee-time alert names the round
  // it's about (?invite=<id>), so it opens that round rather than a list to
  // scroll through: the golfer offered a place lands on the tee time with
  // Confirm my place on it, and stays there after confirming; the host lands
  // on the requests for that one round.
  const focus = teeTimeFocus(href);
  if (focus !== null) {
    if (path === "/tee-times/interested") return native(`/tee-time-requests?invite=${focus}`);
    if (path === "/tee-times/requests" || path === "/tee-times/confirmed") return native(`/invite/${focus}`);
  }

  const exact = EXACT[path];
  if (exact) return native(exact);

  for (const { match, to } of PATTERNS) {
    const found = path.match(match);
    if (found) return native(to(found[1], found[2]));
  }

  // No native screen for this one: golf news, notification settings, a
  // course's own page, anything added to the site since. The web view opens
  // it signed in, with the query intact.
  return { kind: "web", path: href };
}

/** The tee-time lists an alert can point at, which take ?invite=<id>. */
const TEE_TIME_LISTS = new Set(["/tee-times/interested", "/tee-times/requests", "/tee-times/confirmed"]);

/** The tee time an href is about (?invite=<id>), or null. */
export function teeTimeFocus(href: string): number | null {
  const path = href.split(/[?#]/)[0].replace(/\/+$/, "");
  if (!TEE_TIME_LISTS.has(path)) return null;
  const query = href.split("#")[0].split("?")[1] ?? "";
  const raw = new URLSearchParams(query).get("invite");
  return raw && /^\d{1,15}$/.test(raw) && Number(raw) > 0 ? Number(raw) : null;
}

/**
 * Older alerts were sent before their href named the tee time; their data
 * still carries inviteId. This adds it, so tapping one of those opens the
 * round too. Anything else is returned as it was.
 */
export function withTeeTimeFocus(href: string, inviteId: unknown): string {
  if (typeof inviteId !== "number" || !Number.isInteger(inviteId) || inviteId <= 0) return href;
  if (href.includes("?") || href.includes("#")) return href;
  const path = href.replace(/\/+$/, "");
  return TEE_TIME_LISTS.has(path) ? `${path}?invite=${inviteId}` : href;
}

// ---------------------------------------------------------------------------
// Junior members (0159)
// ---------------------------------------------------------------------------

/** Alerts that change what the app shows rather than open a page. */
const REFRESH_AGE = new Set(["age_band_changed", "parent_link_approved"]);

/**
 * What tapping an alert of this type does besides following its href.
 *
 * "You're 16 now" / "Your parent said yes" (age_band_changed,
 * parent_link_approved) carry no href — what they're about is the whole app
 * changing. The tap fetches a fresh age answer (lib/age.ts) and goes Home,
 * where the newly opened parts now are.
 */
export function alertAction(type: string | null | undefined): "refreshAge" | null {
  return type && REFRESH_AGE.has(type) ? "refreshAge" : null;
}

/**
 * The href an alert row should open: its own, or — for an alert that only
 * names a listing (junior_ask_parent: "Ella would like this") — the
 * listing's page. `/dashboard` (→ Home) when there's nothing better.
 */
export function alertHref(
  type: string,
  data: { href?: unknown; listingId?: unknown; listing_id?: unknown } | null | undefined
): string {
  const href = typeof data?.href === "string" && data.href.startsWith("/") ? data.href : null;
  if (href) return href;
  // The website's ask-parent route stores it as listing_id.
  const listing = data?.listing_id ?? data?.listingId;
  if (type === "junior_ask_parent" && typeof listing === "number" && Number.isInteger(listing) && listing > 0) {
    return `/marketplace/${listing}`;
  }
  return "/dashboard";
}
