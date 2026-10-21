"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

/**
 * Keeps the control room current: the page is drawn on the server, so this
 * asks for a fresh copy every 20 seconds while the tab is showing (and at
 * once when it comes back to the front), like the app's useLiveRefresh.
 * Pausable — someone typing a TV code doesn't want the page moving.
 */
export default function AutoRefresh({ updatedAt, seconds = 20 }: { updatedAt: string; seconds?: number }) {
  const router = useRouter();
  const [paused, setPaused] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (paused) return;
    const tick = () => {
      if (document.visibilityState === "visible") start(() => router.refresh());
    };
    const t = setInterval(tick, seconds * 1000);
    const onShow = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [paused, router, seconds]);

  const at = new Intl.DateTimeFormat("en-IE", { timeZone: "Europe/Dublin", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(updatedAt));
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500" aria-live="polite">
      <span>{pending ? "Updating…" : `Updated ${at}`}</span>
      <span aria-hidden="true">·</span>
      <button type="button" onClick={() => setPaused((p) => !p)} className="font-semibold text-green-700 hover:text-green-600 underline-offset-2 hover:underline">
        {paused ? "Resume live updates" : `Pause live updates (every ${seconds}s)`}
      </button>
      <button type="button" onClick={() => start(() => router.refresh())} className="font-semibold text-green-700 hover:text-green-600 underline-offset-2 hover:underline">
        Refresh now
      </button>
    </div>
  );
}
