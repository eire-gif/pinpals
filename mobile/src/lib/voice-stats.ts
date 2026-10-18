// Pure: tested in voice-stats.test.ts (no React Native here).
//
// Voice stats (My Game, Oct 2026): the speaker's own stats from what they
// said for Say scores — "I had a five, two putts, missed it short" — for
// members who track their stats (0178). It reads the same words as
// voice-scores.ts and takes only what's clearly the speaker's:
//
//   - words after "I"/"me" (or the speaker's own name), up to the next
//     player named; or
//   - anything said when no other player is named at all.
//
// Stats said about someone else ("Niamh three-putted") are never taken —
// stats are private to each member, and we only keep your own. If stats
// words are heard but can't be pinned on the speaker, `unclear` says so and
// nothing is taken.
//
// What it listens for:
//   putts      "two putts", "one-putt", "three putted", "2 putts",
//              "chipped in" / "holed out" (no putts)
//   green      "missed it short", "missed the green left", "short of the
//              green", "came up short", "over the back", "went long"
//   tee shot   "hit the fairway", "found the fairway", "missed the fairway
//              left", "drive went right", "left of the fairway"
//   penalty    "penalty", "two penalty shots", "out of bounds", "OB",
//              "lost ball", "in the water"
//
// Nothing is saved from here: the check screen shows what it heard first.

import type { GreenMiss, HoleStat, TeeShot } from "./hole-stats";
import { foldWords, tokenise, type VoicePlayer } from "./voice-scores";

export type VoiceStatPatch = Partial<Pick<HoleStat, "putts" | "tee" | "greenMiss" | "penalties">>;

export type VoiceStats = {
  /** What was heard for the speaker; empty when nothing was. */
  patch: VoiceStatPatch;
  /** Stats words were heard but couldn't be pinned on the speaker. */
  unclear: boolean;
};

const NUM: Record<string, number> = { zero: 0, no: 0, one: 1, single: 1, a: 1, two: 2, to: 2, too: 2, three: 3, four: 4, five: 5 };
const numberOf = (w: string | undefined): number | null => {
  if (w == null) return null;
  if (/^\d$/.test(w)) return Number(w);
  return w in NUM ? NUM[w] : null;
};
const DIRS = new Set(["short", "long", "left", "right"]);
const SIDE = new Set(["left", "right"]);
const STAT_WORDS = new Set([
  "putt", "putts", "putted", "fairway", "drive", "driver", "penalty", "penalties", "ob", "bounds", "water", "lost",
  "short", "long", "missed", "chipped", "holed", "back",
]);

/** The words the speaker said about themselves, and whether others were named. */
function speakerWords(transcript: string, players: readonly VoicePlayer[]): { mine: string[][]; others: string[][]; loose: string[] } {
  const me = players.find((p) => p.isMe);
  const tokens = tokenise(foldWords(transcript), players);
  const mine: string[][] = [];
  const others: string[][] = [];
  const loose: string[] = [];
  let current: string[] = loose;
  for (const t of tokens) {
    if (t.kind === "me" || (t.kind === "name" && me != null && t.players.length === 1 && t.players[0] === me.id)) {
      current = [];
      mine.push(current);
      continue;
    }
    if (t.kind === "name") {
      current = [];
      others.push(current);
      continue;
    }
    current.push(...t.text.split(" "));
  }
  return { mine, others, loose };
}

function readStats(words: string[]): VoiceStatPatch {
  const out: VoiceStatPatch = {};
  const at = (i: number) => words[i];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];

    // ---- putts ----
    if (/^putt(s|ed)?$/.test(w)) {
      const n = numberOf(at(i - 1));
      if (n != null) out.putts = Math.min(4, n);
    }
    if ((w === "chipped" || w === "chip" || w === "holed") && (at(i + 1) === "in" || at(i + 1) === "out" || at(i + 1) === "it")) {
      if (out.putts == null) out.putts = 0;
    }

    // ---- penalties ----
    if (w === "penalty" || w === "penalties") {
      const n = numberOf(at(i - 1));
      out.penalties = Math.max(out.penalties ?? 0, n != null && n > 0 ? Math.min(9, n) : 1);
    }
    if (w === "ob" || (w === "o" && at(i + 1) === "b") || (w === "bounds" && at(i - 1) === "of") || (w === "lost" && (at(i + 1) === "ball" || at(i + 2) === "ball")) || (w === "water" && ["the", "in"].includes(at(i - 1) ?? ""))) {
      out.penalties = Math.max(out.penalties ?? 0, 1);
    }

    // ---- tee shot ----
    if (w === "fairway") {
      // "missed the fairway left", "left of the fairway", "fairway right"
      const near = [at(i + 1), at(i - 3), at(i - 1)].find((x) => x != null && SIDE.has(x)) as TeeShot | undefined;
      const missed = [at(i - 1), at(i - 2), at(i - 3)].includes("missed");
      if (near) out.tee = near;
      else if (!missed) out.tee = "fairway";
    }
    if ((w === "drive" || w === "driver" || (w === "tee" && at(i + 1) === "shot")) && out.tee == null) {
      const side = [at(i + 1), at(i + 2), at(i + 3)].find((x) => x != null && SIDE.has(x)) as TeeShot | undefined;
      if (side) out.tee = side;
    }

    // ---- missed green ----
    if (DIRS.has(w) && at(i + 1) === "of" && at(i + 2) === "the" && at(i + 3) === "green") out.greenMiss = w as GreenMiss;
    if (w === "missed" || w === "miss") {
      // "missed it short", "missed the green left", "missed short" — but not the fairway, and not a short putt.
      const window = words.slice(i + 1, i + 4);
      if (!window.some((x) => x === "fairway" || x === "drive")) {
        const d = window.find((x) => DIRS.has(x));
        if (d) {
          const after = words[i + 1 + window.indexOf(d) + 1];
          if (!(after && /^putt/.test(after))) out.greenMiss = d as GreenMiss;
        }
      }
    }
    if (w === "came" && at(i + 1) === "up" && at(i + 2) === "short") out.greenMiss = "short";
    if ((w === "over" && at(i + 1) === "the" && at(i + 2) === "back") || (w === "went" && at(i + 1) === "long") || (w === "through" && at(i + 1) === "the" && at(i + 2) === "green")) out.greenMiss = "long";
  }
  return out;
}

const hasStatWords = (words: string[]) => words.some((w) => STAT_WORDS.has(w) || /^putt/.test(w));

export function parseVoiceStats(transcript: string, players: readonly VoicePlayer[]): VoiceStats {
  const { mine, others, loose } = speakerWords(transcript, players);
  const named = others.length > 0;
  const patch: VoiceStatPatch = {};
  // Said before anyone was named: the speaker's only when nobody else is named at all.
  const sources = [...(named ? [] : [loose]), ...mine];
  for (const words of sources) Object.assign(patch, readStats(words));
  const unclear = Object.keys(patch).length === 0 && named && hasStatWords(loose);
  return { patch, unclear };
}

/** "2 putts · missed short · fairway · 1 penalty" — for the check screen. */
export function voiceStatsLine(p: VoiceStatPatch): string {
  const bits: string[] = [];
  if (p.tee) bits.push(p.tee === "fairway" ? "fairway" : `tee shot ${p.tee}`);
  if (p.putts != null) bits.push(p.putts === 0 ? "no putts" : `${p.putts === 4 ? "4+" : p.putts} ${p.putts === 1 ? "putt" : "putts"}`);
  if (p.greenMiss) bits.push(`missed ${p.greenMiss}`);
  if (p.penalties) bits.push(`${p.penalties} ${p.penalties === 1 ? "penalty" : "penalties"}`);
  return bits.join(" · ");
}

/** Stats words worth listening for, for the recogniser's hints. */
export const STAT_HINTS = ["putts", "fairway", "missed short", "missed long", "penalty", "out of bounds"];
