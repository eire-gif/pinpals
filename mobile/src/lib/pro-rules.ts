/**
 * Book a pro (0204): the pure parts — labels, Irish-time formatting, the
 * free-times grid, and what cancelling would refund. The database decides
 * (pro_booking_cancel); this only says it in advance, the same way.
 */

export type ProKind = "pga" | "teaching" | "fitter";
export type ServiceKind = "lesson" | "playing" | "fitting";
export type CancelPolicy = "24h" | "48h" | "none";
export type ProStatus = "pending" | "approved" | "declined" | "paused";
export type BookingStatus = "pending_payment" | "booked" | "cancelled" | "expired";

export const PRO_KIND_LABEL: Record<ProKind, string> = {
  pga: "PGA professional",
  teaching: "Teaching pro",
  fitter: "Club fitter",
};

/** The short badge on a pro's card. */
export const PRO_BADGE: Record<ProKind, string> = { pga: "PGA", teaching: "COACH", fitter: "FITTER" };

export const SERVICE_KIND_LABEL: Record<ServiceKind, string> = {
  lesson: "Lesson",
  playing: "Playing lesson",
  fitting: "Club fitting",
};

/** What a golfer can ask to work on. Must match pro_book()'s list. */
export const FOCUS_OPTIONS = ["Driver", "Woods", "Irons", "Short game", "Bunkers", "Putting", "Course strategy", "Fitting"] as const;

export const POLICY_LABEL: Record<CancelPolicy, string> = {
  "24h": "24 hours",
  "48h": "48 hours",
  none: "No refunds",
};

/** The terms, as the golfer reads them before paying. */
export function policyLine(policy: CancelPolicy, proName = "The pro"): string {
  if (policy === "none") return `${proName} doesn't refund if you cancel. If they cancel, you get everything back.`;
  return `Free cancellation up to ${POLICY_LABEL[policy]} before. After that, no refund. If ${proName === "The pro" ? "the pro" : proName} cancels, you get everything back.`;
}

/** PinPals keeps 10% (pros.commission_rate); what the pro gets. */
export function proTake(priceCents: number, rate = 0.1): number {
  return priceCents - Math.round(priceCents * rate);
}

export function euroCents(cents: number): string {
  const whole = cents % 100 === 0;
  return `€${(cents / 100).toLocaleString("en-IE", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

export const IRISH_TIME = "Europe/Dublin";

export type DublinParts = { dayKey: string; dow: string; day: number; month: string; time: string; minutes: number };

/** One instant, as a clock in Ireland reads it. */
export function dublinParts(iso: string | Date): DublinParts {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: IRISH_TIME,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value])
  ) as Record<string, string>;
  const month = Number(parts.month);
  const hour = Number(parts.hour) % 24;
  return {
    dayKey: `${parts.year}-${parts.month}-${parts.day}`,
    dow: parts.weekday,
    day: Number(parts.day),
    month: MONTHS[month - 1],
    time: `${hour}:${parts.minute}`,
    minutes: hour * 60 + Number(parts.minute),
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Tue 3 Nov, 11:30" */
export function lessonWhen(iso: string): string {
  const p = dublinParts(iso);
  return `${p.dow} ${p.day} ${p.month}, ${p.time}`;
}

/** "Today", "Tomorrow", "In 4 days" — by Irish calendar day. */
export function untilText(iso: string, now: Date = new Date()): string {
  const a = Date.parse(`${dublinParts(now).dayKey}T00:00:00Z`);
  const b = Date.parse(`${dublinParts(iso).dayKey}T00:00:00Z`);
  const days = Math.round((b - a) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `In ${days} days`;
}

export type SlotDay = { dayKey: string; dow: string; day: number; month: string; times: { iso: string; time: string; minutes: number }[] };

/** Free start times grouped by Irish day, in order. */
export function groupSlots(isos: string[]): SlotDay[] {
  const days = new Map<string, SlotDay>();
  for (const iso of [...isos].sort()) {
    const p = dublinParts(iso);
    let day = days.get(p.dayKey);
    if (!day) {
      day = { dayKey: p.dayKey, dow: p.dow, day: p.day, month: p.month, times: [] };
      days.set(p.dayKey, day);
    }
    day.times.push({ iso, time: p.time, minutes: p.minutes });
  }
  return [...days.values()];
}

/** "9:00", from minutes after midnight. */
export function clock(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

export type BookingLike = {
  status: BookingStatus;
  payment_status: "unpaid" | "pending" | "paid";
  starts_at: string;
  ends_at: string;
  price_cents: number;
  free_cancel_until: string | null;
};

/** What cancelling now would do — the same rule as pro_booking_cancel(). */
export function cancelOutcome(b: BookingLike, asPro: boolean, now: Date = new Date()): { allowed: boolean; refundCents: number; line: string } {
  if (b.status !== "booked") return { allowed: false, refundCents: 0, line: "" };
  if (Date.parse(b.starts_at) <= now.getTime()) return { allowed: false, refundCents: 0, line: "It has started, so it can't be cancelled now." };
  const paid = b.payment_status === "paid";
  if (asPro) {
    return { allowed: true, refundCents: paid ? b.price_cents : 0, line: `The golfer gets all ${euroCents(b.price_cents)} back.` };
  }
  const free = b.free_cancel_until != null && now.getTime() <= Date.parse(b.free_cancel_until);
  if (free && paid) return { allowed: true, refundCents: b.price_cents, line: `You get the full ${euroCents(b.price_cents)} back.` };
  return { allowed: true, refundCents: 0, line: "It's too late for a refund under the pro's terms. They're still paid." };
}

export type LessonPhase = "paying" | "expired" | "upcoming" | "done" | "cancelled";

export function lessonPhase(b: BookingLike & { hold_until?: string }, now: Date = new Date()): LessonPhase {
  if (b.status === "cancelled") return "cancelled";
  if (b.status === "expired") return "expired";
  if (b.status === "pending_payment") {
    const live = b.payment_status === "pending" || (b.hold_until != null && Date.parse(b.hold_until) > now.getTime());
    return live ? "paying" : "expired";
  }
  return Date.parse(b.ends_at) <= now.getTime() ? "done" : "upcoming";
}

/** The week's hours, Monday first, as "Mon 9:00–17:00". */
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export type HoursRow = { weekday: number; start_min: number; end_min: number };

export function hoursLine(rows: HoursRow[]): string {
  if (rows.length === 0) return "No hours set yet";
  return WEEKDAYS.map((d, i) => {
    const day = rows.filter((r) => r.weekday === i).sort((a, b) => a.start_min - b.start_min);
    return day.length ? `${d} ${day.map((r) => `${clock(r.start_min)}–${clock(r.end_min)}`).join(", ")}` : null;
  })
    .filter(Boolean)
    .join(" · ");
}
