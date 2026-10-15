// Copied from mobile/src/lib/itinerary-rules.ts (pure) so the website's society console
// lays trips out by the same rules. Keep the two in step.
/**
 * Trip itineraries — what the screens show and say (0126). The database
 * applies the rules too; this file only decides how to lay them out.
 *
 * Pure, no imports: tested in itinerary-rules.test.ts.
 */

export type OutingKind = "day" | "overnight" | "abroad";
export type ItemKind = "round" | "flight" | "stay" | "transfer" | "meal" | "note";
export type PlayFormat = "stableford" | "strokeplay" | "matchplay" | "scramble" | "fourball" | "foursomes";

export const OUTING_KINDS: { kind: OutingKind; label: string; blurb: string }[] = [
  { kind: "day", label: "Day out", blurb: "One course, one day. Entries, the draw and who has paid." },
  { kind: "overnight", label: "Overnight in Ireland", blurb: "Two or more days: rounds, where you're staying, travel and notes." },
  { kind: "abroad", label: "Abroad", blurb: "Everything overnight has, plus flights and transfers." },
];

export const isTrip = (kind: OutingKind): boolean => kind !== "day";

/** The badge on a trip: "ABROAD · 4 DAYS". */
export function tripBadge(kind: OutingKind, playsOn: string, endsOn: string | null): string {
  if (kind === "day" || !endsOn) return "DAY OUT";
  return `${kind === "abroad" ? "ABROAD" : "OVERNIGHT"} · ${tripDays(playsOn, endsOn).length} DAYS`;
}

/** What an organiser can add on a day. Flights only abroad. */
export function itemKindsFor(kind: OutingKind): ItemKind[] {
  return kind === "abroad" ? ["round", "flight", "stay", "transfer", "meal", "note"] : ["round", "stay", "transfer", "meal", "note"];
}

export const ITEM_INFO: Record<ItemKind, { label: string; kicker: string; icon: string; tint: string; ink: string }> = {
  round: { label: "Round", kicker: "ROUND", icon: "flag-outline", tint: "#e2ede1", ink: "#1f5c2e" },
  flight: { label: "Flight", kicker: "FLIGHT", icon: "airplane-outline", tint: "#e3ecf8", ink: "#1e4d8c" },
  stay: { label: "Hotel", kicker: "STAY", icon: "bed-outline", tint: "#f6eedc", ink: "#7a5a12" },
  transfer: { label: "Transfer", kicker: "TRANSFER", icon: "bus-outline", tint: "#eee7f6", ink: "#5b3d8a" },
  meal: { label: "Dinner", kicker: "MEAL", icon: "restaurant-outline", tint: "#f6e3de", ink: "#8a3a2b" },
  note: { label: "Note", kicker: "NOTE", icon: "document-text-outline", tint: "#efe7d6", ink: "#4a5566" },
};

export const FORMAT_LABELS: Record<PlayFormat, string> = {
  stableford: "Stableford",
  strokeplay: "Stroke play",
  matchplay: "Matchplay",
  scramble: "Scramble",
  fourball: "Fourball",
  foursomes: "Foursomes",
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const parts = (date: string) => date.split("-").map(Number) as [number, number, number];
const utc = (date: string) => {
  const [y, m, d] = parts(date);
  return Date.UTC(y, m - 1, d);
};

/** "2027-05-13" + 3 → "2027-05-16". */
export function addDays(date: string, days: number): string {
  return new Date(utc(date) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Every date of a trip, first to last. */
export function tripDays(playsOn: string, endsOn: string): string[] {
  const n = Math.round((utc(endsOn) - utc(playsOn)) / 86_400_000);
  if (!(n >= 0) || n > 60) return [playsOn];
  return Array.from({ length: n + 1 }, (_, i) => addDays(playsOn, i));
}

/** "4 days · 3 nights". */
export function tripLengthLabel(playsOn: string, endsOn: string): string {
  const days = tripDays(playsOn, endsOn).length;
  return `${days} days · ${days - 1} ${days - 1 === 1 ? "night" : "nights"}`;
}

/** "Thu 13 – Sun 16 May", or "Fri 30 Apr – Mon 3 May" across months. */
export function tripRangeLabel(playsOn: string, endsOn: string): string {
  const [, m1, d1] = parts(playsOn);
  const [, m2, d2] = parts(endsOn);
  const wd = (date: string) => WEEKDAYS[new Date(utc(date)).getUTCDay()];
  return m1 === m2 ? `${wd(playsOn)} ${d1} – ${wd(endsOn)} ${d2} ${MONTHS[m2 - 1]}` : `${wd(playsOn)} ${d1} ${MONTHS[m1 - 1]} – ${wd(endsOn)} ${d2} ${MONTHS[m2 - 1]}`;
}

/** The day tab: { week: "THU", day: "13" }. */
export function dayTab(date: string): { week: string; day: string } {
  return { week: WEEKDAYS[new Date(utc(date)).getUTCDay()].toUpperCase(), day: String(parts(date)[2]) };
}

/** "Day 1 · Thursday 13 May". */
export function dayHeading(playsOn: string, date: string): string {
  const long = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const n = Math.round((utc(date) - utc(playsOn)) / 86_400_000) + 1;
  return `Day ${n} · ${long[new Date(utc(date)).getUTCDay()]} ${parts(date)[2]} ${MONTHS[parts(date)[1] - 1]}`;
}

/** Days from today to the first day; 0 on the day, negative once begun. */
export function daysToGo(playsOn: string, today: string): number {
  return Math.round((utc(playsOn) - utc(today)) / 86_400_000);
}

/** "213 days to go" / "Tomorrow" / "Today" / "Under way" / "Done". */
export function countdownLabel(playsOn: string, endsOn: string, today: string): string {
  const n = daysToGo(playsOn, today);
  if (n > 1) return `${n} days to go`;
  if (n === 1) return "Tomorrow";
  if (n === 0) return "Today";
  return today <= endsOn ? "Under way" : "Done";
}

/** "09:00" (or "09:00:00") + minutes → "09:10". Null without a start. */
export function addMinutes(time: string | null, minutes: number): string | null {
  const m = time ? /^(\d{1,2}):(\d{2})/.exec(time) : null;
  if (!m) return null;
  const total = (((Number(m[1]) * 60 + Number(m[2]) + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** A round's tee time for a group: first tee + (group − 1) × gap. */
export const teeTimeFor = (firstTee: string | null, gap: number | null, group: number): string | null => addMinutes(firstTee, (gap ?? 10) * (group - 1));

/** The day a stay ends: on_date + nights. */
export const checkOutDate = (onDate: string, nights: number | null): string => addDays(onDate, nights ?? 1);

/** "Dublin DUB → Faro FAO". */
export const routeLabel = (from: string | null, to: string | null): string => [from, to].filter(Boolean).join(" → ");

type Sortable = { id: number; onDate: string; startsAt: string | null };

/** Day order: by date, then time (untimed things last on their day), then when added. */
export function sortItems<T extends Sortable>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.onDate !== b.onDate) return a.onDate < b.onDate ? -1 : 1;
    if (a.startsAt !== b.startsAt) {
      if (a.startsAt == null) return 1;
      if (b.startsAt == null) return -1;
      return a.startsAt < b.startsAt ? -1 : 1;
    }
    return a.id - b.id;
  });
}

type Placed = { memberId: string; slot: number | null; position: number | null };

/** People on a round or stay, by group/room in order: [[slot, people], …]. */
export function bySlot<T extends Placed>(people: readonly T[]): [number, T[]][] {
  const map = new Map<number, T[]>();
  for (const p of people) if (p.slot != null) map.set(p.slot, [...(map.get(p.slot) ?? []), p]);
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([slot, list]) => [slot, list.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))]);
}

/**
 * Deals people into slots of at most `size`, as even as possible, bigger
 * first (12 in fours: 4·4·4; 10 in fours: 4·3·3). Returns member → slot.
 * `order` is the order to deal in — pass a shuffled list for a random draw.
 */
export function dealIntoSlots(order: readonly string[], size: number): Map<string, number> {
  const out = new Map<string, number>();
  if (order.length === 0 || size < 1) return out;
  const groups = Math.ceil(order.length / size);
  const base = Math.floor(order.length / groups);
  const extra = order.length % groups;
  let i = 0;
  for (let g = 0; g < groups; g++) {
    const n = base + (g < extra ? 1 : 0);
    for (let k = 0; k < n; k++) out.set(order[i++], g + 1);
  }
  return out;
}

/** What a member's own itinerary line says for an item they're on. */
export function myLineFor(
  item: { kind: ItemKind; startsAt: string | null; teeInterval: number | null },
  mine: { slot: number | null } | null,
  partners: string[]
): string | null {
  if (!mine) return null;
  const with_ = partners.length ? ` with ${partners.join(", ")}` : "";
  if (item.kind === "round" && mine.slot != null) {
    const t = teeTimeFor(item.startsAt, item.teeInterval, mine.slot);
    return `You: ${t ? `${t} · ` : ""}group ${mine.slot}${with_}`;
  }
  if (item.kind === "stay" && mine.slot != null) return `You: room ${mine.slot}${partners.length ? `, sharing with ${partners.join(", ")}` : ""}`;
  if (item.kind === "flight" || item.kind === "transfer") return "You're on this";
  return null;
}
