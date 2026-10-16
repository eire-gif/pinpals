import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./follow.css";

export const metadata: Metadata = {
  title: "Follow the round live · PinPals",
  description: "A golfer is sharing their scorecard with you, live, hole by hole.",
  robots: { index: false, follow: false },
  // Kept generic on purpose: a link preview in a group chat shouldn't name
  // the golfer or the course.
  openGraph: { title: "Follow the round live", description: "A live scorecard, shared from PinPals.", siteName: "PinPals" },
  appleWebApp: { capable: true, title: "PinPals", statusBarStyle: "black-translucent" },
  referrer: "no-referrer",
};

export const viewport: Viewport = { themeColor: "#0c2038", viewportFit: "cover" };

/** Follow my round (0158): no site header or footer (see SiteChromeGate). */
export default function FollowLayout({ children }: { children: ReactNode }) {
  return <div className="fl-root">{children}</div>;
}
