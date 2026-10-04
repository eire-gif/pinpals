import { LIMITS, roundScoreLabel, scoreName, type RoundDetails } from "./post-details";

/**
 * The Round Recap (Oct 2026 feed redesign, phase 7) — pure, so it's tested
 * without a screen (round-recap.test.ts).
 *
 * A completed round in PinPals is a confirmed tee time whose date has gone
 * (rounds.ts, "Played"): it knows the course, the day, the time and who you
 * played with — not how it went. The recap starts from that and the member
 * adds their numbers. Everything here works from whatever is filled in and
 * says nothing about what isn't: no "0 birdies" because a field was blank.
 *
 * Nothing in this file posts anything. The composer (new-post.tsx with
 * ?recap=<tee time id>) shows the recap, the member edits it, and only Post
 * publishes it.
 *
 * Not available, so not shown: a course map (nothing in PinPals has hole
 * geometry) — the card uses a course photograph or the member's own.
 */

/** What the recap is generated from: a played tee time. */
export type RecapSource = {
  inviteId: number;
  course: string;
  /** YYYY-MM-DD */
  playDate: string;
  /** "08:30", "Time flexible"… */
  when: string;
  /** Playing partners' full names (not you). */
  players: string[];
};

export type RecapStat = { label: string; value: string | null; accent?: string | null };

/** The grid on the recap card, in mockup order. `value: null` means "not
 *  filled in yet" — the card shows a dash, the share card leaves it out. */
export function recapStats(d: Partial<RoundDetails>): RecapStat[] {
  const rel =
    d.score !== undefined && d.course_par !== undefined
      ? roundScoreLabel(d.score, d.course_par).replace(/^\d+ \((.*)\)$/, "$1")
      : null;
  return [
    { label: "Final score", value: d.score !== undefined ? String(d.score) : null, accent: rel },
    { label: d.holes === 9 ? "Nine" : "Front 9", value: d.front_nine !== undefined ? String(d.front_nine) : null },
    { label: "Back 9", value: d.holes === 9 ? null : d.back_nine !== undefined ? String(d.back_nine) : null },
    { label: "Birdies", value: d.birdies !== undefined ? String(d.birdies) : null },
    { label: "GIR", value: d.gir !== undefined ? String(d.gir) : null },
    { label: "Putts", value: d.putts !== undefined ? String(d.putts) : null },
    {
      label: "Fairways",
      value: d.fairways_hit !== undefined ? `${d.fairways_hit}${d.fairways_total ? `/${d.fairways_total}` : ""}` : null,
    },
    { label: "Longest drive", value: d.longest_drive !== undefined ? `${d.longest_drive} yds` : null },
  ];
}

/** "Hole 6 · Par 4 · Birdie", or null without a best hole. */
export function bestHoleLine(d: Partial<RoundDetails>): string | null {
  const b = d.best_hole;
  if (!b) return null;
  const name = scoreName(b.score, b.par);
  return [`Hole ${b.hole}`, b.par !== undefined ? `Par ${b.par}` : null, name ?? `Scored ${b.score}`]
    .filter(Boolean)
    .join(" · ");
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dayDiff(iso: string, today: string): number {
  const a = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  const b = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/** "today", "yesterday", "on Sat 3 Oct". */
export function playedWhen(iso: string, today: string): string {
  const diff = dayDiff(iso, today);
  if (diff === 0) return "today";
  if (diff === 1) return "yesterday";
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
  return `on ${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "Niamh", "Niamh and Conor", "Niamh, Conor and Aoife" — first names. */
export function withWhom(players: string[]): string | null {
  const first = players.map((p) => p.split(/\s+/)[0]).filter(Boolean);
  if (first.length === 0) return null;
  if (first.length === 1) return first[0];
  return `${first.slice(0, -1).join(", ")} and ${first[first.length - 1]}`;
}

/** The card's one-line subtitle: "Today · White tees · with Niamh and Conor". */
export function recapSubtitle(source: RecapSource, d: Partial<RoundDetails>, today: string): string {
  const when = playedWhen(source.playDate, today);
  const who = withWhom(source.players);
  return [when[0].toUpperCase() + when.slice(1), d.tee ? `${d.tee} tees` : null, who ? `with ${who}` : null]
    .filter(Boolean)
    .join(" · ");
}

/**
 * A suggested caption, from whatever is filled in. The member edits it
 * freely; the composer stops regenerating the moment they do.
 *
 *   "78 (+6) at Portmarnock today with Niamh and Conor. 3 birdies, 8 greens
 *    in regulation and 29 putts. Best hole: a birdie on the 6th."
 */
export function recapCaption(source: RecapSource, d: Partial<RoundDetails>, today: string): string {
  const who = withWhom(source.players);
  const when = playedWhen(source.playDate, today);
  const opener =
    d.score !== undefined
      ? `${roundScoreLabel(d.score, d.course_par)} at ${source.course} ${when}${who ? ` with ${who}` : ""}.`
      : `A round at ${source.course} ${when}${who ? ` with ${who}` : ""}.`;

  const bits: string[] = [];
  if (d.birdies !== undefined && d.birdies > 0) bits.push(`${d.birdies} ${d.birdies === 1 ? "birdie" : "birdies"}`);
  if (d.gir !== undefined) bits.push(`${d.gir} ${d.gir === 1 ? "green" : "greens"} in regulation`);
  if (d.putts !== undefined) bits.push(`${d.putts} putts`);
  const stats = bits.length ? ` ${bits.length > 1 ? `${bits.slice(0, -1).join(", ")} and ${bits[bits.length - 1]}` : bits[0]}.`.replace(/^ ./, (m) => m.toUpperCase()) : "";

  let best = "";
  if (d.best_hole) {
    const name = scoreName(d.best_hole.score, d.best_hole.par);
    best = name
      ? ` Best hole: ${name === "Ace" ? "an ace" : `a ${name.toLowerCase()}`} on the ${ordinal(d.best_hole.hole)}.`
      : ` Best hole: the ${ordinal(d.best_hole.hole)}.`;
  }
  const drive = d.longest_drive !== undefined ? ` Longest drive ${d.longest_drive} yards.` : "";
  return `${opener}${stats}${best}${drive}`;
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
}

/**
 * Which played rounds to offer a recap for: played within the last
 * `windowDays` (a fortnight — after that it's history, not news), not
 * already shared, not waved away. Most recent first.
 */
export function roundsToRecap<T extends { inviteId: number; playDate: string }>(
  past: T[],
  shared: Set<number>,
  dismissed: Set<number>,
  today: string,
  windowDays = 14
): T[] {
  return past
    .filter((r) => {
      const diff = dayDiff(r.playDate, today);
      return diff >= 0 && diff <= windowDays && !shared.has(r.inviteId) && !dismissed.has(r.inviteId);
    })
    .sort((a, b) => b.playDate.localeCompare(a.playDate));
}

/** The recap's score limits, re-exported for the card's inputs. */
export const RECAP_LIMITS = { nine: LIMITS.nine, drive: LIMITS.drive };
