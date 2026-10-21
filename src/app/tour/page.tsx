import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { TOUR_POSTER } from "./chapters";
import { TourPlayer } from "./tour-player";

const title = "The PinPals tour | Golf is better on PinPals";
const description =
  "A 60-second tour of PinPals: find golfers and tee times, live scoring with friends, hole maps, society days, trips away, results and the golf marketplace.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/tour" },
  openGraph: {
    title: "The PinPals tour",
    description,
    type: "video.other",
    siteName: "PinPals",
    url: "https://pinpals.ie/tour",
    images: [{ url: `https://pinpals.ie${TOUR_POSTER}`, width: 1920, height: 1080, alt: "Golf is better on PinPals" }],
  },
  twitter: { card: "summary_large_image", title: "The PinPals tour", description },
};

/**
 * The tour (Oct 2026). Public and shareable: one film of the whole app, built
 * from real screens, with a chapter list to jump to any feature.
 */
export default function TourPage() {
  return (
    <div className="pb-20">
      <div className="relative bg-navy-900 text-white pt-16 pb-36 overflow-hidden">
        <Image src="/images/hero.jpg" alt="" fill priority sizes="100vw" className="object-cover -z-10 opacity-35" />
        <div className="absolute inset-0 bg-gradient-to-b from-[rgba(9,22,40,0.55)] to-[rgba(9,22,40,0.95)] -z-10" />
        <div className="max-w-6xl mx-auto px-6">
          <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-gold-500">
            <span className="w-5 h-0.5 bg-gold-500 inline-block" /> The PinPals tour · 60 seconds
          </span>
          <h1 className="font-display font-bold text-4xl md:text-6xl mt-2.5">Golf is better on PinPals</h1>
          <p className="text-white/80 mt-3 max-w-[60ch]">
            Find a game, play it better, and share it after. Everything PinPals does for you, your
            golf buddies and your society &mdash; shown on the real app.
          </p>
        </div>
      </div>

      <TourPlayer />

      <div className="max-w-6xl mx-auto px-6 mt-14">
        <div className="rounded-2xl bg-navy-900 text-white p-8 md:p-10 flex flex-col md:flex-row md:items-center gap-6 justify-between">
          <div>
            <h2 className="font-display font-bold text-3xl">Bring your society</h2>
            <p className="text-white/75 mt-2 max-w-[52ch]">
              Join free on pinpals.ie today. The iPhone and Android apps are coming soon to the App Store and Google Play.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/signup" className="min-h-11 inline-flex items-center rounded-full bg-gold-500 text-navy-900 font-bold px-6 py-3 hover:bg-gold-400">
              Join PinPals free
            </Link>
            <Link href="/formats" className="min-h-11 inline-flex items-center rounded-full border border-white/30 text-white font-semibold px-6 py-3 hover:bg-white/10">
              Explore game formats
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
