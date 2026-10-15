import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./tv.css";

export const metadata: Metadata = {
  title: "PinPals on TV",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#0c2038" };

/** Clubhouse TV screens: full screen, no site header or footer (see
 *  SiteChromeGate). */
export default function TvLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
