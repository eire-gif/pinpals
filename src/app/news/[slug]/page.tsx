import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getPublishedArticle,
  listPublishedSlugs,
  displayableImage,
  type Article,
} from "@/lib/news/articles";
import { AiDisclosure, aiDisclosureText } from "@/components/news/ai-disclosure";

type Params = { params: Promise<{ slug: string }> };

export async function generateStaticParams() {
  const slugs = await listPublishedSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const article = await getPublishedArticle(slug);
  if (!article) return { title: "Not found | Pinpals" };

  return {
    title: `${article.headline} | Pinpals`,
    description: article.standfirst,
    alternates: { canonical: `/news/${article.slug}` },
    openGraph: {
      type: "article",
      title: article.headline,
      // The disclosure travels with the article wherever it surfaces.
      description: `${article.standfirst} — ${aiDisclosureText(article)}`,
      publishedTime: article.publishedAt,
      modifiedTime: article.updatedAt,
    },
  };
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("en-IE", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Dublin",
  }).format(new Date(iso));
}

/**
 * NewsArticle structured data.
 *
 * Note the absence of an `author`: attributing an AI-drafted article to a
 * person who did not write it would be a lie told to a search engine. The
 * publisher is the organisation, which is true, and `isBasedOn` points at the
 * press release the article was written from.
 */
function jsonLd(article: Article) {
  return {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: article.headline,
    description: article.standfirst,
    datePublished: article.publishedAt,
    dateModified: article.updatedAt,
    publisher: { "@type": "Organization", name: "Pinpals" },
    isBasedOn: article.sourceUrl,
    mainEntityOfPage: `https://pinpals.ie/news/${article.slug}`,
  };
}

export default async function ArticlePage({ params }: Params) {
  const { slug } = await params;
  const article = await getPublishedArticle(slug);
  if (!article) notFound();

  const image = displayableImage(article);
  const paragraphs = article.bodyMd.split("\n\n");

  return (
    <div className="max-w-6xl mx-auto px-6 pt-10 pb-20">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd(article)) }}
      />

      <div className="max-w-[720px]">
        <Link
          href="/news"
          className="text-xs font-bold uppercase tracking-[0.14em] text-gold-600"
        >
          &larr; All news
        </Link>

        <article className="pt-6">
          {image ? (
            <figure>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.url ?? ""} alt="" className="w-full rounded-2xl" />
              <figcaption className="mt-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                {image.credit} &middot;{" "}
                {image.licenceUrl ? (
                  <a href={image.licenceUrl} rel="nofollow noopener">
                    {image.licence}
                  </a>
                ) : (
                  image.licence
                )}
              </figcaption>
              <h1 className="mt-7 font-display font-bold text-[clamp(28px,5vw,40px)] leading-tight tracking-tight text-ink-900 text-balance">
                {article.headline}
              </h1>
            </figure>
          ) : (
            /* No licensed image is held for any source yet, so the headline
               becomes the artwork: a navy plate with a gold rule, matching the
               dark cards on the home page. */
            <div className="relative overflow-hidden rounded-t-2xl bg-navy-900 px-7 pt-[34px] pb-[30px] after:absolute after:inset-x-0 after:bottom-0 after:h-1 after:bg-gold-400">
              <span className="block mb-3.5 text-[11px] font-bold uppercase tracking-[0.14em] text-white/60">
                {article.sourceOrganisation}
              </span>
              <h1 className="font-display font-bold text-[clamp(26px,4.6vw,36px)] leading-[1.12] tracking-tight text-white text-balance">
                {article.headline}
              </h1>
            </div>
          )}

          <div
            className={
              image
                ? "mt-6"
                : "rounded-b-2xl border border-t-0 border-line bg-surface p-7"
            }
          >
            <p className="text-xl italic leading-relaxed text-ink-900 text-pretty">
              {article.standfirst}
            </p>

            <div className="mt-3.5 text-xs font-semibold uppercase tracking-wider text-ink-500">
              Published {formatDate(article.publishedAt)}
            </div>

            <AiDisclosure article={article} placement="lede" />

            {article.correctionNote ? (
              <aside className="mt-7 rounded-r-xl border-l-4 border-red-600 bg-red-100 px-6 py-5">
                <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-red-600">
                  Correction
                </h2>
                <p className="text-base leading-relaxed text-ink-900">
                  {article.correctionNote}
                </p>
              </aside>
            ) : null}

            <div className="mt-6 text-lg leading-[1.65] text-ink-900">
              {paragraphs.map((para, i) => (
                <p key={i} className={i === 0 ? "" : "mt-[1.05em]"}>
                  {para}
                </p>
              ))}
            </div>

            {article.quotes.length > 0 ? (
              <blockquote className="mt-7 border-l-4 border-gold-400 pl-6">
                <p className="font-display font-bold text-[22px] leading-[1.4] text-navy-900 text-pretty">
                  {article.quotes[0].text}
                </p>
                <cite className="mt-2.5 block not-italic text-xs font-semibold uppercase tracking-wider text-ink-500">
                  {article.quotes[0].speaker}
                </cite>
              </blockquote>
            ) : null}

            {article.irishAngle ? (
              <aside className="mt-7 rounded-r-xl border-l-4 border-green-600 bg-green-100 px-6 py-5">
                <h2 className="mb-2.5 text-xs font-bold uppercase tracking-[0.14em] text-green-800">
                  The Irish angle
                </h2>
                <p className="text-base leading-[1.65] text-ink-900">
                  {article.irishAngle}
                </p>
              </aside>
            ) : null}

            <footer className="mt-7 grid gap-2.5 border-t border-line pt-5">
              <p className="text-sm leading-relaxed text-ink-500">
                Source:{" "}
                <a
                  href={article.sourceUrl}
                  rel="nofollow noopener"
                  className="text-green-700 underline underline-offset-2"
                >
                  {article.sourceAttribution}
                </a>
              </p>
              <AiDisclosure article={article} placement="footer" />
            </footer>
          </div>
        </article>
      </div>
    </div>
  );
}
