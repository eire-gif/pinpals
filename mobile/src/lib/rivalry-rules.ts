/**
 * Rivalries (Oct 2026, claude/rivalries.md): the pure half.
 *
 * Every finished live round where you played AGAINST another player settles
 * a head-to-head between you, with nothing to enter:
 *
 *   - a match (singles, fourball, foursomes, greensomes — Match Day Fun, a
 *     Ryder Cup session) where you were on opposite sides: the match's own
 *     result, so a fourball counts for both players on each side;
 *   - a round where you each played your own ball in the same group
 *     (Stableford or stroke play, a society day's tee group): a singles
 *     match between the two of you, net off your course handicaps (the
 *     higher gets the difference), stopping once it's decided, as matchplay.
 *
 * Partners never count: the same side of a match, a foursomes or greensomes
 * pair, a scramble team. Nor does a round that isn't finished, or one where
 * the two of you didn't both finish enough holes for a result.
 *
 * Pure: tested in rivalry-rules.test.ts.
 */
import { teamMatchState, type CardHole, type MatchFormat, type MatchPlayer, type ScoreSheet } from "./live-scoring";

export type RivalRoundPlayer = {
  id: number;
  memberId: string | null;
  name: string;
  side: number | null;
  courseHandicap: number;
  playingHandicap: number;
  position: number;
};

export type RivalRound = {
  id: number;
  playedOn: string;
  courseName: string;
  finished: boolean;
  /** The round's format: "stableford", "stroke", "matchplay"… */
  format: string;
  /** Set for a match. */
  matchFormat: MatchFormat | null;
  /** A scramble team, or a foursomes / greensomes pair's card: partners only. */
  teamCard: boolean;
  card: CardHole[];
  players: RivalRoundPlayer[];
  scores: ScoreSheet;
};

export type Outcome = "won" | "lost" | "halved";

export type Meeting = {
  roundId: number;
  playedOn: string;
  courseName: string;
  /** "Stableford", "Fourball, opposite sides"… */
  how: string;
  outcome: Outcome;
  /** "3&2", "2 up", "Halved" — from your side. */
  margin: string;
  /** For ranking wins: holes up, then holes left. */
  size: number;
};

/** Who they are: a member's id, or "guest:<name>" for someone added by name. */
export type RivalKey = string;

export type Rivalry = {
  key: RivalKey;
  memberId: string | null;
  name: string;
  /** Their player id in their latest round with you (to send a guest their card). */
  lastPlayerId: number;
  lastRoundCourse: string;
  won: number;
  lost: number;
  halved: number;
  /** Newest first. */
  meetings: Meeting[];
};

const FORMAT_NAME: Record<string, string> = { stableford: "Stableford", stroke: "Stroke play", par: "Par", matchplay: "Singles" };
const MATCH_NAME: Record<MatchFormat, string> = { matchplay: "Singles", fourball: "Fourball", foursomes: "Foursomes", greensomes: "Greensomes" };

/** A guest's key: their name without "(guest)", lower case. */
export function guestKey(name: string): RivalKey {
  return `guest:${name.replace(/\s*\(guest\)\s*$/i, "").trim().toLowerCase()}`;
}

const keyOf = (p: RivalRoundPlayer): RivalKey => (p.memberId ? p.memberId : guestKey(p.name));

/** One round's head-to-heads for me: one meeting per opponent, or none. */
export function meetingsIn(round: RivalRound, me: string): { opponent: RivalRoundPlayer; meeting: Meeting }[] {
  if (!round.finished || round.teamCard) return [];
  const mine = round.players.find((p) => p.memberId === me);
  if (!mine) return [];
  const out: { opponent: RivalRoundPlayer; meeting: Meeting }[] = [];
  const base = { roundId: round.id, playedOn: round.playedOn, courseName: round.courseName };

  if (round.matchFormat) {
    if (mine.side !== 1 && mine.side !== 2) return [];
    const players: MatchPlayer[] = round.players.map((p) => ({
      id: p.id,
      name: p.name,
      playingHandicap: p.playingHandicap,
      courseHandicap: p.courseHandicap,
      side: p.side ?? 1,
      position: p.position,
    }));
    const st = teamMatchState(round.matchFormat, round.card, players, round.scores);
    if (!st || (!st.finished && st.holes.length < round.card.length)) return [];
    const outcome: Outcome = st.leader === 0 ? "halved" : st.leader === mine.side ? "won" : "lost";
    const pairs = round.matchFormat !== "matchplay";
    for (const p of round.players) {
      if (p.id === mine.id || p.side == null || p.side === mine.side) continue;
      out.push({
        opponent: p,
        meeting: {
          ...base,
          how: pairs ? `${MATCH_NAME[round.matchFormat]}, opposite sides` : "Singles",
          outcome,
          margin: st.leader === 0 ? "Halved" : st.margin,
          size: Math.abs(st.up) * 100 + st.holesLeft,
        },
      });
    }
    return out;
  }

  // Own balls in the same group: a singles match between each two of us.
  for (const p of round.players) {
    if (p.id === mine.id) continue;
    const st = teamMatchState(
      "matchplay",
      round.card,
      [
        { id: mine.id, name: mine.name, playingHandicap: mine.courseHandicap, courseHandicap: mine.courseHandicap, side: 1, position: 1 },
        { id: p.id, name: p.name, playingHandicap: p.courseHandicap, courseHandicap: p.courseHandicap, side: 2, position: 2 },
      ],
      round.scores
    );
    if (!st || !st.finished) continue; // one of you didn't finish enough holes
    out.push({
      opponent: p,
      meeting: {
        ...base,
        how: FORMAT_NAME[round.format] ?? "Same group",
        outcome: st.leader === 0 ? "halved" : st.leader === 1 ? "won" : "lost",
        margin: st.leader === 0 ? "Halved" : st.margin,
        size: Math.abs(st.up) * 100 + st.holesLeft,
      },
    });
  }
  return out;
}

/** Every rivalry from these rounds, the most played first. `year` keeps only that year's rounds. */
export function rivalries(rounds: readonly RivalRound[], me: string, year: number | null = null): Rivalry[] {
  const by = new Map<RivalKey, Rivalry>();
  const sorted = [...rounds].filter((r) => year == null || r.playedOn.startsWith(`${year}-`)).sort((a, b) => b.playedOn.localeCompare(a.playedOn) || b.id - a.id);
  for (const r of sorted) {
    for (const { opponent, meeting } of meetingsIn(r, me)) {
      const key = keyOf(opponent);
      let rv = by.get(key);
      if (!rv) {
        rv = { key, memberId: opponent.memberId, name: opponent.name.replace(/\s*\(guest\)\s*$/i, ""), lastPlayerId: opponent.id, lastRoundCourse: r.courseName, won: 0, lost: 0, halved: 0, meetings: [] };
        by.set(key, rv);
      }
      rv[meeting.outcome] += 1;
      rv.meetings.push(meeting);
    }
  }
  return [...by.values()].sort((a, b) => b.meetings.length - a.meetings.length || a.name.localeCompare(b.name));
}

/** "7–4–1", or "7–4" with no halves. From your side. */
export function recordLine(r: Pick<Rivalry, "won" | "lost" | "halved">): string {
  return r.halved ? `${r.won}–${r.lost}–${r.halved}` : `${r.won}–${r.lost}`;
}

/** The current run, newest first: "Won 3" / "Lost 2" / "Halved 1". */
export function streak(r: Pick<Rivalry, "meetings">): { outcome: Outcome; count: number } | null {
  const first = r.meetings[0];
  if (!first) return null;
  let count = 0;
  for (const m of r.meetings) {
    if (m.outcome !== first.outcome) break;
    count += 1;
  }
  return { outcome: first.outcome, count };
}

/** Your biggest win, and theirs. */
export function bestWins(r: Pick<Rivalry, "meetings">): { mine: Meeting | null; theirs: Meeting | null } {
  const top = (o: Outcome) => r.meetings.filter((m) => m.outcome === o).sort((a, b) => b.size - a.size || b.playedOn.localeCompare(a.playedOn))[0] ?? null;
  return { mine: top("won"), theirs: top("lost") };
}

/** A line under a rival: who leads and the run. */
export function rivalLine(r: Rivalry): string {
  const lead = r.won > r.lost ? "You lead" : r.won < r.lost ? "They lead" : "All square";
  const s = streak(r);
  if (!s || s.count < 2) return lead;
  const run = s.outcome === "won" ? `won the last ${s.count}` : s.outcome === "lost" ? `lost the last ${s.count}` : `halved the last ${s.count}`;
  return `${lead} · ${run}`;
}
