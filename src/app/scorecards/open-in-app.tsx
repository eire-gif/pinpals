import Link from "next/link";
import type { Metadata } from "next";

/**
 * Scorecards and certifying them (0110, 0128) live in the PinPals app — Face
 * ID can't be done from a web page. Notifications point at
 * /scorecards/certify/<id> and /scorecards/<id>; the app opens those as its
 * own screens. These pages are what a member sees if they land here instead:
 * from an app that hasn't taken its latest update yet (the old version falls
 * back to its web view), or from a browser.
 */
export const openInAppMetadata: Metadata = {
  title: "Open in the PinPals app · PinPals",
  robots: { index: false, follow: false },
};

export function OpenInApp({ certify, appPath }: { certify: boolean; appPath: string }) {
  return (
    <div className="max-w-[640px] mx-auto px-4 sm:px-6 py-14 grid gap-5">
      <p className="text-sm font-bold uppercase tracking-widest text-green-700">PinPals app</p>
      <h1 className="font-display text-3xl text-ink-900">
        {certify ? "Certify this card in the PinPals app" : "Open this scorecard in the PinPals app"}
      </h1>
      <p className="text-ink-500 leading-relaxed">
        {certify
          ? "Certifying a playing partner's card uses Face ID or your fingerprint, so it happens in the app on your phone."
          : "Scorecards live in the app on your phone."}
      </p>
      <div className="rounded-2xl border border-line bg-surface p-5 grid gap-3">
        <p className="font-bold text-ink-900">Seeing this inside the app?</p>
        <p className="text-ink-500 leading-relaxed">
          Your app needs its latest update. Close PinPals completely (swipe it away from your recent apps), then open it
          again. Then tap the notification again{certify ? ", or go to ☰ → Play → My scorecards, where it's under “Waiting for you to certify”" : ""}.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <a href={`pinpals://${appPath}`} className="rounded-full bg-green-700 text-cream-50 font-bold px-6 py-3 hover:bg-green-800">
          Open in the app
        </a>
        <Link href="/" className="rounded-full border border-line bg-surface text-ink-900 font-bold px-6 py-3 hover:bg-surface-tint">
          PinPals home
        </Link>
      </div>
    </div>
  );
}
