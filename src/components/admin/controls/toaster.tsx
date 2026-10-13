"use client";

import { useEffect, useState } from "react";

/**
 * The admin console's one toast. Anything can call `adminToast("Hidden — 3
 * posts.")`; the <AdminToaster /> in the admin layout shows it for a few
 * seconds. A window event rather than a context so a menu inside any Server
 * Component's markup can raise one without a provider around it.
 */
const EVENT = "pp-admin-toast";

type Toast = { id: number; text: string; tone: "success" | "error" };

export function adminToast(text: string, tone: Toast["tone"] = "success") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { text, tone } }));
}

export default function AdminToaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    let next = 1;
    const onToast = (e: Event) => {
      const { text, tone } = (e as CustomEvent<{ text: string; tone: Toast["tone"] }>).detail;
      const id = next++;
      setToasts((t) => [...t.slice(-2), { id, text, tone }]);
      window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
    };
    window.addEventListener(EVENT, onToast);
    return () => window.removeEventListener(EVENT, onToast);
  }, []);

  return (
    <div aria-live="polite" className="fixed z-[60] bottom-4 right-4 left-4 sm:left-auto flex flex-col gap-2 items-end pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto max-w-sm rounded-xl px-4 py-3 text-sm font-semibold shadow-lg ${
            t.tone === "success" ? "bg-navy-900 text-cream-50" : "bg-red-600 text-cream-50"
          }`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
