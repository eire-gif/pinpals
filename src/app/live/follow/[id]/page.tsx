import type { Metadata } from "next";
import OpenInApp from "@/components/open-in-app";

export const metadata: Metadata = { title: "Follow the round · PinPals", robots: { index: false, follow: false } };

/** A card a PinPal shared with you (0158): it opens in the app. */
export default function LiveFollowPage() {
  return <OpenInApp what="the round you're following" />;
}
