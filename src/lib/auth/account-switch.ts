/**
 * Stops an emailed or app sign-in link silently swapping the account a
 * browser is already signed in to.
 *
 * The attack (security review, Oct 2026): someone asks for a sign-in link to
 * their OWN account and sends it to a member. Opening it replaced the
 * member's session with the attacker's, so whatever the member did next —
 * a card at checkout, payout details, messages, photos — landed in the
 * attacker's account. A real pinpals.ie link, nothing looked wrong.
 *
 * Now, when a browser that's already signed in opens such a link, the routes
 * send it to /auth/switch, which names the account they're in and asks. Only
 * "Continue" goes on — as a POST from our own page. A link can't skip the
 * question (a link is a GET), and another site can't post the form for them
 * (checked by sameOrigin below; the browser always sends Origin on a POST).
 */

/** The two routes that redeem sign-in links. */
export const SWITCH_ROUTES = ["/auth/confirm", "/auth/app-session"] as const;

/** Query parameters the routes read — the only ones /auth/switch carries over. */
export const SWITCH_PARAMS = ["token_hash", "type", "next", "code", "uid"] as const;

/** The /auth/switch address for a link that would change accounts. */
export function switchPageUrl(requestUrl: URL): URL {
  const to = new URL("/auth/switch", requestUrl.origin);
  to.searchParams.set("route", requestUrl.pathname);
  for (const key of SWITCH_PARAMS) {
    const value = requestUrl.searchParams.get(key);
    if (value !== null) to.searchParams.set(key, value);
  }
  return to;
}

/** One of our own sign-in routes, or null. */
export function switchRoute(value: unknown): (typeof SWITCH_ROUTES)[number] | null {
  return SWITCH_ROUTES.find((r) => r === value) ?? null;
}

/** A POST that came from a page on this site (not another site's form). */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

/** The fields a confirmed POST to a sign-in route carries, as a URLSearchParams. */
export async function postedParams(request: Request): Promise<URLSearchParams> {
  const out = new URLSearchParams();
  try {
    const form = await request.formData();
    for (const key of SWITCH_PARAMS) {
      const value = form.get(key);
      if (typeof value === "string") out.set(key, value);
    }
  } catch {
    // Not a form: nothing carried over, which the routes treat as a bad link.
  }
  return out;
}
