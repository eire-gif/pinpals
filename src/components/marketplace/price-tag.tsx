import { formatPrice } from "@/lib/format";

// Presentational only — deliberately separate from src/components/
// price-summary.tsx, which computes and displays the buyer's fee-inclusive
// offer total (bidding math this phase doesn't touch). PriceTag just renders
// a listing's asking price consistently between the card grid and the
// detail page.
const SIZE_CLASSES = {
  sm: "text-sm font-bold",
  md: "text-lg font-display font-bold",
  lg: "text-2xl sm:text-3xl font-display font-bold",
} as const;

const TONE_CLASSES = {
  gold: "text-gold-600",
  white: "text-white",
  ink: "text-ink-900",
} as const;

export default function PriceTag({
  amountEur,
  size = "md",
  tone = "gold",
  className = "",
}: {
  amountEur: number;
  size?: keyof typeof SIZE_CLASSES;
  tone?: keyof typeof TONE_CLASSES;
  /** Layout-only utilities (display, margin) — never a color/font-size
   * class, which is what `size`/`tone` are for; keeping the two separate
   * avoids two conflicting Tailwind utilities of the same kind landing in
   * one class list. */
  className?: string;
}) {
  return (
    <span className={`${TONE_CLASSES[tone]} ${SIZE_CLASSES[size]} ${className}`}>
      {formatPrice(amountEur)}
    </span>
  );
}
