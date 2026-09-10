"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/admin/authorization";
import { recordAdminAction } from "@/lib/admin/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateDraft, type DraftShape } from "@/lib/news/validate";

/**
 * Review-queue actions.
 *
 * Every one of these is audited. Publishing in particular: it is the moment a
 * machine-written article becomes something Pinpals said in public, and the
 * EU AI Act Article 50(4) exemption this site relies on rests on a person
 * having exercised editorial control. `human_reviewed_by` plus an
 * `article.published` audit row naming that person is the record of it.
 *
 * Note what publish does NOT do: it does not quietly fix a draft that no
 * longer validates. If an edit introduced a problem, publishing is refused.
 */

function revalidateNews(slug?: string) {
  revalidatePath("/news");
  revalidatePath("/admin/news");
  if (slug) revalidatePath(`/news/${slug}`);
}

interface ArticleRow {
  id: number;
  slug: string;
  headline: string;
  standfirst: string;
  body_md: string;
  irish_angle: string | null;
  source_attribution: string;
  quotes: { text: string; speaker: string }[];
  status: string;
  content_item_id: number | null;
}

async function loadArticle(id: number) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("articles")
    .select(
      "id, slug, headline, standfirst, body_md, irish_angle, source_attribution, quotes, status, content_item_id",
    )
    .eq("id", id)
    .maybeSingle<ArticleRow>();

  if (error) throw new Error(`Could not load article ${id}: ${error.message}`);
  if (!data) throw new Error(`Article ${id} not found`);
  return { supabase, article: data };
}

/** The stored press release this article was drafted from. */
async function sourceBody(
  supabase: ReturnType<typeof createAdminClient>,
  contentItemId: number | null,
): Promise<string | null> {
  if (!contentItemId) return null;
  const { data } = await supabase
    .from("content_items")
    .select("raw_body")
    .eq("id", contentItemId)
    .maybeSingle<{ raw_body: string }>();
  return data?.raw_body ?? null;
}

export async function publishArticle(formData: FormData) {
  const { user, staff } = await requireStaff();
  const id = Number(formData.get("id"));
  const { supabase, article } = await loadArticle(id);

  // Re-validate against the source before publishing. An article may have been
  // edited since it was drafted, and an edit can introduce exactly the problem
  // the original check caught. Publishing must not be the one path that skips
  // the check.
  const raw = await sourceBody(supabase, article.content_item_id);
  if (raw) {
    const draft: DraftShape = {
      headline: article.headline,
      standfirst: article.standfirst,
      body_md: article.body_md,
      irish_angle: article.irish_angle,
      quotes: article.quotes ?? [],
      source_attribution: article.source_attribution,
    };
    const result = validateDraft(draft, raw);
    if (!result.ok) {
      await supabase
        .from("articles")
        .update({ validation_errors: result.errors })
        .eq("id", id);
      redirect(`/admin/news/${id}?error=validation`);
    }
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("articles")
    .update({
      status: "published",
      published_at: now,
      human_reviewed_by: user.id,
      human_reviewed_at: now,
      validation_errors: null,
    })
    .eq("id", id);

  if (error) throw new Error(`Could not publish article ${id}: ${error.message}`);

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "article.published",
    targetType: "article",
    targetId: id,
    metadata: { slug: article.slug, headline: article.headline },
  });

  revalidateNews(article.slug);
  redirect("/admin/news?status=published");
}

export async function rejectArticle(formData: FormData) {
  const { user, staff } = await requireStaff();
  const id = Number(formData.get("id"));
  const reason = String(formData.get("reason") ?? "").trim();

  if (!reason) redirect(`/admin/news/${id}?error=reason_required`);

  const { supabase, article } = await loadArticle(id);

  const { error } = await supabase
    .from("articles")
    .update({ status: "rejected", review_notes: reason })
    .eq("id", id);
  if (error) throw new Error(`Could not reject article ${id}: ${error.message}`);

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "article.rejected",
    targetType: "article",
    targetId: id,
    reason,
    metadata: { headline: article.headline },
  });

  revalidateNews();
  redirect("/admin/news");
}

export async function editArticle(formData: FormData) {
  const { user, staff } = await requireStaff();
  const id = Number(formData.get("id"));
  const { supabase, article } = await loadArticle(id);

  const next = {
    headline: String(formData.get("headline") ?? "").trim(),
    standfirst: String(formData.get("standfirst") ?? "").trim(),
    body_md: String(formData.get("body_md") ?? "").trim(),
    irish_angle: String(formData.get("irish_angle") ?? "").trim() || null,
  };

  if (!next.headline || !next.standfirst || !next.body_md) {
    redirect(`/admin/news/${id}?error=fields_required`);
  }

  const before = {
    headline: article.headline,
    standfirst: article.standfirst,
    body_md: article.body_md,
    irish_angle: article.irish_angle,
  };

  const changed = (Object.keys(next) as (keyof typeof next)[]).filter(
    (key) => next[key] !== before[key],
  );
  if (changed.length === 0) redirect(`/admin/news/${id}`);

  const { error } = await supabase.from("articles").update(next).eq("id", id);
  if (error) throw new Error(`Could not edit article ${id}: ${error.message}`);

  // The full before/after goes here, not into the audit log — that log is read
  // by staff scanning for what happened, not for diffing prose.
  await supabase.from("article_revisions").insert({
    article_id: id,
    editor_id: user.id,
    before,
    after: next,
  });

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "article.edited",
    targetType: "article",
    targetId: id,
    metadata: { fields: changed },
  });

  revalidateNews(article.slug);
  redirect(`/admin/news/${id}`);
}

export async function retractArticle(formData: FormData) {
  const { user, staff } = await requireStaff();
  const id = Number(formData.get("id"));
  const reason = String(formData.get("reason") ?? "").trim();

  if (!reason) redirect(`/admin/news/${id}?error=reason_required`);

  const { supabase, article } = await loadArticle(id);

  const { error } = await supabase
    .from("articles")
    .update({
      status: "retracted",
      retracted_at: new Date().toISOString(),
      retraction_reason: reason,
    })
    .eq("id", id);
  if (error) throw new Error(`Could not retract article ${id}: ${error.message}`);

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "article.retracted",
    targetType: "article",
    targetId: id,
    reason,
    metadata: { slug: article.slug },
  });

  revalidateNews(article.slug);
  redirect("/admin/news?status=retracted");
}

/**
 * A correction is appended and dated on the article itself. A published story
 * is never edited silently — that is the difference between correcting the
 * record and rewriting it.
 */
export async function addCorrection(formData: FormData) {
  const { user, staff } = await requireStaff();
  const id = Number(formData.get("id"));
  const note = String(formData.get("note") ?? "").trim();

  if (!note) redirect(`/admin/news/${id}?error=note_required`);

  const { supabase, article } = await loadArticle(id);
  const dated = `${new Intl.DateTimeFormat("en-IE", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Dublin",
  }).format(new Date())}: ${note}`;

  const { error } = await supabase
    .from("articles")
    .update({ correction_note: dated })
    .eq("id", id);
  if (error) throw new Error(`Could not add correction to ${id}: ${error.message}`);

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "article.corrected",
    targetType: "article",
    targetId: id,
    reason: note,
    metadata: { slug: article.slug },
  });

  revalidateNews(article.slug);
  redirect(`/admin/news/${id}`);
}
