"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Leaves out the public site's header and footer on /admin, /follow and /tv (a
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

/** A followed round (/follow#<link>, 0158): a phone-first card a parent
 *  opens from a text, with its own small PinPals footer. */
export function isFollowPath(pathname: string | null): boolean {
  return !!pathname && (pathname === "/follow" || pathname.startsWith("/follow/"));
}

export default function SiteChromeGate({ children }: { children: ReactNode }) {
  const path = usePathname();
  return isAdminPath(path) || isTvPath(path) || isFollowPath(path) ? null : <>{children}</>;
}
