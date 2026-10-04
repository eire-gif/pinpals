import { routeForLink } from "@/lib/share-links";

/**
 * Where an incoming link lands (expo-router's native intent hook).
 *
 * pinpals.ie/feed/<id> and pinpals.ie/s/<token> open the app (the website's
 * apple-app-site-association claims both, phase 6); neither path exists as
 * a screen here, so they're mapped to the post screen. Everything else —
 * /invite/<id>, which matches a screen of its own, and anything unknown —
 * passes through untouched. The mapping lives in lib/share-links.ts, where
 * it's tested.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    return routeForLink(path) ?? path;
  } catch {
    // A link that can't be read must not stop the app from opening.
    return path;
  }
}
