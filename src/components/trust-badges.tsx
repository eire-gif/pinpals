import { reliabilityBadge, verifiedLabel, type Reliability, type Tone } from "@/lib/reliability";

/**
 * The two trust chips (0188): Verified golfer, and tee-time reliability.
 * Server-safe (no hooks), used on member pages, profiles and requests.
 */

const TONE: Record<Tone, string> = {
  good: "bg-green-100 text-green-800",
  neutral: "bg-cream-100 text-ink-900",
  warn: "bg-[#f7edcf] text-[#6b5212]",
  bad: "bg-red-100 text-red-600",
};

export function VerifiedChip({ club, compact = false, onDark = false }: { club?: string | null; compact?: boolean; onDark?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-full ${onDark ? "bg-gold-400 text-navy-900" : "bg-navy-900 text-cream-50"}`}
      title="Membership checked against their Golf Ireland or club card"
    >
      <svg aria-hidden viewBox="0 0 20 20" className={`w-3.5 h-3.5 ${onDark ? "fill-navy-900" : "fill-gold-400"}`}>
        <path d="M10 1.5l2.2 1.6 2.7-.2.9 2.6 2.2 1.6-.8 2.6.8 2.6-2.2 1.6-.9 2.6-2.7-.2L10 18.5l-2.2-1.6-2.7.2-.9-2.6-2.2-1.6.8-2.6-.8-2.6 2.2-1.6.9-2.6 2.7.2z" />
        <path d="M8.6 12.6L6 10l1-1 1.6 1.6L13 6.2l1 1z" className={onDark ? "fill-gold-400" : "fill-navy-900"} />
      </svg>
      {compact ? "Verified" : verifiedLabel(club)}
    </span>
  );
}

export function ReliabilityChip({ reliability }: { reliability: Reliability | null | undefined }) {
  const { label, tone } = reliabilityBadge(reliability);
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-full ${TONE[tone]}`} title="Tee times turned up for, over the last 12 months">
      {label}
    </span>
  );
}

export default function TrustBadges({
  reliability,
  verified,
  verifiedClub,
  className = "",
  onDark = false,
}: {
  reliability: Reliability | null | undefined;
  verified: boolean;
  verifiedClub?: string | null;
  className?: string;
  onDark?: boolean;
}) {
  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {verified && <VerifiedChip club={verifiedClub} onDark={onDark} />}
      <ReliabilityChip reliability={reliability} />
    </div>
  );
}
