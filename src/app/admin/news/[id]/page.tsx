import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/admin/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateDraft, normalise, trimPunctuation } from "@/lib/news/validate";
import {
  publishArticle,
  rejectArticle,
  editArticle,
  retractArticle,
  addCorrection,
} from "./actions";

export const dynamic = "force-dynamic";

interface ArticleRow {
  id: number;
  slug: string;
  headline: string;
  standfirst: string;
  body_md: string;
  irish_angle: string | null;
  source_attribution: string;
  source_organisation: string;
  source_url: string;
  quotes: { text: string; speaker: string }[];
  status: string;
  publish_mode: string;
  ai_model: string | null;
  prompt_version: string | null;
  validation_errors: string[] | null;
  correction_note: string | null;
  review_notes: string | null;
  created_at: string;
  content_item_id: number | null;
}

const ERRORS: Record<string, string> = {
  validation: "Publishing was refused: this draft no longer passes validation. See below.",
  reason_required: "A reason is required.",
  note_required: "A correction note is required.",
  fields_required: "Headline, standfirst and body cannot be empty.",
};

export default async function AdminArticlePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  await requireStaff();
  const { id } = await params;
  const { error } = await searchParams;
  const supabase = createAdminClient();

  const { data: article } = await supabase
    .from("articles")
    .select(
      "id, slug, headline, standfirst, body_md, irish_angle, source_attribution, source_organisation, source_url, quotes, status, publish_mode, ai_model, prompt_version, validation_errors, correction_note, review_notes, created_at, content_item_id",
    )
    .eq("id", Number(id))
    .maybeSingle<ArticleRow>();

  if (!article) notFound();

  const { data: item } = article.content_item_id
    ? await supabase
        .from("content_items")
        .select("raw_body, canonical_url, published_at")
        .eq("id", article.content_item_id)
        .maybeSingle<{ raw_body: string; canonical_url: string; published_at: string | null }>()
    : { data: null };

  // Re-run the checks live, so the page shows the article's state now rather
  // than what happened to be true when it was drafted.
  const live = item
    ? validateDraft(
        {
          headline: article.headline,
          standfirst: article.standfirst,
          body_md: article.body_md,
          irish_angle: article.irish_angle,
          quotes: article.quotes ?? [],
          source_attribution: article.source_attribution,
        },
        item.raw_body,
      )
    : null;

  const haystack = item ? normalise(item.raw_body) : "";
  const quoteChecks = (article.quotes ?? []).map((q) => ({
    ...q,
    verified: haystack ? haystack.includes(trimPunctuation(normalise(q.text))) : false,
  }));

  const isDraft = article.status === "draft" || article.status === "error";
  const isPublished = article.status === "published";

  return (
    <div>
      <Link
        href="/admin/news"
        className="text-xs font-bold uppercase tracking-[0.14em] text-gold-600"
      >
        &larr; News review
      </Link>

      {error && ERRORS[error] && (
        <div className="mt-4 rounded-xl border border-red-600 bg-red-100 px-5 py-3 text-sm text-red-600">
          {ERRORS[error]}
        </div>
      )}

      <h1 className="font-display font-bold text-2xl mt-4 mb-1 text-balance">
        {article.headline}
      </h1>
      <p className="text-ink-500 text-sm mb-6">
        {article.source_organisation} · {article.status} · drafted by{" "}
        {article.ai_model ?? "unknown model"}
        {article.prompt_version ? ` (prompt ${article.prompt_version})` : ""}
      </p>

      {/* Validation state, live */}
      {live && (
        <div
          className={`mb-6 rounded-2xl border px-5 py-4 ${
            live.ok
              ? "border-line bg-green-100"
              : "border-red-600 bg-red-100"
          }`}
        >
          <div className="font-semibold text-sm text-ink-900">
            {live.ok
              ? `Passes every automated check — ${live.verifiedQuotes} of ${
                  article.quotes?.length ?? 0
                } quotes verified, longest verbatim run ${live.longestExtractWords} words.`
              : "Fails validation:"}
          </div>
          {!live.ok && (
            <ul className="mt-2 list-disc pl-5 text-sm text-red-600">
              {live.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-ink-500">
            These checks cannot detect a fact added from outside the release. Read
            the draft against the source below before publishing.
          </p>
        </div>
      )}

      {/* Draft and source, side by side — the whole point of this page */}
      <div className="grid gap-5 lg:grid-cols-2 mb-6">
        <div className="bg-surface border border-line rounded-2xl p-6">
          <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-ink-500 mb-3">
            The draft
          </h2>
          <p className="italic text-lg text-ink-900 mb-4">{article.standfirst}</p>
          <div className="text-[15px] leading-relaxed text-ink-900 space-y-3">
            {article.body_md.split("\n\n").map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
          {article.irish_angle ? (
            <div className="mt-4 rounded-r-xl border-l-4 border-green-600 bg-green-100 px-4 py-3">
              <div className="text-xs font-bold uppercase tracking-[0.12em] text-green-800 mb-1">
                The Irish angle
              </div>
              <p className="text-sm text-ink-900">{article.irish_angle}</p>
            </div>
          ) : (
            <div className="mt-4 text-sm text-gold-600 font-semibold">
              No Irish angle. Weak publish candidate — if it changes nothing for a
              club golfer here, it probably should not run.
            </div>
          )}
        </div>

        <div className="bg-surface-tint border border-line rounded-2xl p-6">
          <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-ink-500 mb-3">
            The press release, as collected
          </h2>
          {item ? (
            <>
              <a
                href={item.canonical_url}
                rel="nofollow noopener"
                className="text-xs text-green-700 underline underline-offset-2 break-all"
              >
                {item.canonical_url}
              </a>
              <pre className="mt-3 whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-ink-500 max-h-[520px] overflow-y-auto">
                {item.raw_body}
              </pre>
            </>
          ) : (
            <p className="text-sm text-ink-500">
              No stored source for this article. It cannot be checked against
              anything, so treat it with more suspicion, not less.
            </p>
          )}
        </div>
      </div>

      {/* Quotes */}
      {quoteChecks.length > 0 && (
        <div className="bg-surface border border-line rounded-2xl p-6 mb-6">
          <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-ink-500 mb-3">
            Quotes
          </h2>
          <ul className="space-y-3">
            {quoteChecks.map((q, i) => (
              <li key={i} className="flex items-start gap-3">
                <span
                  className={`shrink-0 mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                    q.verified
                      ? "bg-green-100 text-green-800"
                      : "bg-red-100 text-red-600"
                  }`}
                >
                  {q.verified ? "verbatim" : "not found"}
                </span>
                <div>
                  <p className="text-[15px] text-ink-900">&ldquo;{q.text}&rdquo;</p>
                  <p className="text-xs text-ink-500 mt-0.5">{q.speaker}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {article.review_notes && (
        <div className="bg-surface border border-line rounded-2xl p-5 mb-6 text-sm">
          <span className="font-semibold">Review note:</span> {article.review_notes}
        </div>
      )}
      {article.correction_note && (
        <div className="rounded-r-xl border-l-4 border-red-600 bg-red-100 px-5 py-4 mb-6 text-sm">
          <span className="font-semibold">Correction:</span> {article.correction_note}
        </div>
      )}

      {/* Edit */}
      <form action={editArticle} className="bg-surface border border-line rounded-2xl p-6 mb-5">
        <input type="hidden" name="id" value={article.id} />
        <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-ink-500 mb-4">
          Edit
        </h2>
        <div className="space-y-4">
          <div>
            <label htmlFor="headline" className="block text-sm font-semibold mb-1">
              Headline
            </label>
            <input
              id="headline"
              name="headline"
              defaultValue={article.headline}
              maxLength={120}
              className="w-full rounded-xl border border-line px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="standfirst" className="block text-sm font-semibold mb-1">
              Standfirst
            </label>
            <input
              id="standfirst"
              name="standfirst"
              defaultValue={article.standfirst}
              maxLength={400}
              className="w-full rounded-xl border border-line px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="body_md" className="block text-sm font-semibold mb-1">
              Body
            </label>
            <textarea
              id="body_md"
              name="body_md"
              defaultValue={article.body_md}
              rows={12}
              className="w-full rounded-xl border border-line px-3 py-2 text-sm font-sans"
            />
          </div>
          <div>
            <label htmlFor="irish_angle" className="block text-sm font-semibold mb-1">
              The Irish angle
            </label>
            <textarea
              id="irish_angle"
              name="irish_angle"
              defaultValue={article.irish_angle ?? ""}
              rows={3}
              className="w-full rounded-xl border border-line px-3 py-2 text-sm"
            />
          </div>
        </div>
        <button
          type="submit"
          className="mt-4 px-5 py-2.5 rounded-full font-bold text-sm bg-surface border border-line text-ink-900 hover:bg-surface-tint transition"
        >
          Save changes
        </button>
      </form>

      {/* Decisions */}
      <div className="grid gap-5 md:grid-cols-2">
        {isDraft && (
          <>
            <form
              action={publishArticle}
              className="bg-surface border border-line rounded-2xl p-6"
            >
              <input type="hidden" name="id" value={article.id} />
              <h2 className="font-display font-bold text-lg mb-1">Publish</h2>
              <p className="text-sm text-ink-500 mb-4">
                Goes live on /news immediately, recorded against your name. Validation
                runs once more first.
              </p>
              <button
                type="submit"
                className="px-5 py-2.5 rounded-full font-bold text-sm bg-green-600 text-white hover:bg-green-700 transition"
              >
                Publish article
              </button>
            </form>

            <form
              action={rejectArticle}
              className="bg-surface border border-line rounded-2xl p-6"
            >
              <input type="hidden" name="id" value={article.id} />
              <h2 className="font-display font-bold text-lg mb-1">Reject</h2>
              <label htmlFor="reject-reason" className="block text-sm text-ink-500 mb-2">
                Why? Kept so the prompts can be tuned against real failures.
              </label>
              <input
                id="reject-reason"
                name="reason"
                required
                className="w-full rounded-xl border border-line px-3 py-2 text-sm mb-3"
              />
              <button
                type="submit"
                className="px-5 py-2.5 rounded-full font-bold text-sm bg-navy-900 text-cream-50 hover:bg-navy-800 transition"
              >
                Reject
              </button>
            </form>
          </>
        )}

        {isPublished && (
          <>
            <form
              action={addCorrection}
              className="bg-surface border border-line rounded-2xl p-6"
            >
              <input type="hidden" name="id" value={article.id} />
              <h2 className="font-display font-bold text-lg mb-1">Add a correction</h2>
              <label htmlFor="note" className="block text-sm text-ink-500 mb-2">
                Dated and shown on the article. We do not edit a published story
                silently.
              </label>
              <input
                id="note"
                name="note"
                required
                className="w-full rounded-xl border border-line px-3 py-2 text-sm mb-3"
              />
              <button
                type="submit"
                className="px-5 py-2.5 rounded-full font-bold text-sm bg-surface border border-line hover:bg-surface-tint transition"
              >
                Add correction
              </button>
            </form>

            <form
              action={retractArticle}
              className="bg-surface border border-line rounded-2xl p-6"
            >
              <input type="hidden" name="id" value={article.id} />
              <h2 className="font-display font-bold text-lg mb-1">Retract</h2>
              <label htmlFor="retract-reason" className="block text-sm text-ink-500 mb-2">
                Removes it from /news. Use when a correction is not enough.
              </label>
              <input
                id="retract-reason"
                name="reason"
                required
                className="w-full rounded-xl border border-line px-3 py-2 text-sm mb-3"
              />
              <button
                type="submit"
                className="px-5 py-2.5 rounded-full font-bold text-sm bg-red-600 text-white hover:opacity-90 transition"
              >
                Retract article
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
