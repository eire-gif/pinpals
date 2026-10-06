import { routeForIncomingUrl } from "@/lib/incoming-links";
import { routeForLink } from "@/lib/share-links";

/**
 * Where an incoming link lands (expo-router's native intent hook).
 *
 * The website's apple-app-site-association claims every pinpals.ie path the
 * app has a screen for (Oct 2026) — posts, chats, tee-time requests, orders,
 * listings, sign-up confirmation. Few of those paths exist as screens here
 * under the same name, so each is mapped by lib/incoming-links.ts, where
 * it's tested. Anything else passes through untouched.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    // A pinpals.ie link (Oct 2026: notification emails, sign-up confirmation
    // and more) — see lib/incoming-links.ts. Then the older relative-path
    // mapping, then the path untouched.
    return routeForIncomingUrl(path) ?? routeForLink(path) ?? path;
  } catch {
    // A link that can't be read must not stop the app from opening.
    return path;
  }
}
