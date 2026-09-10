import "server-only";
import { createClient } from "@/lib/supabase/server";

export type PublishMode = "review" | "auto";

export interface ArticleImage {
  url: string | null;
  /**
   * `licensed_press` is only ever permitted where written permission from the
   * source has been recorded — enforced by a trigger in migration 0072, not by
   * this code. Pinpals holds no such permission today, so articles render a
   * typographic plate instead.
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
  /** Paragraphs separated by a blank line. */
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

const COLUMNS = `
  id, slug, headline, standfirst, body_md, irish_angle,
  source_attribution, source_organisation, source_url, quotes,
  publish_mode, published_at, updated_at, correction_note,
  article_images ( url, storage_path, image_source, licence, licence_url, credit )
`;

/**
 * Published articles only.
 *
 * RLS already restricts anonymous and member reads to `status = 'published'`
 * (migration 0072), so the filter here is defence in depth rather than the
 * access control itself — never the reverse.
 */
export async function listPublishedArticles(
  { limit = 20 }: { limit?: number } = {},
): Promise<Article[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("articles")
    .select(COLUMNS)
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Failed to list articles: ${error.message}`);
  return (data ?? []).map(toArticle);
}

export async function getPublishedArticle(slug: string): Promise<Article | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("articles")
    .select(COLUMNS)
    .eq("status", "published")
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw new Error(`Failed to load article: ${error.message}`);
  return data ? toArticle(data) : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toArticle(row: any): Article {
  return {
    id: String(row.id),
    slug: row.slug,
    headline: row.headline,
    standfirst: row.standfirst,
    bodyMd: row.body_md,
    irishAngle: row.irish_angle,
    sourceAttribution: row.source_attribution,
    sourceOrganisation: row.source_organisation,
    sourceUrl: row.source_url,
    quotes: Array.isArray(row.quotes) ? row.quotes : [],
    publishMode: row.publish_mode === "auto" ? "auto" : "review",
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    correctionNote: row.correction_note,
    // Not surfaced publicly today: naming the individual who approved an
    // article invites contact about it, and the disclosure reads fine without
    // a name. The record of who approved it lives in admin_audit_log.
    reviewerName: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    images: (row.article_images ?? []).map((i: any) => ({
      url: i.url ?? i.storage_path ?? null,
      imageSource: i.image_source,
      licence: i.licence,
      licenceUrl: i.licence_url,
      credit: i.credit,
    })),
  };
}

/**
 * An article may only show an image whose licence and credit are both
 * recorded. The database enforces this too; this keeps a row that predates a
 * constraint from ever putting an uncredited photograph on the page.
 */
export function displayableImage(article: Article): ArticleImage | null {
  return (
    article.images.find(
      (i) =>
        i.imageSource !== "none" &&
        Boolean(i.url) &&
        Boolean(i.licence) &&
        Boolean(i.credit),
    ) ?? null
  );
}
