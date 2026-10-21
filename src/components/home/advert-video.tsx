"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

import { TOUR_POSTER, TOUR_VIDEO } from "@/app/tour/chapters";

/**
 * The 60-second PinPals advert on the home page (Oct 2026). Silent, so it
 * plays muted on its own once it scrolls into view and pauses when it
 * leaves — nothing downloads beyond the metadata until someone gets there.
 */
export function AdvertVideo() {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v || typeof IntersectionObserver === "undefined") return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && !reduce) void v.play().catch(() => {});
        else v.pause();
      },
      { threshold: 0.4 },
    );
    io.observe(v);
    return () => io.disconnect();
  }, []);

  return (
    <section className="py-20 md:py-24 border-b border-white/5">
      <div className="max-w-[1240px] mx-auto px-5 md:px-10 flex flex-col gap-8">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="flex flex-col gap-3 max-w-[640px]">
            <span className="inline-flex items-center gap-2 text-xs font-bold tracking-[.18em] uppercase text-gold-400">
              <span className="w-5 h-0.5 bg-gold-400 inline-block" /> See it in 60 seconds
            </span>
            <h2 className="font-display font-semibold text-4xl md:text-[52px] leading-[1.08] text-white">
              The whole app, in a minute.
            </h2>
          </div>
          <Link
            href="/tour"
            className="min-h-11 inline-flex items-center px-6 py-3 rounded-full font-bold border-[1.5px] border-white/55 bg-white/5 hover:bg-white/15 hover:border-white/80 transition text-white"
          >
            Take the tour &rarr;
          </Link>
        </div>
        <div className="rounded-2xl overflow-hidden ring-1 ring-white/10 shadow-[0_30px_70px_rgba(0,0,0,0.45)] bg-[#0A1628]">
          <video
            ref={ref}
            src={TOUR_VIDEO}
            poster={TOUR_POSTER}
            muted
            loop
            playsInline
            controls
            preload="metadata"
            aria-label="The PinPals advert: the whole app in 60 seconds"
            className="block w-full aspect-video"
          />
        </div>
      </div>
    </section>
  );
}
