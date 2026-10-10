import { appRouteFor } from "./alert-routes";
import { routeForLink, scorecardIdFromShareToken } from "./share-links";

/**
 * Where an incoming pinpals.ie link opens in the app (Oct 2026).
 *
 * Universal links hand the app the whole URL — a link in a notification
 * email, a message, anywhere. The website's apple-app-site-association says
 * which paths come here; this says what each becomes. Pure, so it's tested
 * (incoming-links.test.ts).
 *
 *   /auth/confirm?type=email&token_hash=…  → the app's confirm screen, which
 *                                            signs the member in
 *   /feed/<id>, /s/<token>                 → the post screen (share-links.ts)
 *   /invite/<id>                           → unchanged; it is a screen here
 *   /signup                                → the app's sign-up (a signed-in
 *                                            member is moved on to Home)
 *   /c/<token>                             → card-link: the scorecard if signed
 *                                            in, else the public card (works
 *                                            signed out, like /signup)
 *   anything else                          → appRouteFor(), the same table an
 *                                            in-app alert uses: a native screen,
 *                                            or the signed-in web view
 *
 * Returns null for anything that isn't a pinpals.ie https link — the app's
 * own scheme, Expo's dev URLs — so those pass through untouched.
 */
const SITE = /^https:\/\/(?:www\.)?pinpals\.ie(?=\/|$|\?|#)/i;

export function routeForIncomingUrl(url: string): string | null {
  if (typeof url !== "string" || !SITE.test(url)) return null;

  const rest = url.replace(SITE, "") || "/";
  const [beforeHash] = rest.split("#");
  const [rawPath, query = ""] = beforeHash.split("?");
  const path = rawPath.replace(/\/+$/, "") || "/";

  if (path === "/auth/confirm") {
    const params = new URLSearchParams(query);
    const tokenHash = params.get("token_hash");
    const type = params.get("type");
    if (tokenHash && type === "email") {
      return `/auth-confirm?token_hash=${encodeURIComponent(tokenHash)}&type=email`;
    }
    return webView(beforeHash);
  }

  const post = routeForLink(path);
  if (post) return post;

  if (/^\/invite\/\d+$/.test(path)) return path;

  // A member's invite link or QR code (Find PinPals, 0118).
  const join = /^\/join\/([a-z0-9]{8})$/i.exec(path);
  if (join) return `/join?code=${join[1].toLowerCase()}`;

  // "Invite friends" sends /signup (lib/invite-friends.ts).
  if (path === "/signup") return "/signup";

  const card = /^\/c\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(path);
  if (card) {
    return scorecardIdFromShareToken(card[1]) ? `/card-link?token=${encodeURIComponent(card[1])}` : webView(path);
  }

  const route = appRouteFor(query ? `${path}?${query}` : path);
  return route.kind === "native" ? route.path : webView(route.path);
}

const webView = (sitePath: string) => `/web?path=${encodeURIComponent(sitePath)}&title=PinPals`;
