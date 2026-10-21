"use client";

import { useEffect, useRef, useState } from "react";

import { TOUR_CHAPTERS, TOUR_POSTER, TOUR_VIDEO } from "./chapters";

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const ALL = TOUR_CHAPTERS.flatMap((c) => c.scenes);

/** Video plus a chapter list that jumps the film to each scene. */
export function TourPlayer() {
  const video = useRef<HTMLVideoElement>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const tick = () => setNow(v.currentTime);
    v.addEventListener("timeupdate", tick);
    // Deep link: /tour#t=91 starts at that scene.
    const m = /t=(\d+)/.exec(window.location.hash);
    if (m) v.currentTime = Number(m[1]);
    return () => v.removeEventListener("timeupdate", tick);
  }, []);

  const current = ALL.reduce((acc, s) => (now >= s.start ? s : acc), ALL[0]);

  const jump = (start: number) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = start;
    void v.play().catch(() => {});
    v.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6">
      <div className="relative z-10 -mt-20 md:-mt-24 rounded-2xl overflow-hidden bg-navy-900 shadow-[0_30px_60px_rgba(12,32,56,0.35)] ring-1 ring-black/5">
        <video
          ref={video}
          src={TOUR_VIDEO}
          poster={TOUR_POSTER}
          controls
          playsInline
          preload="metadata"
          className="block w-full aspect-video bg-navy-900"
        />

      </div>

      <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {TOUR_CHAPTERS.map((ch, i) => (
          <section key={ch.title} className="rounded-2xl bg-white border border-cream-100 p-5">
            <div className="text-xs font-bold tracking-widest uppercase text-gold-600">Chapter {i + 1}</div>
            <h2 className="font-display font-bold text-2xl text-navy-900 mt-1">{ch.title}</h2>
            <p className="text-sm text-navy-900/70 mt-1.5">{ch.blurb}</p>
            <ul className="mt-4 flex flex-col gap-1">
              {ch.scenes.map((s) => {
                const on = s === current;
                return (
                  <li key={s.start}>
                    <button
                      type="button"
                      onClick={() => jump(s.start)}
                      className={`w-full min-h-11 flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                        on ? "bg-navy-900 text-white" : "text-navy-900 hover:bg-cream-50"
                      }`}
                    >
                      <span className="font-medium">{s.title}</span>
                      <span className={`tabular-nums text-xs ${on ? "text-gold-400" : "text-navy-900/50"}`}>{fmt(s.start)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
