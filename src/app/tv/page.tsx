import type { Metadata } from "next";

import PairScreen from "./pair-screen";

export const metadata: Metadata = { title: "PinPals · Clubhouse screen", robots: { index: false, follow: false } };

/** pinpals.ie/tv — open this on the TV; it shows a code to pair from the app. */
export default function TvPage() {
  return <PairScreen />;
}
