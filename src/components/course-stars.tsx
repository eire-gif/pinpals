/**
 * Course ratings on the website — the same rules as the app's stars.tsx:
 * a course nobody has rated shows nothing rather than five grey stars, and
 * the number always sits beside the stars so colour is never the only cue.
 *
 * The gold is darker than gold-400 for contrast on cream and white.
 */
const GOLD = "#b5841a";
const EMPTY = "#d7cdb5";

export function Stars({ value, size = 14 }: { value: number; size?: number }) {
  const halves = Math.round(value * 2);
  return (
    <span className="inline-flex items-center" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((n) => {
        const full = halves >= n * 2;
        const half = halves === n * 2 - 1;
        const id = `half-${n}-${size}`;
        return (
          <svg key={n} width={size} height={size} viewBox="0 0 24 24">
            {half && (
              <defs>
                <linearGradient id={id}>
                  <stop offset="50%" stopColor={GOLD} />
                  <stop offset="50%" stopColor={EMPTY} />
                </linearGradient>
              </defs>
            )}
            <path
              d="M12 2.8l2.8 5.8 6.3.8-4.6 4.4 1.2 6.3L12 17l-5.7 3.1 1.2-6.3-4.6-4.4 6.3-.8z"
              fill={full ? GOLD : half ? `url(#${id})` : EMPTY}
            />
          </svg>
        );
      })}
    </span>
  );
}

export function RatingLine({
  avg,
  count,
  size = 14,
  className = "",
}: {
  avg: number | null | undefined;
  count: number | null | undefined;
  size?: number;
  className?: string;
}) {
  if (!count || avg === null || avg === undefined) return null;
  const value = Number(avg);
  return (
    <span
      className={`inline-flex items-center gap-1.5 ${className}`}
      aria-label={`Rated ${value.toFixed(1)} out of 5 from ${count} ${count === 1 ? "rating" : "ratings"}`}
    >
      <Stars value={value} size={size} />
      <span className="font-semibold">{value.toFixed(1)}</span>
      <span className="opacity-70">({count})</span>
    </span>
  );
}
