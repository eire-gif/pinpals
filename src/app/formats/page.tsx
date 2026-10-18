import type { Metadata } from "next";
import Image from "next/image";

import { GAME_FORMATS } from "@/lib/game-formats";
import { FormatsBrowser } from "./formats-browser";

export const metadata: Metadata = {
  title: "Golf game formats explained | Pinpals",
  description:
    "Every way to play golf, explained in plain English — Stableford, medal, foursomes, greensomes, fourball, Texas scramble, matchplay, skins, Wolf and more — with WHS handicap allowances.",
  alternates: { canonical: "/formats" },
};

/**
 * Game formats (Oct 2026). Public, like /rules: a visitor deciding what to
 * play at their society day is exactly who this is for. Content is
 * lib/game-formats.ts, shared byte-for-byte with the app.
 */
export default async function FormatsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const { q } = await searchParams;
  const initial = (Array.isArray(q) ? q[0] : q) ?? "";

  return (
    <div>
      <div className="relative bg-navy-900 text-white pt-16 pb-14 overflow-hidden">
        <Image
          src="/images/hero.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover -z-10 opacity-40"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[rgba(9,22,40,0.55)] to-[rgba(9,22,40,0.92)] -z-10" />
        <div className="max-w-6xl mx-auto px-6">
          <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-gold-500">
            <span className="w-5 h-0.5 bg-gold-500 inline-block" /> Play · {GAME_FORMATS.length} formats
          </span>
          <h1 className="font-display font-bold text-4xl md:text-5xl mt-2.5">Game formats</h1>
          <p className="text-white/80 mt-3 max-w-[56ch]">
            Every way to play, explained in plain English &mdash; from a Sunday medal to a society
            scramble, with the handicap allowance for each.
          </p>
        </div>
      </div>

      <FormatsBrowser initialQuery={initial.slice(0, 80)} />
    </div>
  );
}
