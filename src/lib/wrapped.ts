/**
 * PinPals Wrapped — a member's year in golf (Oct 2026, claude/wrapped.md).
 *
 * Pure, no imports, and byte-identical in mobile/src/lib/wrapped.ts:
 * wrapped.test.ts fails if the two copies drift. The app draws the story
 * cards from it; the website draws the shareable picture from it; both must
 * say the same numbers.
 *
 * Everything comes from the member's own scorecards for the year (every
 * live round saves one for each member) plus who they played live rounds
 * with. Nothing is stored: it's worked out whenever it's opened.
 */

export type WrappedHole = { hole: number; par: number; strokeIndex: number | null; strokes: number | null };

export type WrappedCard = {
  clubId: number | null;
  courseName: string;
  country: string | null;
  playedOn: string;
  holes: number;
  handicapIndex: number | null;
  playingHandicap: number | null;
  /** True for a card saved from a society day / match day. */
  groupDay: boolean;
  holeList: WrappedHole[];
};

export type WrappedPartner = { key: string; name: string; rounds: number };

export type Persona = { id: string; title: string; line: string };

export type Wrapped = {
  year: number;
  rounds: number;
  /** Rough kilometres walked: 18 holes ≈ 7 km, 9 ≈ 3.5. */
  km: number;
  best: { points: number; courseName: string; playedOn: string } | null;
  bestGross: { strokes: number; courseName: string; playedOn: string } | null;
  birdies: number;
  eagles: number;
  pars: number;
  courses: number;
  newCourses: number;
  newestCourse: string | null;
  topCourse: { name: string; rounds: number } | null;
  countries: number;
  handicap: { from: number; to: number } | null;
  byMonth: number[];
  busiestMonth: number | null;
  partner: WrappedPartner | null;
  persona: Persona;
};

const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthName = (m: number): string => MONTHS_LONG[m] ?? "";

/** Shots per hole by rank of stroke index (as live-scoring.ts shotsByHole); null if any index is missing. */
export function wrappedShots(playingHcp: number, holes: readonly WrappedHole[]): Map<number, number> | null {
  if (holes.length === 0 || holes.some((h) => h.strokeIndex == null)) return null;
  const n = holes.length;
  const ranked = [...holes].sort((a, b) => (a.strokeIndex as number) - (b.strokeIndex as number) || a.hole - b.hole);
  const whole = Math.trunc(playingHcp / n) || 0;
  const rest = Math.abs(playingHcp % n);
  const out = new Map<number, number>();
  ranked.forEach((h, i) => {
    let s = whole;
    if (playingHcp >= 0) {
      if (i < rest) s += 1;
    } else if (i >= n - rest) {
      s -= 1;
    }
    out.set(h.hole, s);
  });
  return out;
}

/** Stableford points for a full card, or null when it can't be worked out. */
export function cardPoints(card: WrappedCard): number | null {
  if (card.playingHandicap == null) return null;
  if (card.holeList.every((h) => h.strokes == null)) return null;
  const shots = wrappedShots(card.playingHandicap, card.holeList);
  if (!shots) return null;
  let pts = 0;
  for (const h of card.holeList) {
    if (h.strokes == null) continue;
    pts += Math.max(0, h.par + 2 + (shots.get(h.hole) ?? 0) - h.strokes);
  }
  return pts;
}

function personaFor(w: Omit<Wrapped, "persona">, cards: readonly WrappedCard[]): Persona {
  const groupShare = cards.length ? cards.filter((c) => c.groupDay).length / cards.length : 0;
  if (w.rounds === 0) return { id: "rookie", title: "Rookie", line: "Your first round on PinPals is the start of next year's story." };
  if (w.countries >= 2) return { id: "traveller", title: "Golf Traveller", line: `You played in ${w.countries} countries this year.` };
  if (groupShare >= 0.4 && cards.length >= 4) return { id: "society", title: "Society Regular", line: "You never miss a day out with the group." };
  if (w.newCourses >= 5) return { id: "explorer", title: "Course Explorer", line: `${w.newCourses} courses you'd never played before.` };
  if (w.topCourse && w.topCourse.rounds / w.rounds >= 0.6 && w.rounds >= 6) return { id: "home", title: "Home Bird", line: `${w.topCourse.name} is where your heart is.` };
  if (w.rounds >= 40) return { id: "grinder", title: "The Grinder", line: `${w.rounds} rounds. Rain, hail or shine.` };
  return { id: "weekend", title: "Weekend Warrior", line: "Golf when you can, and every round counted." };
}

/** The year, from the member's cards and their partners. `priorClubs` = clubs they'd played before this year. */
export function buildWrapped(
  year: number,
  allCards: readonly WrappedCard[],
  partners: readonly WrappedPartner[],
  priorClubs: ReadonlySet<number>,
): Wrapped {
  const cards = allCards.filter((c) => c.playedOn.startsWith(`${year}-`)).sort((a, b) => a.playedOn.localeCompare(b.playedOn));
  const byMonth = Array.from({ length: 12 }, () => 0);
  let birdies = 0;
  let eagles = 0;
  let pars = 0;
  let km = 0;
  let best: Wrapped["best"] = null;
  let bestGross: Wrapped["bestGross"] = null;
  const courseCount = new Map<string, { name: string; rounds: number }>();
  const clubs = new Set<number>();
  const newClubs: { id: number; name: string; on: string }[] = [];
  const countries = new Set<string>();

  for (const c of cards) {
    const m = Number(c.playedOn.slice(5, 7)) - 1;
    byMonth[m] = (byMonth[m] ?? 0) + 1;
    km += c.holes === 9 ? 3.5 : 7;
    for (const h of c.holeList) {
      if (h.strokes == null) continue;
      const d = h.strokes - h.par;
      if (d <= -2) eagles += 1;
      else if (d === -1) birdies += 1;
      else if (d === 0) pars += 1;
    }
    if (c.holes === 18) {
      const pts = cardPoints(c);
      if (pts != null && (!best || pts > best.points)) best = { points: pts, courseName: c.courseName, playedOn: c.playedOn };
      if (c.holeList.length === 18 && c.holeList.every((h) => h.strokes != null)) {
        const g = c.holeList.reduce((t, h) => t + (h.strokes as number), 0);
        if (!bestGross || g < bestGross.strokes) bestGross = { strokes: g, courseName: c.courseName, playedOn: c.playedOn };
      }
    }
    const key = c.clubId != null ? `c${c.clubId}` : `n${c.courseName.toLowerCase()}`;
    const cc = courseCount.get(key);
    if (cc) cc.rounds += 1;
    else courseCount.set(key, { name: c.courseName, rounds: 1 });
    if (c.clubId != null && !clubs.has(c.clubId)) {
      clubs.add(c.clubId);
      if (!priorClubs.has(c.clubId)) newClubs.push({ id: c.clubId, name: c.courseName, on: c.playedOn });
    }
    if (c.country) countries.add(c.country === "northern-ireland" ? "ireland" : c.country);
  }

  const top = [...courseCount.values()].sort((a, b) => b.rounds - a.rounds || a.name.localeCompare(b.name))[0] ?? null;
  const withIndex = cards.filter((c) => c.handicapIndex != null);
  const handicap =
    withIndex.length >= 2 && withIndex[0]!.handicapIndex !== withIndex[withIndex.length - 1]!.handicapIndex
      ? { from: withIndex[0]!.handicapIndex as number, to: withIndex[withIndex.length - 1]!.handicapIndex as number }
      : null;
  const busiest = byMonth.some((n) => n > 0) ? byMonth.indexOf(Math.max(...byMonth)) : null;
  const partner = [...partners].sort((a, b) => b.rounds - a.rounds || a.name.localeCompare(b.name))[0] ?? null;

  const base = {
    year,
    rounds: cards.length,
    km: Math.round(km),
    best,
    bestGross,
    birdies,
    eagles,
    pars,
    courses: courseCount.size,
    newCourses: newClubs.length,
    newestCourse: newClubs.length ? newClubs[newClubs.length - 1]!.name : null,
    topCourse: top,
    countries: countries.size,
    handicap,
    byMonth,
    busiestMonth: busiest,
    partner: partner && partner.rounds > 0 ? partner : null,
  };
  return { ...base, persona: personaFor(base, cards) };
}

/** The handicap change in words: "−2.4" (better) or "+1.1". */
export function handicapChange(h: { from: number; to: number }): string {
  const d = Math.round((h.to - h.from) * 10) / 10;
  if (d === 0) return "0.0";
  return d < 0 ? `−${Math.abs(d).toFixed(1)}` : `+${d.toFixed(1)}`;
}

/** Wrapped opens for the year just gone in January, otherwise this year. */
export function wrappedYear(now: Date): number {
  return now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
}
