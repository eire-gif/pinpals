import type { Metadata } from "next";
import OpenInApp from "@/components/open-in-app";

export const metadata: Metadata = { title: "Results · PinPals", robots: { index: false, follow: false } };

/** A results notification opened on the web: the results live in the app
 *  (and, once shared, on the public /results/<token> page). */
export default function DayResultsPage() {
  return <OpenInApp what="the results" />;
}
