import type { LegalDocument, LegalBlock } from "@/lib/legal/types";
import { OPERATOR_DETAILS_COMPLETE, isProductionDeployment, formatEffectiveDate } from "@/lib/legal";

/**
 * Renders one legal document. Deliberately free of hooks, data fetching and
 * server-only imports so that the same component draws the public page, the
 * dashboard view and the sign-up modal — which is a client component. Three
 * renderings of a legal document that could drift apart is three chances to
 * show a member text they did not agree to.
 */

function Block({ block }: { block: LegalBlock }) {
  switch (block.kind) {
    case "p":
      return <p className="text-[15px] leading-relaxed text-ink-900/90">{block.text}</p>;
    case "ul":
      return (
        <ul className="flex flex-col gap-2 pl-1">
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-2.5 text-[15px] leading-relaxed text-ink-900/90">
              <span aria-hidden className="mt-2 w-1.5 h-1.5 rounded-full bg-green-700 shrink-0" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      );
    case "note":
      return (
        <p className="text-[15px] leading-relaxed font-medium text-ink-900 bg-cream-50 border-l-[3px] border-gold-500 rounded-r-lg px-4 py-3">
          {block.text}
        </p>
      );
  }
}

/**
 * A build-time reminder for whoever is working on the site — never
 * something a member sees.
 *
 * It names a source file, so it belongs only where a developer is looking:
 * local development, CI, and preview deploys. Production can't reach the
 * unfinished state at all, because assertOperatorDetailsComplete() fails
 * the production build first (src/lib/legal/operator.ts explains why that
 * is the right trade rather than quietly hiding the problem). The
 * production guard below is belt-and-braces for the case where someone
 * removes that assertion: a member should still never be told that the
 * terms they are being asked to accept are unfinished.
 *
 * Rendered explicitly by the two public /legal pages, and deliberately NOT
 * from inside LegalDocumentView. That is what keeps it server-only:
 * LegalDocumentView is also rendered by the sign-up modal, which is a
 * client component, and `process.env.VERCEL_ENV` is not available in a
 * client bundle (only NEXT_PUBLIC_* names are inlined). The guard would
 * therefore have silently failed open in the one place it most needed to
 * hold. Keeping the check on the server side of the boundary avoids
 * depending on that plumbing at all.
 */
export function OperatorDetailsWarning() {
  if (OPERATOR_DETAILS_COMPLETE) return null;
  if (isProductionDeployment()) return null;
  return (
    <div className="rounded-xl border-[1.5px] border-gold-600 bg-gold-400/20 px-4 py-3 mb-6">
      <p className="text-sm font-bold text-ink-900">This document is not finished.</p>
      <p className="text-sm text-ink-900/85 mt-1">
        Pinpals&rsquo; registered name and address have not been filled in, so this document does
        not identify who operates the site or who is responsible for your data. Irish e-commerce
        and data protection law both require that. Set them in{" "}
        <code className="text-[13px]">src/lib/legal/operator.ts</code> before launch.
      </p>
    </div>
  );
}

export default function LegalDocumentView({
  document: doc,
  showHeading = true,
}: {
  document: LegalDocument;
  showHeading?: boolean;
}) {
  return (
    <article>
      {showHeading && (
        <header className="mb-7">
          <h1 className="font-display font-bold text-3xl">{doc.title}</h1>
          <p className="text-ink-500 mt-2">{doc.summary}</p>
          <p className="text-xs text-ink-500 mt-3">
            Version {doc.version} &middot; in effect from {formatEffectiveDate(doc.effectiveFrom)}
          </p>
        </header>
      )}

      <div className="flex flex-col gap-8">
        {doc.sections.map((section) => (
          <section key={section.id} id={section.id} className="scroll-mt-24">
            <h2 className="font-display font-bold text-xl mb-3">{section.heading}</h2>
            <div className="flex flex-col gap-3.5">
              {section.blocks.map((block, i) => (
                <Block key={i} block={block} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </article>
  );
}

/** The plain-English summary shown above the full text in the sign-up modal. */
export function LegalKeyPoints({ document: doc }: { document: LegalDocument }) {
  return (
    <div className="bg-cream-50 border border-line rounded-xl p-5">
      <h3 className="font-display font-bold text-base mb-3">In plain English</h3>
      <ul className="flex flex-col gap-2.5">
        {doc.keyPoints.map((point, i) => (
          <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-ink-900/90">
            <span aria-hidden className="mt-1.5 w-1.5 h-1.5 rounded-full bg-gold-500 shrink-0" />
            <span>{point}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-ink-500 mt-4 pt-3 border-t border-line">
        This summary is here to help, not to replace the agreement. The full text below is what you
        are agreeing to.
      </p>
    </div>
  );
}
