/**
 * Group chats (0181): the pure parts — words for a group's bar and inbox row,
 * a trip's countdown, and how the group's own events sit among the messages.
 * Plain TypeScript, no React Native, so the lib tests can run it.
 */

export type ChatGroupKind = "crew" | "trip" | "society" | "area" | "club";

/** How loudly a chat alerts you (conversation_members.alerts). */
export type ChatAlertLevel = "all" | "key" | "none";

export const CHAT_ALERT_OPTIONS: { level: ChatAlertLevel; label: string; hint: string }[] = [
  { level: "all", label: "Everything", hint: "An alert for every message." },
  {
    level: "key",
    label: "Rounds & @me",
    hint: "Alerts when someone @mentions you or replies to you. New rounds, events and payments still alert you.",
  },
  { level: "none", label: "Muted", hint: "No chat alerts. Messages still arrive in your inbox." },
];

export const asAlertLevel = (v: unknown): ChatAlertLevel => (v === "key" || v === "none" ? v : "all");

const DAY = 86_400_000;
const dayNumber = (iso: string): number => Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY);

/** Whole days from `today` to `date` (both YYYY-MM-DD). */
export function daysBetween(today: string, date: string): number {
  return dayNumber(date) - dayNumber(today);
}

/**
 * "199 days to go", "Tomorrow", "On now" — or null once a trip is over, or
 * when it has no dates. A one-day trip with no end date is "On now" on the day.
 */
export function tripCountdown(startsOn: string | null, endsOn: string | null, today: string): string | null {
  if (!startsOn) return null;
  const toStart = daysBetween(today, startsOn);
  if (toStart > 1) return `${toStart} days to go`;
  if (toStart === 1) return "Tomorrow";
  const toEnd = daysBetween(today, endsOn ?? startsOn);
  return toEnd >= 0 ? "On now" : null;
}

/** The days left, for the badge in a trip's bar: null outside "days to go". */
export function tripDaysLeft(startsOn: string | null, today: string): number | null {
  if (!startsOn) return null;
  const d = daysBetween(today, startsOn);
  return d >= 1 ? d : null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The gold line under a group's name: "Golf Buddies · 8 members", "Golf trip · 199 days to go". */
export function groupLine(
  g: { kind: ChatGroupKind; memberCount: number; startsOn?: string | null; endsOn?: string | null },
  today: string,
): string {
  if (g.kind === "trip") {
    const countdown = tripCountdown(g.startsOn ?? null, g.endsOn ?? null, today);
    return `Golf trip · ${countdown ?? plural(g.memberCount, "golfer", "golfers")}`;
  }
  if (g.kind === "crew") return `Golf Buddies · ${plural(g.memberCount, "member", "members")}`;
  if (g.kind === "society") return `Society · ${plural(g.memberCount, "member", "members")}`;
  return plural(g.memberCount, "member", "members");
}

/** The small tag on an inbox row. */
export const groupTag = (kind: ChatGroupKind): string | null =>
  kind === "trip" ? "TRIP" : kind === "crew" ? "BUDDIES" : kind === "society" ? "SOCIETY" : null;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Sat 24 Oct" — a calendar date, never shifted by the phone's time zone. */
export function shortDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "Sat 24 Oct · 08:40", or just the date when there's no first tee yet. */
export function eventWhen(playsOn: string, firstTee: string | null): string {
  const tee = firstTee ? firstTee.slice(0, 5) : null;
  return tee ? `${shortDate(playsOn)} · ${tee}` : shortDate(playsOn);
}

/** Something in the chat's timeline: a message, or one of the group's events. */
export type Timed = { created_at: string };

/**
 * Puts the group's own cards (events posted to it) among the messages, newest
 * first like the message list itself. While older messages are still to load,
 * a card older than the oldest loaded message waits until they arrive, so it
 * never jumps to the top of a half-loaded chat.
 */
export function mergeTimeline<M extends Timed, C extends Timed>(
  messages: M[],
  cards: C[],
  moreToLoad: boolean,
): ({ kind: "message"; item: M } | { kind: "card"; item: C })[] {
  const oldest = messages.length > 0 ? messages[messages.length - 1].created_at : null;
  const shown = moreToLoad && oldest ? cards.filter((c) => Date.parse(c.created_at) >= Date.parse(oldest)) : cards;
  const out: ({ kind: "message"; item: M } | { kind: "card"; item: C })[] = [
    ...messages.map((m) => ({ kind: "message" as const, item: m })),
    ...shown.map((c) => ({ kind: "card" as const, item: c })),
  ];
  return out.sort((a, b) => Date.parse(b.item.created_at) - Date.parse(a.item.created_at));
}

/** Light names on the navy chat card: one per member, steady between visits. */
export const CARD_NAME_COLOURS = ["#f0c97a", "#8fb2ea", "#9fd6b4", "#f2a98e", "#c9b4f0", "#e9d38a"] as const;

export function cardNameColour(memberId: string): string {
  let h = 0;
  for (let i = 0; i < memberId.length; i++) h = (h * 31 + memberId.charCodeAt(i)) >>> 0;
  return CARD_NAME_COLOURS[h % CARD_NAME_COLOURS.length];
}
