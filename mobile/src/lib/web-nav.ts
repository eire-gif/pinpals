/**
 * Where a navigation inside the in-app web view (WebShell) should go.
 * Pure, so it can be tested without a device (web-nav.test.ts).
 *
 * WHY THIS EXISTS. WebShell used to pass originWhitelist={[`${SITE_URL}/*`]}.
 * react-native-webview compares that pattern with the page's ORIGIN
 * ("https://www.pinpals.ie" — no path, no trailing slash), so "…/*" never
 * matched, and the library's own fallback for a non-matching URL is
 * Linking.openURL(): the page opened in Safari, where the member isn't signed
 * in — the PinPals sign-in page. That is what tapping Admin → Advertising did
 * on an iPhone (Oct 2026). WebShell now lets every navigation through the
 * library and decides here instead, with exact host matching.
 */

/** PinPals' own hosts. Both, because the site can be reached with or without www. */
export const PINPALS_HOSTS = new Set(["www.pinpals.ie", "pinpals.ie"]);

export type WebNavDecision =
  /** Load it in the app. */
  | "stay"
  /** Somewhere else (Stripe, an advertiser's site): hand it to the phone's browser. */
  | "external"
  /** Not something to open at all (javascript:, a malformed URL). */
  | "block";

export function isPinPalsUrl(url: string, extraHost?: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (PINPALS_HOSTS.has(u.hostname) || u.hostname === extraHost);
  } catch {
    return false;
  }
}

/**
 * @param url        the URL being loaded
 * @param isTopFrame false for an iframe inside the page (e.g. a Stripe field) — those
 *                   load in place; only whole-page navigations are routed
 * @param extraHost  the host of SITE_URL, in case a build points somewhere else (staging)
 */
export function decideWebNav(url: string, isTopFrame = true, extraHost?: string): WebNavDecision {
  if (url === "about:blank" || url.startsWith("about:srcdoc")) return "stay";
  if (isPinPalsUrl(url, extraHost)) return "stay";
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    return "block";
  }
  if (!isTopFrame) return protocol === "https:" ? "stay" : "block";
  if (protocol === "https:" || protocol === "http:" || protocol === "mailto:" || protocol === "tel:") return "external";
  return "block";
}

/** The host of a URL, or undefined. */
export function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}
