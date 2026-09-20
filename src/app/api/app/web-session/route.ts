import {
  authenticateAppRequest,
  badRequest,
  readJson,
  unauthenticated,
} from "@/lib/app-api";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Hands the app's session to a web view.
 *
 * THE PROBLEM. The app authenticates with a bearer token held in the iOS
 * Keychain. The website authenticates from cookies. So a member who is signed
 * into the app opens the Marketplace tab and the site — correctly — treats
 * them as a stranger: "Join to buy or bid", no favourites, no offers, no
 * messages. Nothing is broken; the two halves simply have no way to introduce
 * themselves.
 *
 * THE EXCHANGE. This route mints a single-use magic-link token for the
 * already-authenticated member and returns a URL carrying it. The app opens
 * that URL in its web view; /auth/app-session redeems it, which sets the
 * cookies, and redirects on to wherever the member was going.
 *
 * WHY NOT JUST SEND THE TOKENS. The obvious shortcut is to pass the access and
 * refresh tokens into the web view and let the page call setSession(). That
 * puts a refresh token — a credential good for months — into page JavaScript,
 * into the WebView's memory, and one bad redirect away from someone else's
 * origin. The magic-link token here is single-use and short-lived, and it can
 * do exactly one thing: start a session for the member who already proved who
 * they were on the line above.
 *
 * WHY THE ADMIN CLIENT IS ALLOWED HERE. Every other /api/app/* route is
 * forbidden the service-role key, because those routes make authorisation
 * decisions and the database must stay the thing that decides them
 * (claude/mobile-app-api-build-spec.md §2). This route makes no authorisation
 * decision at all: authenticateAppRequest() has already established who the
 * caller is, and minting a login token is something only the service role can
 * do. The identity is taken from the verified session, never from the body.
 */

export const dynamic = "force-dynamic";

/**
 * Only same-site, absolute paths. A member-facing redirect that accepts
 * arbitrary input is an open redirect, and an open redirect reached from
 * inside an app with no address bar is a phishing page with extra steps.
 * `//evil.com` is rejected as well as `https://evil.com` — the browser reads
 * the first as protocol-relative.
 */
function safeNext(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

export async function POST(request: Request) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const body = await readJson<{ next?: unknown }>(request);
  const next = safeNext(body?.next);
  if (next === null) return badRequest("next must be a path on this site");

  const email = auth.user.email;
  if (!email) {
    return Response.json(
      { error: "This account has no email address." },
      { status: 409 }
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  // No email is sent — generateLink only mints. A failure here is almost
  // always a banned user, which is exactly what an account awaiting deletion
  // is, so it must not fall through to a working session.
  if (error || !data?.properties?.hashed_token) {
    console.error("[app-session] could not mint a web session", error?.message);
    return Response.json({ error: "Could not sign you in." }, { status: 500 });
  }

  const origin = new URL(request.url).origin;
  const url = new URL("/auth/app-session", origin);
  url.searchParams.set("token_hash", data.properties.hashed_token);
  url.searchParams.set("next", next);

  return Response.json({ url: url.toString() }, { status: 200 });
}
