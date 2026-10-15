"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * The frame every TV screen sits in: a 1920×1080 stage scaled to fit,
 * the screen kept awake, and the pointer and a Full screen button shown only
 * when someone moves the mouse (a TV remote's pointer, or a laptop).
 */
export default function TvShell({ children, className = "" }: { children: ReactNode; className?: string }) {
  const [scale, setScale] = useState(1);
  const [pointer, setPointer] = useState(false);
  const hideAt = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / 1920, window.innerHeight / 1080));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  // Keep the TV from dimming or sleeping while the board is up. Browsers
  // drop the lock when the tab is hidden, so take it again on return.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const take = async () => {
      try {
        const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
        if (nav.wakeLock && document.visibilityState === "visible") lock = await nav.wakeLock.request("screen");
      } catch {
        // Not supported on this TV, or refused: the board still works.
      }
    };
    void take();
    const again = () => void take();
    document.addEventListener("visibilitychange", again);
    return () => {
      document.removeEventListener("visibilitychange", again);
      void lock?.release().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    const show = () => {
      setPointer(true);
      if (hideAt.current) clearTimeout(hideAt.current);
      hideAt.current = setTimeout(() => setPointer(false), 4000);
    };
    window.addEventListener("mousemove", show);
    window.addEventListener("keydown", show);
    return () => {
      window.removeEventListener("mousemove", show);
      window.removeEventListener("keydown", show);
      if (hideAt.current) clearTimeout(hideAt.current);
    };
  }, []);

  const fullScreen = () => {
    const el = document.documentElement;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void el.requestFullscreen?.().catch(() => undefined);
  };

  return (
    <div className={`tv-root${pointer ? " tv-cursor" : ""}`} onDoubleClick={fullScreen}>
      <div className={`tv-stage ${className}`} style={{ transform: `translate(-50%, -50%) scale(${scale})` }}>
        {children}
      </div>
      {pointer && (
        <button type="button" className="tv-fs" onClick={fullScreen}>
          Full screen
        </button>
      )}
    </div>
  );
}
