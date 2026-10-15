import type { ReactNode } from "react";

import { Pill } from "@/components/society-console/ui";
import { tripBadge, tripRangeLabel, type OutingKind } from "@/lib/society-console/events-trips";
import { outingDateLabel } from "@/lib/society-console/outing-rules";

/** Server-safe pieces shared by the events pages. */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The calendar block on the left of an event: "TUE / 20 / NOV". */
export function DateBlock({ date, trip, cancelled }: { date: string; trip?: boolean; cancelled?: boolean }) {
  const [y, m, d] = date.split("-").map(Number);
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return (
    <div
      className={`w-16 shrink-0 rounded-xl text-center py-2 ${cancelled ? "bg-cream-100 text-ink-500" : trip ? "bg-navy-900 text-cream-50" : "bg-green-700 text-cream-50"}`}
      aria-hidden
    >
      <div className={`text-[10px] font-bold tracking-[0.12em] ${cancelled ? "" : "text-gold-400"}`}>{wd.toUpperCase()}</div>
      <div className="font-display font-bold text-2xl leading-none my-0.5">{d}</div>
      <div className="text-[11px] font-semibold uppercase">{MONTHS[m - 1]}</div>
    </div>
  );
}

export function KindBadge({ kind, playsOn, endsOn }: { kind: OutingKind; playsOn: string; endsOn: string | null }) {
  if (kind === "day" || !endsOn) return <Pill tone="green">Day out</Pill>;
  return <Pill tone="navy">{tripBadge(kind, playsOn, endsOn)}</Pill>;
}

export const whenText = (kind: OutingKind, playsOn: string, endsOn: string | null): string => (kind !== "day" && endsOn ? tripRangeLabel(playsOn, endsOn) : outingDateLabel(playsOn));

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-500">{label}</div>
      <div className="text-sm text-ink-900 font-semibold break-words">{children}</div>
    </div>
  );
}
