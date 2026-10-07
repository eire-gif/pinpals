import type { Metadata } from "next";
import OpenInApp from "@/components/open-in-app";

export const metadata: Metadata = { title: "Match day · PinPals", robots: { index: false, follow: false } };

export default function MatchDayPage() {
  return <OpenInApp what="the match-day board" />;
}
