import type { Metadata } from "next";

import { RA_RULES_HUB, RULES_EDITION } from "@/lib/rules-of-golf";
import { RulesFinder } from "./rules-finder";

export const metadata: Metadata = {
  title: "Rules of Golf lookup | Pinpals",
  description:
    "Search the Rules of Golf in plain English — lost ball, out of bounds, penalty areas, unplayable, free relief and more — with a link to the official R&A wording for every rule.",
  alternates: { canonical: "/rules" },
};

export default async function RulesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const { q } = await searchParams;
  const initial = (Array.isArray(q) ? q[0] : q) ?? "";

  return (
    <div className="max-w-6xl mx-auto px-6 pb-20">
      <header className="pt-14 pb-8 max-w-[720px]">
        <span className="block mb-5 text-xs font-bold uppercase tracking-[0.14em] text-gold-600">
          &mdash; Rules of Golf &mdash; {RULES_EDITION.name.replace(" Rules of Golf", " edition")}
        </span>
        <h1 className="font-display font-bold text-[clamp(36px,6vw,56px)] leading-[1.05] tracking-tight text-ink-900 text-balance">
          Settle it <em className="italic text-gold-500">on the course</em>.
        </h1>
        <p className="mt-5 max-w-[60ch] text-lg leading-relaxed text-ink-500">
          Type what happened &mdash; &ldquo;lost ball&rdquo;, &ldquo;plugged&rdquo;,
          &ldquo;cart path&rdquo; or a rule number &mdash; and get the answer in plain
          English, with the official R&amp;A wording one tap away.
        </p>
      </header>

      <RulesFinder initialQuery={initial.slice(0, 80)} />

      <aside className="mt-14 max-w-[720px] rounded-2xl border border-line bg-surface-tint p-7">
        <h2 className="font-display font-bold text-2xl text-ink-900">About these summaries</h2>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-500">
          The Rules of Golf are written and published by The R&amp;A and the USGA, and
          their wording is the only official version. The summaries here are written by
          Pinpals to help you find the right Rule quickly; they are not the Rules
          themselves, and where they differ the official text wins. Your club or
          competition may also have Local Rules &mdash; check the scorecard or notice
          board. The current edition applies until the next one takes effect on{" "}
          {RULES_EDITION.nextEdition}.
        </p>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-500">
          For the full Rules, Clarifications and the free official Rules app, visit{" "}
          <a
            href={RA_RULES_HUB}
            target="_blank"
            rel="noopener noreferrer"
            className="text-green-700 underline underline-offset-2"
          >
            The R&amp;A&rsquo;s Rules hub
          </a>
          .
        </p>
      </aside>
    </div>
  );
}
