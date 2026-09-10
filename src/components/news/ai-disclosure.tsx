import type { Article } from "@/lib/news/articles";

type DisclosureArticle = Pick<
  Article,
  "publishMode" | "sourceOrganisation" | "reviewerName"
>;

/**
 * EU AI Act Article 50(4) disclosure.
 *
 * Article 50(4) requires AI-generated text published to inform the public to be
 * clearly labelled, and has applied since 2 August 2026. It exempts content
 * that has had genuine human review or editorial control — which is exactly
 * what the approval gate provides while `publishMode` is "review".
 *
 * The prominence of the label therefore derives from `article.publishMode` and
 * from nothing else. There is deliberately NO prop that suppresses it. The
 * failure this guards against is someone flipping the publish mode with no
 * accompanying code change, and the legally required notice quietly vanishing
 * with it.
 *
 * Do not render an article body without this component.
 */
export function AiDisclosure({
  article,
  placement,
}: {
  article: DisclosureArticle;
  placement: "lede" | "footer";
}) {
  const isAuto = article.publishMode === "auto";

  // Auto-published: the exemption does not apply, so the notice goes above the
  // body where it cannot be missed.
  if (isAuto && placement === "lede") {
    return (
      <aside
        role="note"
        aria-label="AI generation notice"
        className="mt-6 flex items-start gap-4 rounded-2xl border border-gold-500 bg-cream-100 p-6"
      >
        <span className="mt-0.5 shrink-0 rounded-full bg-gold-400 px-2.5 py-2 text-[11px] font-bold leading-none tracking-[0.1em] text-navy-900">
          AI
        </span>
        <p className="text-[15px] leading-relaxed text-ink-900">
          This article was generated automatically by AI from the{" "}
          {article.sourceOrganisation} press release and has{" "}
          <strong className="font-semibold">
            not been reviewed by an editor
          </strong>{" "}
          before publication.
        </p>
      </aside>
    );
  }

  // Reviewed: a byline at the foot, naming the source and the check.
  if (!isAuto && placement === "footer") {
    return (
      <p className="text-sm leading-relaxed text-ink-500">
        Drafted with AI assistance from the {article.sourceOrganisation} press
        release, then checked against the source and published by{" "}
        {article.reviewerName ?? "the Pinpals editor"}. Every quote is verified
        word-for-word against the original release.
      </p>
    );
  }

  return null;
}

/**
 * Short form, so the disclosure travels with the article into listings, RSS
 * items and Open Graph descriptions rather than living only on the page.
 */
export function aiDisclosureText(
  article: Pick<Article, "publishMode" | "sourceOrganisation">,
): string {
  return article.publishMode === "auto"
    ? `Generated automatically by AI from the ${article.sourceOrganisation} press release; not reviewed by an editor.`
    : `Drafted with AI assistance from the ${article.sourceOrganisation} press release and reviewed by an editor.`;
}
