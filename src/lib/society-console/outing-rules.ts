// Copied from mobile/src/lib/outing-rules.ts (pure) so the website's society console
// applies the same rules. Keep the two in step.
/**
 * Society outings — the rules the screens show (0125). The database applies
 * them too; this file only decides what to draw and what to say.
 *
 * Pure, no imports: tested in outing-rules.test.ts.
 */

/** Entries close at midnight at the start of the day, Irish time. */
export const OUTING_TIME_ZONE = "Europe/Dublin";

/** How far Europe/Dublin is ahead of UTC at this instant, in minutes. */
function dublinOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: OUTING_TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** "2026-10-20" → the instant entries close: 00:00 on that day in Ireland. */
export function entriesCloseAt(playsOn: string): Date {
  const [y, m, d] = playsOn.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  // Two passes: the offset at the guess, then at the corrected time (they
  // only differ on the night the clocks change).
  const first = guess - dublinOffsetMinutes(new Date(guess)) * 60000;
  return new Date(guess - dublinOffsetMinutes(new Date(first)) * 60000);
}

/** Today's date in Ireland, "YYYY-MM-DD". */
export function irishToday(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + dublinOffsetMinutes(now) * 60000);
  return shifted.toISOString().slice(0, 10);
}

/** May a member still join or cancel themselves? */
export const entriesOpen = (playsOn: string, now: Date = new Date()): boolean => now.getTime() < entriesCloseAt(playsOn).getTime();

/** Is it the day itself (the round can be started)? */
export const isOutingDay = (playsOn: string, now: Date = new Date()): boolean => irishToday(now) === playsOn;

/** Has the day gone by? */
export const outingPast = (playsOn: string, now: Date = new Date()): boolean => playsOn < irishToday(now);

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-20" → "Tue 20 Oct". */
export function outingDateLabel(playsOn: string): string {
  const [y, m, d] = playsOn.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[wd]} ${d} ${MONTHS[m - 1]}`;
}

/** When entries close, in words: "Entries close at midnight on Mon 19 Oct". */
export function closesLabel(playsOn: string, now: Date = new Date()): string {
  if (!entriesOpen(playsOn, now)) return "Entries closed";
  const [y, m, d] = playsOn.split("-").map(Number);
  const eve = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
  return `Join or cancel until midnight on ${outingDateLabel(eve)}`;
}

/** 6000 → "€60", 6050 → "€60.50", null → null. */
export function feeLabel(cents: number | null): string | null {
  if (cents == null) return null;
  if (cents === 0) return "Free";
  return cents % 100 === 0 ? `€${cents / 100}` : `€${(cents / 100).toFixed(2)}`;
}

/** "60" or "60.50" → 6000 / 6050; "" → null; anything else → undefined. */
export function parseFee(text: string): number | null | undefined {
  const t = text.trim().replace(/^€/, "").replace(",", ".");
  if (t === "") return null;
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(t)) return undefined;
  const cents = Math.round(Number(t) * 100);
  return cents <= 100000 ? cents : undefined;
}

/** "refunded" (0142): a withdrawn member's payment was handed back. */
export type PaidStatus = "cash" | "transfer" | "card" | "waived" | "refunded";

export const PAID_LABELS: Record<PaidStatus, string> = {
  cash: "Paid cash",
  transfer: "Paid by transfer",
  card: "Paid by card",
  waived: "Fee waived",
  refunded: "Refunded",
};

/** "09:00:00" → "09:00". */
export const clock = (t: string | null): string | null => (t ? t.slice(0, 5) : null);
