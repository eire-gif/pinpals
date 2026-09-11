import type { Metadata } from "next";
import Link from "next/link";
import { listPublishedArticles } from "@/lib/news/articles";

export const metadata: Metadata = {
  title: "News | Pinpals",
  description:
    "Golf news for club golfers in Ireland and the UK, written from official press releases.",
  alternates: { canonical: "/news" },
};

// Articles arrive a few times a week and are published from the admin queue,
// which calls revalidatePath("/news"). This is the backstop for anything that
// changes without going through that path.
export const revalidate = 300;

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("en-IE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Dublin",
  }).format(new Date(iso));
}

export default async function NewsIndexPage() {
  const articles = await listPublishedArticles();

  return (
    <div className="max-w-6xl mx-auto px-6 pb-20">
      {/* Follows the home page hero pattern: gold eyebrow with em-dash
          brackets, then a Playfair headline carrying one italic gold phrase. */}
      <header className="pt-14 pb-9 max-w-[720px]">
        <span className="block mb-5 text-xs font-bold uppercase tracking-[0.14em] text-gold-600">
          &mdash; News &mdash; Ireland &amp; the UK
        </span>
        <h1 className="font-display font-bold text-[clamp(38px,6.4vw,60px)] leading-[1.05] tracking-tight text-ink-900 text-balance">
          What&rsquo;s happening in{" "}
          <em className="italic text-gold-500">your game</em>, and why it matters
          at your club.
        </h1>
        <p className="mt-5 max-w-[60ch] text-lg leading-relaxed text-ink-500">
          Announcements from golf&rsquo;s official sources, written for club
          golfers in Ireland and the UK. Every story has to change something
          about how you play, book or buy.
        </p>
      </header>

      {/* The list runs the full width of the page while each standfirst keeps
          a readable measure of its own. The header above stays narrow because
          display type at 60px needs a short line; an index of headlines does
          not. */}
      <div>
        {articles.length === 0 ? (
          <p className="py-16 text-center text-ink-500">
            No articles have been published yet.
          </p>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
              <div className="text-xs font-bold uppercase tracking-[0.14em] text-ink-500">
                Latest &mdash; {articles.length}{" "}
                {articles.length === 1 ? "story" : "stories"}
              </div>
              {/* The full disclosure now sits below the list, so this short
                  label carries it above the fold. A reader should not have to
                  scroll past every story to learn how they were written. */}
              <Link
                href="/news/about"
                className="group inline-flex items-center gap-2 text-xs text-ink-500 transition-colors hover:text-ink-900"
              >
                <span className="rounded-full bg-gold-400 px-2 py-1 text-[10px] font-bold leading-none tracking-[0.1em] text-navy-900">
                  AI
                </span>
                <span className="underline underline-offset-2">
                  Drafted with AI, checked and published by a person
                </span>
              </Link>
            </div>

            <ul className="flex flex-col">
              {articles.map((a) => (
                <li key={a.id} className="border-t border-line last:border-b">
                  <Link
                    href={`/news/${a.slug}`}
                    className="group grid grid-cols-1 gap-x-10 gap-y-1.5 py-5 sm:grid-cols-[120px_1fr]"
                  >
                    <span className="whitespace-nowrap text-xs font-semibold uppercase tracking-wider text-ink-500 sm:pt-1.5">
                      {formatDate(a.publishedAt)}
                    </span>
                    <div>
                      <h2 className="font-display font-bold text-xl leading-snug text-ink-900 text-balance transition-colors group-hover:text-green-700">
                        {a.headline}
                      </h2>
                      <p className="mt-1.5 max-w-[68ch] text-[15px] leading-relaxed text-ink-500">
                        {a.standfirst}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}

        {/* Article 50(4) disclosure, stated at section level as well as on
            every article page. Below the list rather than above it, but still
            on the page and still reachable from the label at the top. */}
        <div className="mt-12 flex max-w-[820px] items-start gap-4 border-t border-line pt-8">
          <span className="mt-0.5 shrink-0 rounded-full bg-gold-400 px-2.5 py-2 text-[11px] font-bold leading-none tracking-[0.1em] text-navy-900">
            AI
          </span>
          <p className="text-[15px] leading-relaxed text-ink-500">
            Articles here are drafted with AI assistance from official press
            releases, then read against the source and published by a person.{" "}
            <strong className="font-semibold text-ink-900">
              Every quote is checked word-for-word against the original release
            </strong>{" "}
            before it appears. <Link href="/news/about" className="text-green-700 underline underline-offset-2">How this works</Link>.
          </p>
        </div>
      </div>
    </div>
  );
}
