"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Leaves out the public site's header and footer on /admin and on /tv (a
 * clubhouse TV shows the leaderboard full screen, nothing else). The admin
 * console has its own bar (with a "View site" link); the public nav stacked
 * above it read as two headers. A client check on the path rather than a
 * route group, so the root layout and its pp_shell handling stay as they are.
 */
export function isAdminPath(pathname: string | null): boolean {
  return !!pathname && (pathname === "/admin" || pathname.startsWith("/admin/"));
}

export function isTvPath(pathname: string | null): boolean {
  return !!pathname && (pathname === "/tv" || pathname.startsWith("/tv/"));
}

export default function SiteChromeGate({ children }: { children: ReactNode }) {
  const path = usePathname();
  return isAdminPath(path) || isTvPath(path) ? null : <>{children}</>;
}
