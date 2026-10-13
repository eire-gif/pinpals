"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Leaves out the public site's header and footer on /admin. The admin
 * console has its own bar (with a "View site" link); the public nav stacked
 * above it read as two headers. A client check on the path rather than a
 * route group, so the root layout and its pp_shell handling stay as they are.
 */
export function isAdminPath(pathname: string | null): boolean {
  return !!pathname && (pathname === "/admin" || pathname.startsWith("/admin/"));
}

export default function SiteChromeGate({ children }: { children: ReactNode }) {
  return isAdminPath(usePathname()) ? null : <>{children}</>;
}
