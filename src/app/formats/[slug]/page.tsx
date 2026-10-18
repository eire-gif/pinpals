import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { FormatArt, GoldFrame, TILE_CLASS } from "@/components/formats/format-art";
import { GAME_FORMATS, categoryOf, formatById, relatedFormats, type FormatCategory } from "@/lib/game-formats";

type Params = { slug: string };

/** All 41 are known at build time, so every page is static. */
export function generateStaticParams(): Params[] {
  return GAME_FORMATS.map((f) => ({ slug: f.id }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const format = formatById(slug);
  if (!format) return { title: "Format not found | Pinpals" };
  return {
    title: `${format.name} explained — how to play | Pinpals`,
    description: `${format.blurb} ${format.intro}`.slice(0, 300),
    alternates: { canonical: `/formats/${format.id}` },
  };
}

const HEADER: Record<FormatCategory, string> = {
  individual: "/images/ballybunion-10th.jpg",
  matchplay: "/images/old-head-kinsale.jpg",
  pairs: "/images/heather.jpg",
  team: "/images/dunes.jpg",
  side: "/images/misty.jpg",
};

const HERO_TONE: Record<FormatCategory, string> = {
  individual: "bg-navy-900",
  matchplay: "bg-navy-800",
  pairs: "bg-green-700",
  team: "bg-navy-800",
  side: "bg-navy-900",
};

export default async function FormatPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const format = formatById(slug);
  if (!format) notFound();

  const category = categoryOf(format.category);
  const related = relatedFormats(format);
  const stats = [
    { label: "Players", value: format.players },
    { label: "Scoring", value: format.scoring },
    { label: "Allowance", value: format.allowance },
    { label: "Winner", value: format.winner },
  ];

  return (
    <div>
      <div className="relative bg-navy-900 text-white pt-14 pb-12 overflow-hidden">
        <Image src={HEADER[format.category]} alt="" fill priority sizes="100vw" className="object-cover -z-10 opacity-40" />
        <div className="absolute inset-0 bg-gradient-to-b from-[rgba(9,22,40,0.55)] to-[rgba(9,22,40,0.92)] -z-10" />
        <div className="max-w-6xl mx-auto px-6">
          <Link href="/formats" className="inline-flex items-center gap-1.5 text-sm font-bold text-gold-400 hover:text-cream-50">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 5l-7 7 7 7" />
            </svg>
            All game formats
          </Link>
          <span className="mt-6 flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-gold-500">
            <span className="w-5 h-0.5 bg-gold-500 inline-block" /> {category.label} · {format.scoring}
          </span>
          <h1 className="font-display font-bold text-4xl md:text-5xl mt-2.5">{format.name}</h1>
          {format.aka && format.aka.length > 0 ? (
            <p className="mt-2 text-sm font-semibold text-gold-400">Also called {format.aka.join(", ")}</p>
          ) : null}
          <p className="text-white/85 mt-3 max-w-[60ch] text-lg leading-relaxed">{format.intro}</p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-12 flex flex-col gap-6">
        <GoldFrame tone={HERO_TONE[format.category]}>
          <dl className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-4">
            {stats.map((s) => (
              <div key={s.label} className="flex flex-col gap-1">
                <dt className="text-[10.5px] font-bold tracking-[0.18em] uppercase text-gold-500">{s.label}</dt>
                <dd className="text-lg font-bold text-cream-50 leading-snug">{s.value}</dd>
              </div>
            ))}
          </dl>
        </GoldFrame>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-6 items-start">
          <section className="rounded-[22px] border border-line bg-surface p-6 sm:p-7 flex flex-col gap-4">
            <h2 className="font-display font-bold text-2xl text-navy-900">How it works</h2>
            <ol className="flex flex-col gap-4">
              {format.steps.map((s, i) => (
                <li key={s} className="flex gap-3.5 items-start">
                  <span className="w-8 h-8 shrink-0 rounded-full border-[1.5px] border-gold-500 text-gold-600 font-display font-bold flex items-center justify-center">
                    {i + 1}
                  </span>
                  <span className="pt-1 text-[16px] leading-relaxed text-ink-900">{s}</span>
                </li>
              ))}
            </ol>
          </section>

          <div className="flex flex-col gap-6">
            {format.example && format.visual !== "scramble" ? (
              <section className="rounded-[22px] border-[1.5px] border-dashed border-gold-500 bg-surface-tint p-6">
                <p className="text-[11px] font-bold tracking-[0.18em] uppercase text-gold-600">Worked example</p>
                <p className="mt-2 text-[16px] leading-relaxed text-ink-900">{format.example}</p>
              </section>
            ) : null}
            {format.ties ? (
              <section className="rounded-[22px] border border-line bg-surface p-6">
                <h2 className="font-display font-bold text-xl text-navy-900">Ties</h2>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-500">{format.ties}</p>
              </section>
            ) : null}
            {format.tips && format.tips.length > 0 ? (
              <section className="rounded-[22px] border border-green-600 bg-green-100 p-6 flex gap-3">
                <svg aria-hidden="true" viewBox="0 0 24 24" className="w-6 h-6 shrink-0 text-green-700" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z" />
                </svg>
                <div className="flex flex-col gap-2">
                  <h2 className="font-bold text-green-800">Good to know</h2>
                  {format.tips.map((t) => (
                    <p key={t} className="text-[15px] leading-relaxed text-green-800">{t}</p>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        </div>

        {format.visual ? <FormatArt visual={format.visual} /> : null}

        {related.length > 0 ? (
          <section className="rounded-[22px] border border-line bg-surface p-6 flex flex-col gap-4">
            <h2 className="font-display font-bold text-xl text-navy-900">Close relations</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {related.map((r) => (
                <Link key={r.id} href={`/formats/${r.id}`} className="flex items-center gap-3 rounded-2xl border border-line p-3 hover:border-navy-900 transition">
                  <span aria-hidden="true" className={`${TILE_CLASS[r.category]} w-10 h-10 shrink-0 rounded-[10px] border border-gold-500 text-gold-400 text-xs font-bold flex items-center justify-center`}>
                    {r.code}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-bold text-navy-900">{r.name}</span>
                    <span className="block text-sm text-ink-500">{r.blurb}</span>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {format.live ? (
          <section className="rounded-[22px] bg-navy-900 p-[5px]">
            <div className="rounded-[17px] border border-gold-500/60 px-6 py-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
              <p className="text-cream-50">
                <b className="text-gold-400">Play it on PinPals.</b> Live scoring works out the handicaps and keeps the leaderboard on everyone&rsquo;s phone.
              </p>
              <Link href="/" className="shrink-0 inline-flex items-center justify-center min-h-[48px] px-6 rounded-full bg-gold-400 text-navy-900 font-bold shadow-[0_3px_0_#9c7a2c] hover:brightness-105">
                Get the app
              </Link>
            </div>
          </section>
        ) : null}

        <p className="text-sm text-ink-500 max-w-[70ch]">
          Allowances follow the World Handicap System recommendations used by Golf Ireland. Your club or
          society may set its own &mdash; the entry sheet wins.
        </p>
      </div>
    </div>
  );
}
