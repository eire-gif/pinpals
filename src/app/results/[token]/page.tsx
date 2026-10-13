import Link from "next/link";
import type { Metadata } from "next";

import { loadPublishedResults } from "@/lib/competition-results-server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * A competition's published results, for anyone with the link (0137) —
 * what an organiser or member shares to WhatsApp or the society's page.
 *
 * Public on purpose, like /s/<token>: a link preview fetches it with no
 * session. It shows only what was published — names as on the cards,
 * places, scores and how ties were broken — never a member's profile or
 * card. Taking the results down (competition_results_withdraw) clears the
 * token, and the link stops working.
 */

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const data = await loadPublishedResults(createAdminClient(), token);
  const title = data ? `${data.title} — results` : "Results";
  const winner = data?.results.prizes[0]?.winners[0];
  const description = data ? `${data.courseName}.${winner ? ` Won by ${winner.name} (${winner.score}).` : ""}` : "Competition results on PinPals.";
  return {
    title: `${title} · PinPals`,
    description,
    openGraph: { title, description, type: "website", siteName: "PinPals" },
    twitter: { card: "summary_large_image", title, description },
    robots: { index: false, follow: false },
  };
}

export default async function ResultsPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await loadPublishedResults(createAdminClient(), token);
  if (!data) {
    return (
      <div className="max-w-[720px] mx-auto px-4 sm:px-6 py-16 grid gap-4 text-center">
        <h1 className="font-display text-3xl text-ink-900">These results aren&apos;t available</h1>
        <p className="text-ink-500">The organiser may have taken them down.</p>
      </div>
    );
  }
  const r = data.results;
  const unit = r.basis === "stableford" ? "Pts" : "Net";

  return (
    <div className="max-w-[760px] mx-auto px-4 sm:px-6 py-10 grid gap-6">
      {/* eslint-disable-next-line @next/next/no-img-element -- a generated PNG at a fixed size */}
      <img src={`/results/${token}/opengraph-image`} alt={`${data.title} results`} width={1200} height={630} className="w-full h-auto rounded-2xl border border-line shadow-sm" />

      <div className="grid gap-1">
        <p className="text-sm font-bold uppercase tracking-widest text-green-700">{data.version > 1 ? "Results · updated" : "Results"}</p>
        <h1 className="font-display text-3xl text-ink-900">{data.title}</h1>
        <p className="text-ink-500">{data.courseName}</p>
      </div>

      {r.divisions.map((d) => (
        <section key={d.label} className="grid gap-2">
          <h2 className="font-display text-2xl text-ink-900">
            {d.label}
            {d.range ? <span className="text-base font-sans text-ink-500"> · playing handicap {d.range}</span> : null}
          </h2>
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="bg-navy-900 text-cream-50 text-xs uppercase tracking-wider">
                <tr>
                  <th scope="col" className="text-left px-3 py-2">Pos</th>
                  <th scope="col" className="text-left px-2 py-2">{r.team ? "Entry" : "Player"}</th>
                  <th scope="col" className="text-center px-2 py-2">Hcp</th>
                  <th scope="col" className="text-center px-2 py-2">{r.holes === 18 ? "B9" : "L6"}</th>
                  <th scope="col" className="text-right px-3 py-2">{unit}</th>
                </tr>
              </thead>
              <tbody>
                {d.ranking.rows.map((row) => (
                  <tr key={row.key} className={`border-t border-line ${row.position != null && row.position <= 3 ? "bg-gold-400/15" : ""}`}>
                    <td className="px-3 py-2 font-display text-lg text-navy-900">{row.positionLabel}</td>
                    <td className="px-2 py-2">
                      <div className="font-semibold text-ink-900">{row.name}</div>
                      {row.detail ? <div className="text-xs text-ink-500">{row.detail}</div> : null}
                      {row.note ? <div className={`text-xs ${row.wonTie ? "text-green-700 font-semibold" : "text-ink-500"}`}>{row.note}</div> : null}
                    </td>
                    <td className="text-center px-2 py-2 text-ink-500">{row.handicap}</td>
                    <td className="text-center px-2 py-2 text-ink-500">{row.back ?? "–"}</td>
                    <td className="text-right px-3 py-2 font-bold text-ink-900">{row.score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {r.prizes.some((p) => !r.divisions.some((d) => d.label === p.label)) ? (
        <section className="grid gap-2">
          <h2 className="font-display text-2xl text-ink-900">Prizes</h2>
          <ul className="grid gap-2">
            {r.prizes
              .filter((p) => !r.divisions.some((d) => d.label === p.label))
              .map((p) => (
                <li key={p.label} className="flex justify-between rounded-xl border border-line bg-surface px-4 py-3">
                  <span className="font-semibold text-ink-900">{p.label}</span>
                  <span className="text-ink-900">
                    {p.winners.map((w) => `${w.name}${w.score ? ` · ${w.score}` : ""}`).join(", ")}
                  </span>
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      <p className="rounded-2xl bg-navy-900 text-cream-100 px-5 py-4 text-sm leading-relaxed">{r.rule}</p>

      <div className="flex flex-wrap gap-3">
        <Link href="/signup" className="rounded-full bg-green-700 text-cream-50 font-bold px-6 py-3 hover:bg-green-800">
          Score your society&apos;s days on PinPals
        </Link>
      </div>
    </div>
  );
}
