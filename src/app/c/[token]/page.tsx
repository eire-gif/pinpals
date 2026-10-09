import Link from "next/link";
import type { Metadata } from "next";

import { headline, holeResult, playedLabel, scorecardTotals, type ScorecardHole } from "@/lib/scorecard-math";
import { scorecardImagePath } from "@/lib/scorecard-links";
import { loadSharedScorecard } from "@/lib/scorecard-share-server";

/**
 * A scorecard someone sent by WhatsApp or text (0110).
 *
 * Public on purpose: the person it was sent to may not be a member, and a
 * link preview has no session. The owner chose to send it, so it shows the
 * whole card — but nothing else about them, and only while the card exists.
 * Not indexed.
 */
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const card = await loadSharedScorecard(token);
  const title = card ? `${card.firstName ?? "A golfer"}'s card at ${card.courseName}` : "A scorecard on PinPals";
  const description = card ? `${headline(scorecardTotals(card.holeList, card.playingHandicap))} · ${playedLabel(card.playedOn)}` : "Golfers in Ireland swapping tee times, scores and gear.";
  return {
    title: `${title} · PinPals`,
    description,
    openGraph: { title, description, type: "website", siteName: "PinPals" },
    twitter: { card: "summary_large_image", title, description },
    robots: { index: false, follow: false },
  };
}

const markClass = (h: ScorecardHole) => {
  if (h.strokes == null) return "";
  const r = holeResult(h.strokes, h.par);
  if (r === "birdie") return "rounded-full ring-2 ring-green-700";
  if (r === "eagle" || r === "albatross") return "rounded-full ring-4 ring-green-700";
  if (r === "bogey") return "ring-2 ring-red-600";
  if (r === "double" || r === "worse") return "ring-4 ring-red-600";
  return "";
};

function Nine({ title, holes, par, strokes, yards }: { title: string; holes: ScorecardHole[]; par: number; strokes: number | null; yards: number | null }) {
  const showYards = holes.some((h) => h.yards != null);
  const showSI = holes.some((h) => h.strokeIndex != null);
  const cell = "px-1 py-1.5 text-center tabular-nums";
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full text-sm">
        <tbody>
          <tr className="bg-green-800 text-cream-50 font-bold">
            <th className="px-2 py-1.5 text-left">Hole</th>
            {holes.map((h) => (
              <td key={h.hole} className={cell}>{h.hole}</td>
            ))}
            <td className={`${cell} font-bold`}>{title}</td>
          </tr>
          {showYards ? (
            <tr className="text-ink-500 text-xs">
              <th className="px-2 py-1 text-left">Yds</th>
              {holes.map((h) => (
                <td key={h.hole} className={cell}>{h.yards ?? "–"}</td>
              ))}
              <td className={cell}>{yards ?? "–"}</td>
            </tr>
          ) : null}
          <tr>
            <th className="px-2 py-1 text-left text-ink-500">Par</th>
            {holes.map((h) => (
              <td key={h.hole} className={cell}>{h.par}</td>
            ))}
            <td className={`${cell} bg-cream-100`}>{par}</td>
          </tr>
          {showSI ? (
            <tr className="text-ink-500 text-xs">
              <th className="px-2 py-1 text-left">SI</th>
              {holes.map((h) => (
                <td key={h.hole} className={cell}>{h.strokeIndex ?? "–"}</td>
              ))}
              <td className={cell} />
            </tr>
          ) : null}
          <tr className="font-bold">
            <th className="px-2 py-1.5 text-left">Score</th>
            {holes.map((h) => (
              <td key={h.hole} className={cell}>
                <span className={`inline-flex h-7 w-7 items-center justify-center ${markClass(h)}`}>{h.strokes ?? "–"}</span>
              </td>
            ))}
            <td className={`${cell} bg-cream-100 font-display text-lg`}>{strokes ?? "–"}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default async function SharedScorecardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const card = await loadSharedScorecard(token);

  if (!card) {
    return (
      <div className="max-w-[720px] mx-auto px-4 sm:px-6 py-16 grid gap-4 text-center">
        <h1 className="font-display text-3xl text-ink-900">This scorecard isn&apos;t available</h1>
        <p className="text-ink-500">It may have been deleted by the golfer who sent it.</p>
        <div>
          <Link href="/signup" className="inline-block rounded-full bg-green-700 text-cream-50 font-bold px-6 py-3 hover:bg-green-800">
            Join PinPals — it&apos;s free
          </Link>
        </div>
      </div>
    );
  }

  const t = scorecardTotals(card.holeList, card.playingHandicap);
  const front = card.holeList.filter((h) => h.hole <= 9);
  const back = card.holeList.filter((h) => h.hole > 9);

  return (
    <div className="max-w-[860px] mx-auto px-4 sm:px-6 py-10 grid gap-6">
      {/* eslint-disable-next-line @next/next/no-img-element -- a generated PNG at a fixed size */}
      <img src={scorecardImagePath(token)} alt="" width={1200} height={630} className="w-full h-auto rounded-2xl border border-line shadow-sm" />
      <div className="grid gap-1">
        <p className="text-sm font-bold uppercase tracking-widest text-green-700">{playedLabel(card.playedOn)}</p>
        <h1 className="font-display text-3xl text-ink-900">
          {card.firstName ?? "A golfer"} at {card.courseName}
        </h1>
        <p className="text-ink-500">
          {[card.teeName ? `${card.teeName} tees` : null, headline(t), card.playingHandicap != null ? `plays off ${card.playingHandicap}` : null].filter(Boolean).join(" · ")}
        </p>
      </div>
      <Nine title={card.holes === 9 ? "Tot" : "Out"} holes={front} par={t.out.par} strokes={t.out.strokes} yards={t.out.yards} />
      {back.length > 0 && t.in ? <Nine title="In" holes={back} par={t.in.par} strokes={t.in.strokes} yards={t.in.yards} /> : null}
      <div className="flex flex-wrap gap-3">
        <Link href="/signup" className="rounded-full bg-green-700 text-cream-50 font-bold px-6 py-3 hover:bg-green-800">
          Keep your own cards on PinPals
        </Link>
        <Link href="/login" className="rounded-full border border-line bg-surface text-ink-900 font-bold px-6 py-3 hover:bg-surface-tint">
          Sign in
        </Link>
      </div>
    </div>
  );
}
