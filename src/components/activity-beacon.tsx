"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { isUntrackedPath, sectionForWebPath } from "@/lib/activity";

/**
 * The website's half of the admin "Live now" panel (0161). Tells
 * /api/activity which section this tab is on: once per page (a view) and then
 * once a minute while the tab is actually visible (still here). Nothing is
 * sent from the admin console or a clubhouse TV, and nothing inside the
 * app's web view — the app reports for itself (layout.tsx leaves this out
 * there).
 *
 * One random id per tab (sessionStorage), not a cookie and nothing that
 * follows the visitor around: the server ties it to a member only if they're
 * signed in, from their own session.
 */
const HEARTBEAT_MS = 60_000;

function sessionId(): string {
  const make = () =>
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`);
  try {
    let id = sessionStorage.getItem("pp_activity");
    if (!id) {
      id = make();
      sessionStorage.setItem("pp_activity", id);
    }
    return id;
  } catch {
    return make();
  }
}

function send(path: string, view: boolean) {
  if (isUntrackedPath(path)) return;
  const body = JSON.stringify({ session: sessionId(), platform: "web", section: sectionForWebPath(path), view });
  try {
    void fetch("/api/activity", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
      credentials: "same-origin",
    }).catch(() => {});
  } catch {
    // Best-effort only.
  }
}

export default function ActivityBeacon() {
  const pathname = usePathname();
  const current = useRef(pathname);

  useEffect(() => {
    current.current = pathname;
    send(pathname, true);
  }, [pathname]);

  useEffect(() => {
    const beat = () => {
      if (document.visibilityState === "visible") send(current.current, false);
    };
    const timer = window.setInterval(beat, HEARTBEAT_MS);
    document.addEventListener("visibilitychange", beat);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", beat);
    };
  }, []);

  return null;
}
