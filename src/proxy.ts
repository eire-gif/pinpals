import { type NextRequest } from "next/server";
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
  if (request.nextUrl.pathname.startsWith("/admin")) {
    response.headers.set("Cache-Control", "private, no-store");
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
