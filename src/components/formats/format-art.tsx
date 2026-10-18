import type { FormatCategory, FormatVisual } from "@/lib/game-formats";

/**
 * The pictures on a format's page (/formats/[slug]) — the same three the app
 * draws in mobile/src/components/format-art.tsx: Stableford's points ladder,
 * Foursomes' shot order and tee plan, the Scramble's drives and team handicap.
 */

/** Tile colour per category — matches the app. */
export const TILE_CLASS: Record<FormatCategory, string> = {
  individual: "bg-navy-900",
  matchplay: "bg-navy-800",
  pairs: "bg-green-700",
  team: "bg-navy-800",
  side: "bg-navy-900",
};

/** Navy card with a hairline gold border inset — the house frame. */
export function GoldFrame({
  children,
  tone = "bg-navy-900",
  className = "",
}: {
  children: React.ReactNode;
  tone?: string;
  className?: string;
}) {
  return (
    <div className={`${tone} rounded-[22px] p-[5px] shadow-[0_6px_18px_rgba(12,32,56,0.15)] ${className}`}>
      <div className="rounded-[17px] border border-gold-500/60 p-5 flex flex-col gap-4 h-full">{children}</div>
    </div>
  );
}

const kicker = "text-[11px] font-bold tracking-[0.18em] uppercase";

const POINTS = [
  { label: "Net albatross", pts: 5, bar: "bg-green-700", text: "text-green-700" },
  { label: "Net eagle", pts: 4, bar: "bg-green-600", text: "text-green-700" },
  { label: "Net birdie", pts: 3, bar: "bg-gold-500", text: "text-navy-900" },
  { label: "Net par", pts: 2, bar: "bg-navy-900", text: "text-navy-900", strong: true },
  { label: "Net bogey", pts: 1, bar: "bg-ink-500", text: "text-ink-500" },
  { label: "Net double bogey or worse", pts: 0, bar: "", text: "text-red-600" },
];

function PointsLadder() {
  return (
    <figure className="rounded-[22px] border border-line bg-surface p-6">
      <figcaption className={`${kicker} text-gold-600`}>The points</figcaption>
      <dl className="mt-4 flex flex-col gap-2.5">
        {POINTS.map((p) => (
          <div key={p.label} className="flex items-center gap-3">
            <dt className={`w-[44%] sm:w-52 shrink-0 text-[15px] ${p.strong ? "font-bold text-navy-900" : "font-semibold text-ink-900"}`}>{p.label}</dt>
            <div className={`flex-1 h-6 rounded-md overflow-hidden ${p.pts === 0 ? "bg-red-100" : "bg-green-100"}`} aria-hidden="true">
              {p.pts > 0 ? <div className={`h-full rounded-md ${p.bar}`} style={{ width: `${p.pts * 20}%` }} /> : null}
            </div>
            <dd className={`w-6 text-right text-lg font-bold ${p.text}`}>{p.pts}</dd>
          </div>
        ))}
      </dl>
    </figure>
  );
}

const SHOTS = [
  { who: "B", what: "Putt — holed" },
  { who: "A", what: "Approach" },
  { who: "B", what: "Second shot" },
  { who: "A", what: "Drive — odd hole" },
];

function AlternateShot() {
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <GoldFrame>
        <p className={`${kicker} text-gold-500`}>One hole, shot by shot</p>
        <div className="flex gap-5">
          <div
            aria-hidden="true"
            className="w-[76px] shrink-0 rounded-t-[38px] rounded-b-[18px] bg-green-700 border border-gold-400/50 py-4 flex flex-col items-center justify-between gap-3"
          >
            <svg width="22" height="26" viewBox="0 0 22 26" fill="none">
              <path d="M6 24V3" stroke="#f7f3ea" strokeWidth="2" strokeLinecap="round" />
              <path d="M6 3l12 4-12 4z" fill="#e8c46b" />
            </svg>
            {SHOTS.map((s, i) => (
              <span
                key={i}
                className={`w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-bold text-navy-900 ${s.who === "A" ? "bg-gold-400" : "bg-cream-50"} ${i === SHOTS.length - 1 ? "ring-4 ring-gold-400/40" : ""}`}
              >
                {s.who}
              </span>
            ))}
          </div>
          <ol className="flex-1 flex flex-col justify-between py-2 text-[14px] text-cream-100">
            <li><b className="text-cream-50">Holed</b> · 4 shots, one score</li>
            {SHOTS.map((s, i) => (
              <li key={i}>
                <b className={i === SHOTS.length - 1 ? "text-gold-400" : "text-cream-50"}>Player {s.who}</b> · {s.what}
              </li>
            ))}
          </ol>
        </div>
      </GoldFrame>

      <figure className="rounded-[22px] border border-line bg-surface p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <figcaption className={`${kicker} text-gold-600`}>Who drives where</figcaption>
          <div className="flex gap-3 text-xs font-bold text-ink-900">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-gold-500" />Player A</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-navy-900" />Player B</span>
          </div>
        </div>
        <div className="grid grid-cols-9 gap-1.5" role="img" aria-label="Player A drives every odd hole, player B every even hole.">
          {Array.from({ length: 18 }, (_, i) => i + 1).map((n) => (
            <span
              key={n}
              className={`h-9 rounded-lg flex items-center justify-center text-sm font-bold ${n % 2 ? "bg-gold-500 text-navy-900" : "bg-navy-900 text-gold-400"}`}
            >
              {n}
            </span>
          ))}
        </div>
        <p className="text-sm text-ink-500 leading-relaxed">
          Check which par 3s land on odd and even holes — pick the order to suit whoever&rsquo;s better with the irons.
        </p>
      </figure>
    </div>
  );
}

const TEAM = [
  { name: "Player 1", ch: 6, share: 0.25 },
  { name: "Player 2", ch: 12, share: 0.2 },
  { name: "Player 3", ch: 18, share: 0.15 },
  { name: "Player 4", ch: 24, share: 0.1 },
];

function ScrambleDrives() {
  const total = TEAM.reduce((s, p) => s + p.ch * p.share, 0);
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <GoldFrame>
        <p className={`${kicker} text-gold-500`}>Four drives, one chosen</p>
        <div
          role="img"
          aria-label="Four drives on the fairway. The best one is circled in gold, and everyone plays the next shot from there."
          className="relative h-40 rounded-2xl bg-green-700 border border-gold-400/40 overflow-hidden"
        >
          <div className="absolute inset-y-0 left-[24%] right-[24%] bg-green-600" />
          <span className="absolute left-[12%] top-11 w-3 h-3 rounded-full bg-cream-100/75" />
          <span className="absolute left-[30%] top-16 w-3 h-3 rounded-full bg-cream-100/75" />
          <span className="absolute left-[66%] top-[88px] w-3 h-3 rounded-full bg-cream-100/75" />
          <span className="absolute left-[44%] top-5 w-9 h-9 rounded-full border-[3px] border-gold-400 flex items-center justify-center">
            <span className="w-3 h-3 rounded-full bg-cream-50" />
          </span>
          <span className="absolute left-[58%] top-6 rounded-md bg-gold-400 px-1.5 py-0.5 text-[11px] font-bold text-navy-900">Best drive</span>
          <span className="absolute left-[44%] bottom-3 w-5 h-3 rounded bg-gold-500" />
          <span className="absolute left-2 bottom-2 text-[10px] font-bold text-cream-100">TEE</span>
        </div>
        <p className="text-sm text-cream-100 leading-relaxed">
          Everyone drops within a club-length of the chosen ball and plays the next shot. Repeat until it&rsquo;s holed.
        </p>
      </GoldFrame>

      <figure className="rounded-[22px] border-[1.5px] border-dashed border-gold-500 bg-surface-tint p-6 flex flex-col gap-3">
        <figcaption className={`${kicker} text-gold-600`}>Team handicap · team of four</figcaption>
        <p className="text-[15px] text-ink-900">Course handicaps lowest to highest, then a set share of each:</p>
        <table className="w-full rounded-xl overflow-hidden border border-line bg-surface text-[15px]">
          <tbody>
            {TEAM.map((p) => (
              <tr key={p.name} className="border-t border-cream-100 first:border-t-0">
                <td className="px-3 py-2.5">{p.name} · {p.ch}</td>
                <td className="px-3 py-2.5 text-ink-500">× {Math.round(p.share * 100)}%</td>
                <td className="px-3 py-2.5 text-right font-bold">{(p.ch * p.share).toFixed(1)}</td>
              </tr>
            ))}
            <tr className="bg-navy-900 text-cream-50">
              <td className="px-3 py-3 font-bold" colSpan={2}>Team handicap</td>
              <td className="px-3 py-3 text-right font-bold text-gold-400">{Math.floor(total + 0.5)}</td>
            </tr>
          </tbody>
        </table>
        <p className="text-sm text-ink-500">Team of two: 35% of the lower course handicap plus 15% of the higher.</p>
      </figure>
    </div>
  );
}

export function FormatArt({ visual }: { visual: FormatVisual }) {
  if (visual === "points") return <PointsLadder />;
  if (visual === "alternate") return <AlternateShot />;
  return <ScrambleDrives />;
}
