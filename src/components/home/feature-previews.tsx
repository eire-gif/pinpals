import type { ReactNode } from "react";

// Small building blocks for the homepage's feature tiles. The previews are
// drawn in the app's own style with sample data (made-up names and scores).

export function Eyebrow({ children, className = "text-gold-500" }: { children: ReactNode; className?: string }) {
  return <span className={`text-[13px] font-semibold tracking-[.18em] uppercase ${className}`}>{children}</span>;
}

export function FeatureTile({ title, body, children }: { title: string; body: string; children: ReactNode }) {
  return (
    <article className="rounded-3xl bg-[#11264A] border border-white/10 p-6 flex flex-col gap-5 text-[#F2ECE0]">
      <div className="relative h-[200px] rounded-2xl overflow-hidden bg-[#0B1A33] border border-white/5">{children}</div>
      <div>
        <h3 className="font-display font-semibold text-2xl mb-1.5">{title}</h3>
        <p className="text-[15px] leading-relaxed text-[#B9C3D3]">{body}</p>
      </div>
    </article>
  );
}

const CHIP_TONES = {
  gold: "bg-gold-400 text-navy-900",
  navy: "bg-[#20385E] text-[#C8D0DD]",
  green: "bg-[#173A2A] text-[#7BE08F]",
} as const;

export function Chip({ tone, children }: { tone: keyof typeof CHIP_TONES; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-[13px] font-semibold whitespace-nowrap ${CHIP_TONES[tone]}`}>
      {children}
    </span>
  );
}

export function Avatar({ initials, colour, overlap = false }: { initials: string; colour: string; overlap?: boolean }) {
  return (
    <span
      className={`w-8 h-8 rounded-full border-2 border-[#0B1A33] text-[11px] font-bold text-navy-900 inline-flex items-center justify-center shrink-0 ${overlap ? "-ml-2" : ""}`}
      style={{ background: colour }}
    >
      {initials}
    </span>
  );
}

// The app's scorecard, front nine: birdies ringed, bogeys boxed, doubles
// double-boxed — the same marks as the real card.
const PARS = [4, 4, 3, 5, 4, 5, 4, 4, 3];
const SCORES = [4, 5, 3, 6, 4, 4, 5, 6, 3];

function ScoreMark({ score, par }: { score: number; par: number }) {
  const diff = score - par;
  const base = "w-[15px] h-[15px] inline-flex items-center justify-center";
  if (diff <= -1) return <span className={`${base} rounded-full border border-[#A33A2A]`}>{score}</span>;
  if (diff === 1) return <span className={`${base} border border-[#A33A2A]`}>{score}</span>;
  if (diff >= 2) return <span className={`${base} border border-[#A33A2A] outline outline-1 outline-offset-1 outline-[#A33A2A]`}>{score}</span>;
  return <span>{score}</span>;
}

export function MiniScorecard() {
  return (
    <div aria-hidden="true" className="h-full bg-[#F4F0E6] text-[#13203A] p-3 flex flex-col gap-2">
      <div className="rounded-lg bg-[#13203A] text-white px-3 py-2">
        <div className="flex justify-between items-baseline gap-2">
          <span className="font-display font-bold text-[15px] truncate">Portmarnock Links</span>
          <span className="text-[9px] font-bold tracking-[.12em] text-gold-400 shrink-0">SAT 11 OCT</span>
        </div>
        <div className="mt-1.5 grid grid-cols-4 gap-1 text-center">
          {[
            ["84", "Score", true],
            ["+11", "To par", false],
            ["39", "Points", false],
            ["70", "Net", false],
          ].map(([v, l, gold]) => (
            <span key={String(l)} className="rounded-md bg-[#22314F] py-1">
              <b className={`block font-display text-sm leading-none ${gold ? "text-gold-400" : ""}`}>{v}</b>
              <span className="text-[9px] text-[#C8D0DD]">{l}</span>
            </span>
          ))}
        </div>
      </div>
      <div className="rounded-lg overflow-hidden bg-white border border-[#E3DCCB] text-[10px] text-center">
        <div className="grid grid-cols-[34px_repeat(9,minmax(0,1fr))] bg-[#1F4A2C] text-white font-bold py-0.5">
          <span className="text-left pl-1.5">Hole</span>
          {PARS.map((_, i) => (
            <span key={i}>{i + 1}</span>
          ))}
        </div>
        <div className="grid grid-cols-[34px_repeat(9,minmax(0,1fr))] py-0.5 border-b border-[#EEE8DA]">
          <span className="text-left pl-1.5 text-ink-500">Par</span>
          {PARS.map((p, i) => (
            <span key={i}>{p}</span>
          ))}
        </div>
        <div className="grid grid-cols-[34px_repeat(9,minmax(0,1fr))] py-1 items-center font-bold">
          <span className="text-left pl-1.5 font-semibold">Score</span>
          {SCORES.map((s, i) => (
            <span key={i} className="flex justify-center">
              <ScoreMark score={s} par={PARS[i]} />
            </span>
          ))}
        </div>
      </div>
      <div className="mt-auto flex items-center gap-1.5 text-[11px] font-semibold text-[#1F4A2C]">
        <span className="w-4 h-4 rounded-full bg-[#2E6B3A] inline-flex items-center justify-center">
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5">
            <path d="M5 12l5 5L20 7" />
          </svg>
        </span>
        Certified by Tom Byrne · Face ID
      </div>
    </div>
  );
}

// The app's results podium: ringed initials, then navy / navy / green blocks.
const PODIUM = [
  { place: 2, name: "Ciarán B.", pts: 39, ring: "#9AA8BE", block: "#16305E", h: 54 },
  { place: 1, name: "Niamh K.", pts: 41, ring: "#D3A53F", block: "#0C2038", h: 78 },
  { place: 3, name: "Tom G.", pts: 37, ring: "#B07A4A", block: "#1F5C2E", h: 40 },
];

export function MiniPodium() {
  return (
    <div aria-hidden="true" className="h-full bg-[#F4F0E6] text-[#13203A] px-3 pt-3 flex flex-col">
      <div className="flex justify-between items-baseline">
        <span className="font-display font-bold text-[13px]">Captain&rsquo;s Prize</span>
        <span className="text-[9px] font-bold tracking-[.12em] text-[#1F5C2E]">4 OF 4 CARDS IN</span>
      </div>
      <div className="mt-auto flex items-end gap-2">
        {PODIUM.map((p) => (
          <div key={p.place} className="flex-1 min-w-0 flex flex-col items-center">
            <span
              className="w-9 h-9 rounded-full border-[3px] bg-[#EFE7D6] text-[11px] font-bold inline-flex items-center justify-center"
              style={{ borderColor: p.ring }}
            >
              {p.name.split(" ").map((w) => w[0]).join("")}
            </span>
            <span className="mt-1 text-[11px] font-bold truncate max-w-full">{p.name}</span>
            <span className="text-[10px] text-ink-500">{p.pts} pts</span>
            <span
              className="mt-1 w-full rounded-t-lg flex items-center justify-center font-display font-bold text-xl"
              style={{ height: p.h, background: p.block, color: p.place === 1 ? "#E8C46B" : "#fff" }}
            >
              {p.place}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
