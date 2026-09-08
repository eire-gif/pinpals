import { formatTimeRemaining } from "@/lib/format";

// The task spec's "each card/row must emphasize the next action and
// deadline" — one small shared pill so every workspace list (buyer
// purchases, seller fulfilment queue, offers/bids, auctions) renders it
// identically rather than each row inventing its own version. Deliberately
// takes an ISO deadline string (or null) and formats it itself via the
// existing formatTimeRemaining() (src/lib/format.ts) — the one place this
// app already turns a deadline into "2d 4h left" — rather than accepting
// pre-formatted text, so every caller is guaranteed the same wording/rules
// (including the "Ending soon"/"Ended" edge cases) with no chance to drift.
export default function NextActionBadge({
  label,
  deadlineIso,
}: {
  label: string;
  deadlineIso?: string | null;
}) {
  return (
    <div className="inline-flex flex-wrap items-center gap-1.5 bg-gold-500/20 text-gold-700 text-xs font-bold px-2.5 py-1.5 rounded-full">
      <span className="w-1.5 h-1.5 rounded-full bg-gold-500 shrink-0" aria-hidden="true" />
      <span>{label}</span>
      {deadlineIso && <span className="font-semibold opacity-80">&middot; {formatTimeRemaining(deadlineIso)}</span>}
    </div>
  );
}
