import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  const response = await updateSession(request);

  // Defense-in-depth, not the only guard: every /admin page already forces
  // dynamic rendering today because requireStaff() reads cookies on every
  // request (see src/app/admin/layout.tsx's own `dynamic` export), so there's
  // no live caching bug this fixes. It's here so a future change — a static
  // export, an intermediate CDN/proxy that caches by default, a page that
  // stops reading cookies — can't silently start serving one staff member's
  // admin response (order details, refund history, another member's private
  // data) to a different viewer from a shared cache. private/no-store beats
  // no-cache here: no-cache still permits a shared cache to store the
  // response (just requires revalidation), which is not an acceptable
  // default for admin data.
  // The same for two-step sign-in (a QR secret) and the member's own
  // privacy pages (their mobile number, their data file).
  const path = request.nextUrl.pathname;
  if (path.startsWith("/admin") || path.startsWith("/two-step") || path.startsWith("/profile")) {
    response.headers.set("Cache-Control", "private, no-store");
  }

  applyShellFlag(request, response);
  rememberAdminPage(request, response);

  return response;
}

/**
 * `?shell=1` says "you are being rendered inside the native app, drop the
 * site's own header and footer".
 *
 * IT HAS TO BE A COOKIE, NOT JUST A QUERY PARAMETER. The app opens one URL and
 * the member then taps links — to a listing, to a seller, to checkout. A
 * parameter is gone by the second page, and the site's navigation reappears
 * underneath the native tab bar. That doubled-up chrome is the clearest tell
 * that an app is a wrapper, and App Store Guideline 4.2 is written for exactly
 * that. A session cookie survives the whole visit.
 *
 * `?shell=0` clears it, so a browser that picked the flag up from a shared or
 * pasted link has a way out that is not "clear your cookies".
 */
function applyShellFlag(request: NextRequest, response: NextResponse): void {
  const shell = request.nextUrl.searchParams.get("shell");
  if (shell === null) return;

  if (shell === "0") {
    response.cookies.delete("pp_shell");
    return;
  }

  response.cookies.set("pp_shell", "1", {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    // Deliberately no maxAge: a session cookie lasts as long as the web view,
    // and does not follow somebody into their own browser a week later.
  });
}

/**
 * Remembers which admin page was asked for, so two-step sign-in can return
 * there afterwards instead of to the Overview. Most useful in the app, where
 * the site's admin menu is hidden: without it, Admin → Advertising landed on
 * the code page and then on Overview, with no way across to Advertising.
 * Only /admin paths, read back and checked again by the two-step page.
 */
function rememberAdminPage(request: NextRequest, response: NextResponse): void {
  const path = request.nextUrl.pathname;
  if (request.method !== "GET" || !(path === "/admin" || path.startsWith("/admin/"))) return;
  // Page loads only — not the background fetches Next makes when it
  // prefetches links, which would overwrite it with wherever the menu points.
  if (request.headers.get("rsc") || request.headers.get("next-router-prefetch")) return;
  const params = new URLSearchParams(request.nextUrl.searchParams);
  params.delete("shell");
  const query = params.toString();
  response.cookies.set("pp_admin_next", query ? `${path}?${query}` : path, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 30,
  });
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
