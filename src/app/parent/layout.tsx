import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Parent approval · PinPals",
  // The approval link's secret is after the # in this page's address: no
  // referrer, so it can never be passed on to another site from here.
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function ParentLayout({ children }: { children: ReactNode }) {
  return children;
}
