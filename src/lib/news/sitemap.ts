/**
 * Sitemap parsing.
 *
 * Two of the three newsrooms we want next — Ryder Cup Europe and the DP World
 * Tour — publish no RSS at all. What they do publish is a Google News sitemap:
 * an XML list of article URLs carrying `news:title` and
 * `news:publication_date` per entry. That is a better index than most RSS
 * feeds, because it is the publisher's own statement of what is news and when
 * it was published, and it is explicitly offered for machine consumption.
 *
 * What it does NOT carry is the article text. A sitemap entry is a URL, so
 * collecting from one means fetching each article page afterwards — see
 * extract.ts for that half, and collect.ts for the rate limiting and the
 * robots check that every one of those fetches goes through.
 *
 * Two shapes have to be handled, because the two sites differ:
 *
 *   - Ryder Cup serves a flat `<urlset>` at /sitemap/articles.xml.
 *   - The DP World Tour serves a `<sitemapindex>` at /sitemap-article.xml
 *     whose children (latest.xml, 2026-08.xml, …) are the urlsets.
 *
 * So the parser reports which of the two it read, and the collector follows an
 * index one level down. One level, not arbitrary depth: an index that points
 * at another index that points back is a loop, and a collector that walks it
 * politely at ten seconds a request would still be walking it next week.
 */

import { decode, tagText, blocks } from "./feed";

/**
 * How many child sitemaps of an index to follow in one run.
 *
 * One. The children are sorted newest first, and on the DP World Tour that
 * puts `latest.xml` at the front — which is exactly and only what a news
 * collector wants. Following a second costs ten seconds of the run's budget
 * to read last month, and last month is outside the collection window
 * anyway.
 */
export const MAX_CHILDREN_FOLLOWED = 1;

export interface SitemapEntry {
  /** Canonical article URL. */
  loc: string;
  /** From `news:title` where the sitemap is a news sitemap, else null. */
  title: string | null;
  /** `news:publication_date`, else `lastmod`, else null. */
  publishedAt: Date | null;
  /**
   * True when the date came from `news:publication_date` rather than
   * `lastmod`. It matters: lastmod is the last time the page changed, which a
   * site-wide template edit moves on every article at once. Treating that as
   * a publication date makes a four-year-old article look like today's news.
   */
  dateIsPublication: boolean;
  /** First `image:loc`, where the sitemap declares one. */
  imageUrl: string | null;
}

export interface ParsedSitemap {
  kind: "index" | "urlset";
  /** Populated when kind is 'urlset'. */
  entries: SitemapEntry[];
  /** Populated when kind is 'index': child sitemap URLs, newest first. */
  children: string[];
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Namespace prefixes are conventional, not guaranteed — a sitemap may declare
 * the news namespace under any prefix, or none. Matching on the local name
 * with an optional prefix reads both without needing a namespace-aware parser.
 */
function nsTagText(xml: string, localName: string): string | null {
  const match = xml.match(
    new RegExp(`<(?:[A-Za-z0-9_-]+:)?${localName}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9_-]+:)?${localName}>`, "i"),
  );
  return match ? decode(match[1]) : null;
}

function nsBlocks(xml: string, localName: string): string[] {
  const out: string[] = [];
  const re = new RegExp(
    `<(?:[A-Za-z0-9_-]+:)?${localName}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9_-]+:)?${localName}>`,
    "gi",
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

/**
 * The `<loc>` of an entry, ignoring any `<loc>` nested inside `image:image`.
 *
 * A news sitemap entry contains two: the article's own and the illustrating
 * image's. Taking the first match is right for the entry but would take the
 * image URL on an entry that happened to order them the other way, so the
 * image block is removed before looking.
 */
function entryLoc(entry: string): string | null {
  const withoutImages = entry.replace(
    /<(?:[A-Za-z0-9_-]+:)?image(?:\s[^>]*)?>[\s\S]*?<\/(?:[A-Za-z0-9_-]+:)?image>/gi,
    " ",
  );
  return nsTagText(withoutImages, "loc");
}

function parseEntry(entry: string): SitemapEntry | null {
  const loc = entryLoc(entry);
  if (!loc) return null;

  const newsBlock = nsBlocks(entry, "news").find((b) => /publication_date|title/i.test(b));
  const newsDate = newsBlock ? parseDate(nsTagText(newsBlock, "publication_date")) : null;
  const newsTitle = newsBlock ? nsTagText(newsBlock, "title") : null;

  const imageBlock = nsBlocks(entry, "image")[0] ?? null;

  return {
    loc: loc.trim(),
    title: newsTitle?.trim() || null,
    publishedAt: newsDate ?? parseDate(tagText(entry, "lastmod")),
    dateIsPublication: newsDate !== null,
    // nsTagText, not tagText: the tag is <image:loc>, and a parser that only
    // looks for a bare <loc> finds nothing and silently reports no image.
    imageUrl: imageBlock ? (nsTagText(imageBlock, "loc")?.trim() ?? null) : null,
  };
}

/**
 * Parse a sitemap document.
 *
 * Decides on the document, not on configuration: a source pointed at a flat
 * urlset that later becomes an index keeps working, and vice versa.
 */
export function parseSitemap(xml: string): ParsedSitemap {
  const isIndex = /<sitemapindex[\s>]/i.test(xml);

  if (isIndex) {
    const children = blocks(xml, "sitemap")
      .map((child) => ({
        loc: tagText(child, "loc")?.trim() ?? null,
        lastmod: parseDate(tagText(child, "lastmod")),
      }))
      .filter((c): c is { loc: string; lastmod: Date | null } => Boolean(c.loc))
      // Newest first, so following only the first few gets current news
      // rather than whichever month the site happens to list first.
      .sort((a, b) => (b.lastmod?.getTime() ?? 0) - (a.lastmod?.getTime() ?? 0))
      .map((c) => c.loc);

    return { kind: "index", entries: [], children };
  }

  const entries = nsBlocks(xml, "url")
    .map(parseEntry)
    .filter((e): e is SitemapEntry => e !== null)
    .sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));

  return { kind: "urlset", entries, children: [] };
}

/**
 * Is this URL one we should fetch as an article for this source?
 *
 * A sitemap is site-wide by nature and lists things that are not news — the
 * DP World Tour's index covers `/european-tour/` and `/legends-tour/`, both of
 * which its own robots.txt disallows. Filtering here means we never queue a
 * URL we would then have to refuse, and it keeps a source scoped to the
 * section it was added for.
 *
 * `prefix` is a plain URL prefix from the source row, not a pattern: a regex
 * in a database column is a way to fetch something nobody intended.
 */
export function isWithinSection(url: string, prefix: string | null): boolean {
  if (!prefix) return true;
  return url.startsWith(prefix);
}
