import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { LEGAL_DOCUMENTS, getLegalDocument } from "@/lib/legal";
import LegalDocumentView, { OperatorDetailsWarning } from "@/components/legal-document";

type Props = { params: Promise<{ slug: string }> };

/** Four documents, no data fetching — prerendered rather than resolved per request. */
export function generateStaticParams() {
  return LEGAL_DOCUMENTS.map((doc) => ({ slug: doc.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const doc = getLegalDocument(slug);
  if (!doc) return { title: "Not found | Pinpals" };
  return { title: `${doc.title} | Pinpals`, description: doc.summary };
}

export default async function LegalDocumentPage({ params }: Props) {
  const { slug } = await params;
  const doc = getLegalDocument(slug);
  if (!doc) notFound();

  const others = LEGAL_DOCUMENTS.filter((d) => d.slug !== doc.slug);

  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <Link href="/legal" className="text-sm text-green-700 font-bold">
        &larr; All terms &amp; policies
      </Link>

      <div className="bg-surface border border-line rounded-2xl p-7 sm:p-10 mt-4">
        {/* Server component, so the production guard inside actually works —
            see the note on OperatorDetailsWarning. */}
        <OperatorDetailsWarning />
        <LegalDocumentView document={doc} />
      </div>

      <div className="mt-8">
        <h2 className="text-xs uppercase tracking-wider text-ink-500 mb-3">Also worth reading</h2>
        <div className="flex flex-wrap gap-2">
          {others.map((other) => (
            <Link
              key={other.slug}
              href={`/legal/${other.slug}`}
              className="px-4 py-2.5 rounded-full text-sm font-bold bg-surface border border-line hover:border-green-600 transition"
            >
              {other.shortTitle}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
