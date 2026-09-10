import Link from "next/link";
import type { Metadata } from "next";
import { LEGAL_DOCUMENTS, OPERATOR, formatEffectiveDate } from "@/lib/legal";
import { OperatorDetailsWarning } from "@/components/legal-document";

export const metadata: Metadata = {
  title: "Terms & privacy | Pinpals",
  description:
    "The Pinpals Terms of Service, Privacy Policy, Marketplace Rules and Community & Tee-Time Guidelines.",
};

/**
 * The public index of every legal document.
 *
 * Public and unauthenticated on purpose: someone deciding whether to join
 * has to be able to read what they would be agreeing to before they hand
 * over an email address, and S.I. 68/2003 requires terms to be accessible
 * in a way that allows them to be stored and reproduced. The same pages
 * are what /dashboard/legal links to for members.
 */
export default function LegalIndexPage() {
  return (
    <div>
      <div className="bg-navy-900 text-white pt-16 pb-14">
        <div className="max-w-3xl mx-auto px-6">
          <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-gold-500">
            <span className="w-5 h-0.5 bg-gold-500 inline-block" /> Legal
          </span>
          <h1 className="font-display font-bold text-4xl mt-2.5">Terms &amp; privacy</h1>
          <p className="text-white/80 mt-3 max-w-[56ch]">
            Everything that governs how Pinpals works, written to be read rather than skipped.
            Every member agrees to these when they join.
          </p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-12">
        <OperatorDetailsWarning />

        <div className="flex flex-col gap-3">
          {LEGAL_DOCUMENTS.map((doc) => (
            <Link
              key={doc.slug}
              href={`/legal/${doc.slug}`}
              className="block bg-surface border border-line rounded-2xl p-6 hover:border-green-600 transition"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-display font-bold text-xl">{doc.title}</h2>
                  <p className="text-ink-500 text-sm mt-1.5">{doc.summary}</p>
                  <p className="text-xs text-ink-500 mt-3">
                    Version {doc.version} &middot; in effect from {formatEffectiveDate(doc.effectiveFrom)}
                  </p>
                </div>
                <span aria-hidden className="text-green-700 font-bold shrink-0 mt-1">
                  &rarr;
                </span>
              </div>
            </Link>
          ))}
        </div>

        <div className="mt-10 bg-surface border border-line rounded-2xl p-6">
          <h2 className="font-display font-bold text-lg mb-2">Questions, or something to report?</h2>
          <p className="text-sm text-ink-900/90 leading-relaxed">
            General enquiries and complaints:{" "}
            <a href={`mailto:${OPERATOR.complaintsContact}`} className="text-green-700 font-bold">
              {OPERATOR.complaintsContact}
            </a>
            . Anything to do with your personal data — a copy of it, a correction, a deletion:{" "}
            <a href={`mailto:${OPERATOR.dataProtectionContact}`} className="text-green-700 font-bold">
              {OPERATOR.dataProtectionContact}
            </a>
            .
          </p>
          <p className="text-sm text-ink-500 mt-3">
            Members can see which version of each document they accepted, and when, under{" "}
            <Link href="/dashboard/legal" className="text-green-700 font-bold">
              Legal &amp; privacy
            </Link>{" "}
            in the dashboard.
          </p>
        </div>
      </div>
    </div>
  );
}
