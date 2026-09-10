import "server-only";
import { SEED_ARTICLES } from "./seed-articles";

export type PublishMode = "review" | "auto";

export interface ArticleImage {
  url: string | null;
  /**
   * `licensed_press` is only ever permitted where written permission from the
   * source has been recorded. Pinpals holds no such permission today, so every
   * article currently ships `none` and renders a typographic plate instead.
   */
  imageSource: "own" | "licensed_press" | "stock" | "none";
  licence: string;
  licenceUrl: string | null;
  credit: string;
}

export interface Article {
  id: string;
  slug: string;
  headline: string;
  standfirst: string;
  /** Paragraphs separated by a blank line, matching the future DB column. */
  bodyMd: string;
  irishAngle: string | null;
  sourceAttribution: string;
  sourceOrganisation: string;
  sourceUrl: string;
  quotes: { text: string; speaker: string }[];
  publishMode: PublishMode;
  publishedAt: string;
  updatedAt: string;
  correctionNote: string | null;
  reviewerName: string | null;
  images: ArticleImage[];
}

/**
 * Article access.
 *
 * These read from a committed seed file. The `articles` table and its RLS
 * arrive with migrations 0068-0070 (see docs/specs/news-pipeline.md); at that
 * point the two functions below become Supabase queries filtered to
 * `status = 'published'` and nothing else in the route changes, because the
 * seed objects are already the `Article` shape the pages consume.
 *
 * Deliberately async now so that swap is a one-file change rather than a
 * refactor of every caller.
 */
export async function listPublishedArticles(
  { limit = 20 }: { limit?: number } = {},
): Promise<Article[]> {
  return [...SEED_ARTICLES]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, limit);
}

export async function getPublishedArticle(slug: string): Promise<Article | null> {
  return SEED_ARTICLES.find((a) => a.slug === slug) ?? null;
}

export async function listPublishedSlugs(): Promise<string[]> {
  return SEED_ARTICLES.map((a) => a.slug);
}

/**
 * An article may only show an image whose licence and credit are both
 * recorded. Once the DB lands this is enforced by constraint as well; keeping
 * the guard here means a row that predates the constraint can never put an
 * uncredited photograph on the page.
 */
export function displayableImage(article: Article): ArticleImage | null {
  return (
    article.images.find(
      (i) => i.imageSource !== "none" && Boolean(i.url) && Boolean(i.licence) && Boolean(i.credit),
    ) ?? null
  );
}
