import { postToSite } from "./api";
import { shellPath, webUrl } from "./config";

/**
 * Turns a site path into a URL that opens signed in.
 *
 * The app holds a bearer token; the website reads cookies. Without this, a
 * member who is signed into the app opens the Marketplace tab and the site
 * shows them "Join to buy or bid" — correct behaviour for a visitor it has
 * never met, and baffling for somebody who signed in ten seconds ago.
 *
 * /api/app/web-session mints a single-use token for the member and returns a
 * URL that redeems it and then continues to `path`.
 *
 * MINTED ON EVERY MOUNT, NOT CACHED. Reusing the cookie the web view already
 * holds would save a round trip, and cost correctness: after a member signs
 * out and somebody else signs in — the same phone, a friend at the club — that
 * cookie still names the first member, and the web half of the app would
 * quietly be the wrong person. One small request at mount is a cheap way for
 * that to be impossible.
 */
export async function signedInUrl(path: string): Promise<string> {
  try {
    const { url } = await postToSite<{ url: string }>(
      "/api/app/web-session",
      { next: shellPath(path) }
    );
    return url;
  } catch {
    // Signed out, offline, or the site said no. The public page is still
    // worth showing — browsing works without an account, and the site's own
    // "Join to buy or bid" prompt is the honest thing to display when we
    // could not prove who this is.
    return webUrl(path);
  }
}
