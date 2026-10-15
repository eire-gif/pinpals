import type { Metadata } from "next";

import { normaliseTvCode } from "@/lib/tv-token";

export const metadata: Metadata = { title: "Show on TV · PinPals", robots: { index: false, follow: false } };

/**
 * Where the QR on a clubhouse TV lands when the phone doesn't have PinPals
 * (with the app, /live/* opens it straight to Show on TV). Says how to put
 * the leaderboard on the screen, with the code to type.
 */
export default async function ShowOnTvPage({ searchParams }: { searchParams: Promise<{ code?: string | string[] }> }) {
  const raw = (await searchParams).code;
  const code = normaliseTvCode(Array.isArray(raw) ? raw[0] : raw);
  return (
    <div className="max-w-xl mx-auto px-6 py-20 text-center">
      <div className="bg-surface rounded-2xl shadow-lg p-10">
        <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-gold-600">
          <span className="w-5 h-0.5 bg-gold-500 inline-block" /> Clubhouse TV
        </span>
        <h1 className="font-display font-bold text-3xl mt-3">Put your leaderboard on the TV</h1>
        <ol className="text-left text-ink-900 mt-6 grid gap-3 list-decimal pl-6">
          <li>Open the PinPals app and go to your round or society day.</li>
          <li>Tap <strong>Show on TV</strong>.</li>
          <li>Type the code shown on the TV{code ? ":" : "."}</li>
        </ol>
        {code && <p className="mt-5 font-bold text-4xl tracking-[0.2em] text-navy-900">{code}</p>}
        <p className="text-ink-500 mt-6 text-sm">Only the organiser and players in the game can put it on a screen.</p>
      </div>
    </div>
  );
}
