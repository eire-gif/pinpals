import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The frame for /privacy and /terms (Oct 2026): a plain, readable column with
 * a contents list, in the site's colours. The words are in each page.
 */
export const LEGAL_UPDATED = "28 October 2026";

export type LegalSection = { id: string; title: string; body: ReactNode };

export function LegalPage({
  eyebrow,
  title,
  intro,
  sections,
  other,
}: {
  eyebrow: string;
  title: string;
  intro: ReactNode;
  sections: LegalSection[];
  other: { href: string; label: string };
}) {
  return (
    <div className="max-w-3xl mx-auto px-6 pb-20">
      <header className="pt-14 pb-8">
        <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-green-700">
          <span className="w-5 h-0.5 bg-gold-500 inline-block" /> {eyebrow}
        </span>
        <h1 className="font-display font-bold text-[clamp(32px,5vw,48px)] leading-tight mt-3 text-ink-900">{title}</h1>
        <p className="mt-2 text-sm text-ink-500">Last updated {LEGAL_UPDATED}</p>
        <div className="mt-6 text-lg leading-relaxed text-ink-900 grid gap-4">{intro}</div>
      </header>

      <nav aria-label="Contents" className="bg-surface border border-line rounded-2xl p-6 mb-10">
        <h2 className="text-xs font-bold uppercase tracking-wider text-ink-500 mb-3">Contents</h2>
        <ol className="grid gap-1.5 text-sm list-decimal list-inside">
          {sections.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="text-green-700 font-semibold hover:text-green-600">
                {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="grid gap-10">
        {sections.map((s, i) => (
          <section key={s.id} id={s.id} className="scroll-mt-24">
            <h2 className="font-display font-bold text-2xl text-ink-900 mb-3">
              {i + 1}. {s.title}
            </h2>
            <div className="legal-body grid gap-3 text-[15.5px] leading-relaxed text-ink-900">{s.body}</div>
          </section>
        ))}
      </div>

      <p className="mt-14 pt-6 border-t border-line text-sm text-ink-500">
        Questions? Email{" "}
        <a href="mailto:info@pinpals.ie" className="text-green-700 font-semibold">
          info@pinpals.ie
        </a>
        . See also our{" "}
        <Link href={other.href} className="text-green-700 font-semibold">
          {other.label}
        </Link>
        .
      </p>
    </div>
  );
}

/** A bulleted list in the legal pages' style. */
export function Bullets({ children }: { children: ReactNode }) {
  return <ul className="list-disc pl-5 grid gap-1.5">{children}</ul>;
}
