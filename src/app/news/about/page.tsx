import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How Pinpals News is made | Pinpals",
  description:
    "Our sources, how quotes are checked, how images are licensed, and how to ask for a correction or removal.",
  alternates: { canonical: "/news/about" },
};

const POLICIES = [
  {
    title: "Sources",
    body: "We take announcements from first-party press offices only — the tours, the governing bodies, the championships and the equipment makers. We do not take articles from other publications. Every story names its source and links to the original release.",
  },
  {
    title: "Quotes",
    body: "Every quote is checked word-for-word against the original press release before publication. A quote that cannot be matched stops the article being published at all, rather than being quietly removed.",
  },
  {
    title: "AI",
    body: "Articles are drafted with AI assistance from the source release, then read against that release by a person who decides whether they run. Nothing publishes automatically. Each article says so on the page.",
  },
  {
    title: "Images",
    body: "Our own photography, properly licensed stock, or a typographic plate. We do not use press or agency photographs without written permission, which is why many articles carry no photograph at all.",
  },
  {
    title: "Corrections",
    body: "Corrections are dated and shown on the article itself. We do not edit a story silently after publication. If something here is wrong, tell us and we will fix it and say that we did.",
  },
  {
    title: "Automated access",
    body: "Our reader identifies itself as PinpalsNewsBot and respects robots.txt, rate limits and caching headers. If you would rather we did not read your feed, tell us and we will remove it.",
  },
];

export default function NewsAboutPage() {
  return (
    <div className="max-w-6xl mx-auto px-6 pt-10 pb-20">
      <div className="max-w-[720px]">
        <Link
          href="/news"
          className="text-xs font-bold uppercase tracking-[0.14em] text-gold-600"
        >
          &larr; All news
        </Link>

        <h1 className="mt-6 font-display font-bold text-[clamp(32px,5.5vw,46px)] leading-[1.1] tracking-tight text-ink-900 text-balance">
          How this page is <em className="italic text-gold-500">made</em>.
        </h1>

        <p className="mt-5 text-lg leading-relaxed text-ink-500">
          Pinpals News covers announcements from golf&rsquo;s official sources. We
          write our own articles from those announcements — we do not republish
          other publications&rsquo; work. Our reader is a club golfer in Ireland,
          so that is the test every story has to pass: if an announcement changes
          nothing about how you play, book or buy, it does not run here.
        </p>

        <div className="mt-10 grid gap-5 sm:grid-cols-2">
          {POLICIES.map((p) => (
            <div
              key={p.title}
              className="rounded-2xl border border-line bg-surface p-6"
            >
              <h2 className="mb-2.5 text-xs font-bold uppercase tracking-[0.12em] text-green-700">
                {p.title}
              </h2>
              <p className="text-[15px] leading-relaxed text-ink-500">{p.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 rounded-2xl border border-line bg-surface-tint p-7">
          <h2 className="font-display font-bold text-2xl text-ink-900">
            Something wrong, or want your feed removed?
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-500">
            Email{" "}
            <a
              href="mailto:news@pinpals.ie"
              className="text-green-700 underline underline-offset-2"
            >
              news@pinpals.ie
            </a>
            . We answer corrections and removal requests first, before anything
            else in the inbox.
          </p>
        </div>
      </div>
    </div>
  );
}
