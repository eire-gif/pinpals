import type { Metadata } from "next";
import OpenInApp from "@/components/open-in-app";

export const metadata: Metadata = { title: "Live scoring · PinPals", robots: { index: false, follow: false } };

export default function LiveRoundPage() {
  return <OpenInApp what="your scorecard" />;
}
