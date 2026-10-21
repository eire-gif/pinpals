import Link from "next/link";

import type { MyRound } from "@/lib/my-round";

/**
 * MY ROUND (Oct 2026): in the site header while a round you're playing in is
 * live, as in the app. Scoring is in the app, so the link is the round's
 * /live/rounds/<id> address: on a phone with PinPals it opens the round in
 * the app (universal links); elsewhere that page says to open it there.
 *
 * `compact` for the narrow phone bar beside the menu button: the hole alone.
 */
export default function MyRoundPill({ round, compact = false }: { round: MyRound; compact?: boolean }) {
  return (
    <Link
      href={`/live/rounds/${round.id}`}
      aria-label={`My round is live, hole ${round.hole}. Open your scoring.`}
      className="my-round-pulse inline-flex items-center gap-2 h-10 pl-3 pr-4 rounded-full border-[1.5px] border-cream-50/55 bg-[#128043] text-cream-50 text-sm font-extrabold tracking-[0.06em] whitespace-nowrap hover:brightness-110 transition-[filter]"
    >
      <span className="my-round-dot w-2.5 h-2.5 rounded-full bg-cream-50" aria-hidden="true" />
      {compact ? (
        <span>H{round.hole}</span>
      ) : (
        <span>
          MY ROUND <span className="font-semibold opacity-90">· H{round.hole}</span>
        </span>
      )}
    </Link>
  );
}
